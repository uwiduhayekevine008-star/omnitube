import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const VIDEO_BUCKET = "omnitube-videos";
const THUMBNAIL_BUCKET = "omnitube-thumbnails";
const RENDITION_BUCKET = "omnitube-renditions";
const pollMs = numberEnv("MEDIA_WORKER_POLL_MS", 3000);
const leaseMs = numberEnv("MEDIA_WORKER_LEASE_MS", 900000);
const maxAttempts = numberEnv("MEDIA_WORKER_MAX_ATTEMPTS", 4);
const maxSourceBytes = numberEnv("MEDIA_WORKER_MAX_SOURCE_BYTES", 2147483648);
const maxDurationSeconds = numberEnv("MEDIA_WORKER_MAX_DURATION_SECONDS", 21600);
const workerId = process.env.MEDIA_WORKER_ID || `worker-${process.pid}`;
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";
const tempRoot = process.env.MEDIA_WORKER_TEMP_DIR || join(tmpdir(), "omnitube-media");

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function scaleWithinBounds(width, height, shortEdge) {
  if (![width, height, shortEdge].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Invalid source or rendition dimensions");
  }
  const portrait = height > width;
  const maxWidth = portrait ? shortEdge : Math.round(shortEdge * 16 / 9);
  const maxHeight = portrait ? Math.round(shortEdge * 16 / 9) : shortEdge;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  const outputWidth = Math.max(2, Math.floor((width * scale) / 2) * 2);
  const outputHeight = Math.max(2, Math.floor((height * scale) / 2) * 2);
  return { width: outputWidth, height: outputHeight };
}

export function buildMasterPlaylist(variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error("At least one HLS rendition is required");
  }
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  for (const variant of variants) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},AVERAGE-BANDWIDTH=${Math.floor(variant.bandwidth * 0.82)},RESOLUTION=${variant.width}x${variant.height}`,
      `${variant.name}/index.m3u8`,
    );
  }
  return lines.join("\n") + "\n";
}

export function contentTypeFor(path) {
  if (path.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (path.endsWith(".ts")) return "video/mp2t";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function log(level, event, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, workerId, ...details }));
}

async function runBinary(binary, args, timeoutMs = 45 * 60 * 1000) {
  return await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${basename(binary)} timed out`));
    }, timeoutMs);
    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout: output, stderr });
    };
    child.stdout.on("data", (chunk) => { if (stdout.length < 1024 * 1024) stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 12000) stderr += chunk.toString(); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) finish(null, stdout);
      else finish(new Error(`${basename(binary)} exited ${code}: ${stderr.slice(-2500)}`));
    });
  });
}

async function probeMedia(inputPath) {
  const output = await runBinary(ffprobePath, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-show_entries", "format=duration",
    "-of", "json",
    inputPath,
  ], 30000);
  const parsed = JSON.parse(output.stdout);
  const video = parsed.streams?.[0];
  const width = Number(video?.width);
  const height = Number(video?.height);
  const duration = Number(parsed.format?.duration);
  if (!(width > 0) || !(height > 0)) throw new Error("Uploaded source has no decodable video stream");
  if (!Number.isFinite(duration) || duration <= 0 || duration > maxDurationSeconds) {
    throw new Error(`Source duration must be between 1 second and ${maxDurationSeconds} seconds`);
  }
  return { width, height, duration };
}

async function downloadSource(admin, video, targetPath) {
  const { data, error } = await admin.storage.from(VIDEO_BUCKET).createSignedUrl(video.video_path, 600);
  if (error || !data?.signedUrl) throw new Error("Could not authorize source-media download");
  const response = await fetch(data.signedUrl);
  if (!response.ok || !response.body) throw new Error(`Source download failed with HTTP ${response.status}`);
  const responseSize = Number(response.headers.get("content-length") || 0);
  if (responseSize > maxSourceBytes) throw new Error("Source file exceeds the configured transcoding limit");
  let bytes = 0;
  const meter = new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxSourceBytes) throw new Error("Source file exceeded the configured transcoding limit");
      controller.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body.pipeThrough(meter)), createWriteStream(targetPath, { flags: "wx" }));
  const file = await stat(targetPath);
  if (file.size < 1 || file.size > maxSourceBytes) throw new Error("Downloaded source file size is invalid");
}

