import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const respond = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), { status, headers: corsHeaders });

async function listBucketObjects(admin: ReturnType<typeof createClient>, bucket: string, root: string): Promise<string[]> {
  const pending = [root];
  const found: string[] = [];
  while (pending.length) {
    const folder = pending.pop()!;
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(folder, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error("Could not list all media objects for cleanup");
      const rows = data || [];
      for (const item of rows) {
        const path = folder + "/" + item.name;
        if (item.id == null && item.metadata == null) pending.push(path);
        else found.push(path);
        if (found.length > 50000) throw new Error("Media cleanup exceeded the safe object-count limit");
      }
      if (rows.length < 100) break;
      offset += rows.length;
    }
  }
  return found;
}

async function removeObjects(admin: ReturnType<typeof createClient>, bucket: string, paths: string[]) {
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100));
    if (error) throw new Error("One or more media objects could not be removed");
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "POST required" });

  const url = Deno.env.get("SUPABASE_URL") || "";
  const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !adminKey) {
    return respond(503, { error: "Secure media deletion is not configured on this deployment" });
  }

  const authorization = request.headers.get("Authorization") || "";
  const bearer = authorization.replace(/^Bearer\s+/i, "");
  if (!bearer || bearer.startsWith("sb_publishable_") || bearer.startsWith("sb_secret_")) {
    return respond(401, { error: "Sign-in is required" });
  }

  let input: { videoId?: unknown };
  try { input = await request.json(); }
  catch { return respond(400, { error: "A valid JSON body is required" }); }
  if (typeof input.videoId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.videoId)) {
    return respond(400, { error: "A valid videoId is required" });
  }

  const admin = createClient(url, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: auth, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !auth.user) return respond(401, { error: "Your session is not valid; sign in again" });

  const { data: video, error: lookupError } = await admin.from("videos")
    .select("id,creator_id,video_path,thumbnail_path")
    .eq("id", input.videoId)
    .eq("creator_id", auth.user.id)
    .maybeSingle();
  if (lookupError) return respond(503, { error: "Could not verify video ownership; retry safely" });
  // Idempotent retry: a completed deletion never reveals another account's records.
  if (!video) return respond(200, { success: true, videoId: input.videoId, alreadyDeleted: true });

  const renditionRoot = auth.user.id + "/" + video.id;
  if (!video.video_path || !video.video_path.startsWith(auth.user.id + "/") || video.video_path.includes("..")) {
    return respond(403, { error: "Original media path is invalid; deletion was stopped for safety" });
  }
  if (video.thumbnail_path && (!video.thumbnail_path.startsWith(auth.user.id + "/") || video.thumbnail_path.includes(".."))) {
    return respond(403, { error: "Thumbnail path is invalid; deletion was stopped for safety" });
  }

  // Hide first, then cancel any active transcode lease before enumerating HLS
  // objects. The worker checks that its lease is still current before/after each
  // upload so a concurrent delete cannot leave newly orphaned renditions.
  const { error: hideError } = await admin.from("videos")
    .update({ visibility: "private", updated_at: new Date().toISOString() })
    .eq("id", video.id)
    .eq("creator_id", auth.user.id);
  if (hideError) return respond(503, { error: "Could not make the video private; no media was deleted" });

  const { error: cancelError } = await admin.from("media_processing_jobs").update({
    status: "failed",
    locked_at: null,
    locked_by: null,
    last_error: "Transcoding cancelled because the video owner deleted the video.",
    updated_at: new Date().toISOString(),
  }).eq("video_id", video.id).in("status", ["pending", "processing"]);
  if (cancelError) {
    return respond(503, {
      error: "The video is private, but the transcode job could not be cancelled. Retry deletion after checking worker status.",
      retryable: true,
    });
  }

  try {
    const renditionObjects = await listBucketObjects(admin, "omnitube-renditions", renditionRoot);
    const generatedPosterPath = auth.user.id + "/" + video.id + "-generated.jpg";
    const results = await Promise.all([
      admin.storage.from("omnitube-videos").remove([video.video_path]),
      video.thumbnail_path
        ? admin.storage.from("omnitube-thumbnails").remove([video.thumbnail_path])
        : Promise.resolve({ error: null }),
      // Also remove a generated poster that may have been uploaded immediately
      // before a concurrent delete cancelled its transcode job.
      admin.storage.from("omnitube-thumbnails").remove([generatedPosterPath]),
    ]);
    if (results.some((result) => result.error)) {
      return respond(503, {
        error: "The video is private, but its source or thumbnail could not be removed. Retry deletion to finish cleanup.",
        retryable: true,
      });
    }
    await removeObjects(admin, "omnitube-renditions", renditionObjects);
  } catch {
    return respond(503, {
      error: "The video is private, but some media objects could not be cleaned up. Retry deletion to finish cleanup.",
      retryable: true,
    });
  }

  const { error: deleteError } = await admin.from("videos")
    .delete()
    .eq("id", video.id)
    .eq("creator_id", auth.user.id);
  if (deleteError) {
    return respond(503, {
      error: "Media files were removed, but the database record could not be deleted. Retry deletion to finish cleanup.",
      retryable: true,
    });
  }

  return respond(200, { success: true, videoId: video.id });
});