async function transcodeRendition(sourcePath, outputFolder, source, label) {
  const bounds = { 360: 360, 720: 720, 1080: 1080 }[label];
  const dimensions = scaleWithinBounds(source.width, source.height, bounds);
  await mkdir(outputFolder, { recursive: true });
  const segmentPattern = join(outputFolder, "segment_%05d.ts");
  const playlistPath = join(outputFolder, "index.m3u8");
  const videoBitrate = { 360: "550k", 720: "1400k", 1080: "2800k" }[label];
  const maxRate = { 360: "700k", 720: "1750k", 1080: "3500k" }[label];
  const audioRate = label === 360 ? "64k" : "128k";
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", sourcePath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-vf", `scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease,pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2`,
    "-c:v", "libx264",
    "-preset", process.env.FFMPEG_PRESET || "veryfast",
    "-profile:v", "main",
    "-pix_fmt", "yuv420p",
    "-b:v", videoBitrate,
    "-maxrate", maxRate,
    "-bufsize", maxRate,
    "-force_key_frames", "expr:gte(t,n_forced*6)",
    "-c:a", "aac",
    "-b:a", audioRate,
    "-ac", "2",
    "-f", "hls",
    "-hls_time", "6",
    "-hls_playlist_type", "vod",
    "-hls_segment_type", "mpegts",
    "-hls_flags", "independent_segments+temp_file",
    "-hls_segment_filename", segmentPattern,
    playlistPath,
  ];
  await runBinary(ffmpegPath, args);
  const bandwidth = { 360: 650000, 720: 1600000, 1080: 3150000 }[label];
  return { name: `${label}p`, width: dimensions.width, height: dimensions.height, bandwidth, label, playlistPath };
}

async function listLocalFiles(directory) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listLocalFiles(absolute));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

async function assertJobLease(admin, job) {
  const { data: current, error } = await admin.from("media_processing_jobs")
    .select("id,status,locked_by").eq("id", job.id).maybeSingle();
  if (error) throw new Error("Could not verify media-worker job lease");
  if (!current || current.status !== "processing" || current.locked_by !== workerId) {
    throw new MediaJobCancelledError("The media-processing lease was cancelled or reassigned");
  }
  const { data: video, error: videoError } = await admin.from("videos")
    .select("status").eq("id", job.video_id).maybeSingle();
  if (videoError) throw new Error("Could not verify video state before media processing");
  if (!video || video.status !== "published") {
    throw new MediaJobCancelledError("The video was removed or unpublished during processing");
  }
}

async function listStorageObjects(admin, bucket, root) {
  const pending = [root];
  const found = [];
  while (pending.length) {
    const folder = pending.pop();
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(folder, {
        limit: 100, offset, sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Could not enumerate storage cleanup folder ${folder}`);
      const items = data || [];
      for (const item of items) {
        const path = folder + "/" + item.name;
        if (item.id == null && item.metadata == null) pending.push(path);
        else found.push(path);
        if (found.length > 50000) throw new Error("Media cleanup exceeded the safe object-count limit");
      }
      if (items.length < 100) break;
      offset += items.length;
    }
  }
  return found;
}

async function cleanupRenditionPrefix(admin, root) {
  if (!root) return;
  const paths = await listStorageObjects(admin, RENDITION_BUCKET, root);
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await admin.storage.from(RENDITION_BUCKET).remove(paths.slice(offset, offset + 100));
    if (error) throw new Error("Some cancelled HLS objects could not be removed");
  }
}

class MediaJobCancelledError extends Error {}

async function uploadRenditions(admin, basePath, outputFolder, job) {
  const files = await listLocalFiles(outputFolder);
  // Sequential uploads bound memory. Check the lease both before and after every
  // object write; if deletion races an upload, remove that just-written object.
  for (const filePath of files) {
    await assertJobLease(admin, job);
    const suffix = relative(outputFolder, filePath).split(sep).join("/");
    const objectPath = `${basePath}/${suffix}`;
    const bytes = await readFile(filePath);
    const { error } = await admin.storage.from(RENDITION_BUCKET).upload(objectPath, bytes, {
      contentType: contentTypeFor(filePath),
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) throw new Error(`Rendition upload failed for ${suffix}: ${error.message}`);
    try {
      await assertJobLease(admin, job);
    } catch (error) {
      await admin.storage.from(RENDITION_BUCKET).remove([objectPath]);
      throw error;
    }
  }
}

async function generatePoster(sourcePath, targetPath, duration) {
  const seek = Math.max(0, Math.min(1, duration / 2));
  try {
    await runBinary(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", String(seek),
      "-i", sourcePath,
      "-frames:v", "1",
      "-vf", "scale='min(1280,iw)':-2",
      "-q:v", "3",
      targetPath,
    ], 60000);
    const result = await stat(targetPath);
    return result.size > 0;
  } catch {
    return false;
  }
}

async function processVideo(admin, job) {
  const { data: video, error } = await admin.from("videos")
    .select("id,creator_id,title,video_path,thumbnail_path,status")
    .eq("id", job.video_id)
    .maybeSingle();
  if (error) throw new Error("Could not load video for transcoding");
  if (!video || video.status !== "published") {
    await admin.from("media_processing_jobs").update({
      status: "succeeded", locked_at: null, locked_by: null, last_error: "", updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return;
  }
  if (!video.video_path || !video.video_path.startsWith(`${video.creator_id}/`) || video.video_path.includes("..")) {
    throw new Error("Original source path is invalid");
  }

  job.renditionRoot = `${video.creator_id}/${video.id}/${job.id}`;
  await assertJobLease(admin, job);
  const temp = await mkdtemp(join(tempRoot, "job-"));
  try {
    const sourcePath = join(temp, "source.media");
    const outputFolder = join(temp, "hls");
    await mkdir(outputFolder, { recursive: true });
    await downloadSource(admin, video, sourcePath);
    const source = await probeMedia(sourcePath);

    const labels = [360];
    if (Math.min(source.width, source.height) >= 480) labels.push(720);
    if (Math.min(source.width, source.height) >= 900) labels.push(1080);
    const variants = [];
    for (const label of labels) {
      await assertJobLease(admin, job);
      variants.push(await transcodeRendition(sourcePath, join(outputFolder, `${label}p`), source, label));
    }
    await BunlessWriteFile(join(outputFolder, "master.m3u8"), buildMasterPlaylist(variants));

    const basePath = job.renditionRoot;
    await uploadRenditions(admin, basePath, outputFolder, job);
    await assertJobLease(admin, job);

    await assertJobLease(admin, job);
    let posterPath = video.thumbnail_path;
    if (!posterPath) {
      const posterLocal = join(temp, "poster.jpg");
      if (await generatePoster(sourcePath, posterLocal, source.duration)) {
        const posterBytes = await readFile(posterLocal);
        const candidate = `${video.creator_id}/${video.id}-generated.jpg`;
        const { error: posterError } = await admin.storage.from(THUMBNAIL_BUCKET).upload(candidate, posterBytes, {
          contentType: "image/jpeg",
          cacheControl: "3600",
          upsert: true,
        });
        if (!posterError) posterPath = candidate;
        else log("warn", "poster_upload_failed", { jobId: job.id, videoId: video.id });
      }
    }

    await assertJobLease(admin, job);
    const { data: finalized, error: finalizeError } = await admin.from("videos").update({
      playback_manifest_path: `${basePath}/master.m3u8`,
      media_status: "ready",
      ...(posterPath ? { thumbnail_path: posterPath } : {}),
      duration_seconds: Math.round(source.duration * 100) / 100,
      updated_at: new Date().toISOString(),
    }).eq("id", video.id).eq("status", "published").select("id").maybeSingle();
    if (finalizeError) throw new Error("Could not activate generated media renditions");
    if (!finalized) throw new MediaJobCancelledError("Video was deleted before rendition activation");

    const { error: jobError } = await admin.from("media_processing_jobs").update({
      status: "succeeded", locked_at: null, locked_by: null, last_error: "", updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    if (jobError) throw new Error("Renditions are uploaded but job completion could not be recorded");
    log("info", "transcode_succeeded", { jobId: job.id, videoId: video.id, variants: variants.map((v) => v.name), duration: source.duration });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function BunlessWriteFile(path, content) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, content, "utf8");
}

async function heartbeat(admin, jobId) {
  return await admin.from("media_processing_jobs").update({
    locked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", jobId).eq("status", "processing").eq("locked_by", workerId);
}

async function recoverExpiredLeases(admin) {
  const cutoff = new Date(Date.now() - leaseMs).toISOString();
  await admin.from("media_processing_jobs").update({
    status: "pending", locked_at: null, locked_by: null, available_at: new Date().toISOString(),
    last_error: "Worker lease expired; the job was safely re-queued.", updated_at: new Date().toISOString(),
  }).eq("status", "processing").lt("locked_at", cutoff);
}

async function claimNextJob(admin) {
  const now = new Date().toISOString();
  const { data: candidates, error } = await admin.from("media_processing_jobs")
    .select("id,video_id,attempts")
    .eq("status", "pending")
    .lte("available_at", now)
    .order("available_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Queue read failed: ${error.message}`);
  const job = candidates?.[0];
  if (!job) return null;
  const { data: claimed, error: claimError } = await admin.from("media_processing_jobs")
    .update({
      status: "processing",
      attempts: job.attempts + 1,
      locked_at: now,
      locked_by: workerId,
      updated_at: now,
    })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id,video_id,attempts")
    .maybeSingle();
  if (claimError) throw new Error(`Queue claim failed: ${claimError.message}`);
  return claimed || null;
}

async function handleFailure(admin, job, error) {
  const message = (error instanceof Error ? error.message : "Unknown transcoding failure").slice(0, 1800);
  const retry = job.attempts < maxAttempts;
  const delayMs = Math.min(30 * 60 * 1000, 15000 * (2 ** Math.max(0, job.attempts - 1)));
  const now = new Date().toISOString();
  await admin.from("media_processing_jobs").update({
    status: retry ? "pending" : "failed",
    available_at: new Date(Date.now() + (retry ? delayMs : 0)).toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: message,
    updated_at: now,
  }).eq("id", job.id);
  await admin.from("videos").update({
    media_status: retry ? "queued" : "failed",
    updated_at: now,
  }).eq("id", job.video_id);
  log(retry ? "warn" : "error", "transcode_failed", {
    jobId: job.id, videoId: job.video_id, attempts: job.attempts, retry, error: message,
  });
}

export async function runWorker() {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl.startsWith("https://") || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and server-only SUPABASE_SERVICE_ROLE_KEY are required");
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "omnitube-media-worker/1.0.0" } },
  });
  await mkdir(tempRoot, { recursive: true });
  await runBinary(ffmpegPath, ["-version"], 10000);
  await runBinary(ffprobePath, ["-version"], 10000);
  log("info", "worker_started", { pollMs, maxAttempts, maxSourceBytes, maxDurationSeconds });

  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!stopping) {
    try {
      await recoverExpiredLeases(admin);
      const job = await claimNextJob(admin);
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        continue;
      }
      log("info", "transcode_started", { jobId: job.id, videoId: job.video_id, attempt: job.attempts });
      const heartbeatTimer = setInterval(() => {
        void heartbeat(admin, job.id).then(({ error }) => {
          if (error) log("warn", "heartbeat_failed", { jobId: job.id, error: error.message });
        }).catch((error) => log("warn", "heartbeat_failed", { jobId: job.id, error: String(error) }));
      }, Math.max(15000, Math.floor(leaseMs / 4)));
      try {
        await processVideo(admin, job);
      } catch (error) {
        if (error instanceof MediaJobCancelledError) {
          try {
            await cleanupRenditionPrefix(admin, job.renditionRoot);
            log("info", "transcode_cancelled", { jobId: job.id, videoId: job.video_id, reason: error.message });
          } catch (cleanupError) {
            log("error", "cancelled_rendition_cleanup_failed", {
              jobId: job.id, videoId: job.video_id,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            });
          }
        } else {
          await handleFailure(admin, job, error);
        }
      } finally {
        clearInterval(heartbeatTimer);
      }
    } catch (error) {
      log("error", "worker_loop_error", { error: error instanceof Error ? error.message : String(error) });
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs * 4, 15000)));
    }
  }

  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
  log("info", "worker_stopped");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWorker().catch((error) => {
    log("fatal", "worker_start_failed", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}
