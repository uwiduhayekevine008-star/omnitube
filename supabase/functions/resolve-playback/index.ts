import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};
const encoder = new TextEncoder();
const respond = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), { status, headers: { ...cors, "Content-Type": "application/json" } });
const textResponse = (status: number, body: string, contentType = "text/plain; charset=utf-8") =>
  new Response(body, { status, headers: { ...cors, "Content-Type": contentType } });

type PlaybackTicket = {
  v: 1;
  videoId: string;
  viewerId: string | null;
  visibility: "public" | "unlisted" | "private";
  assetPath: string;
  exp: number;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function ticketKey(secret: string, usage: KeyUsage[]) {
  return await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}
async function signTicket(ticket: PlaybackTicket, secret: string): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(ticket)));
  const key = await ticketKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return payload + "." + base64UrlEncode(new Uint8Array(signature));
}
async function verifyTicket(token: string, secret: string): Promise<PlaybackTicket | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  try {
    const key = await ticketKey(secret, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, base64UrlDecode(signature), encoder.encode(payload));
    if (!valid) return null;
    const ticket = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as PlaybackTicket;
    if (ticket.v !== 1 || typeof ticket.videoId !== "string" ||
        !(ticket.viewerId === null || typeof ticket.viewerId === "string") ||
        !["public", "unlisted", "private"].includes(ticket.visibility) ||
        typeof ticket.assetPath !== "string" || !Number.isInteger(ticket.exp) ||
        ticket.exp <= Math.floor(Date.now() / 1000)) return null;
    return ticket;
  } catch {
    return null;
  }
}
function isSafeObjectPath(path: string, root: string): boolean {
  return path.startsWith(root + "/") && !path.includes("..") &&
    !path.startsWith("/") && !path.includes("\\") && /^[a-zA-Z0-9._/-]+$/.test(path);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const privilegedKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !privilegedKey) return respond(503, { error: "Playback authorization is not configured" });
  const admin = createClient(supabaseUrl, privilegedKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Signed, short-lived playlist tickets allow browser/native media clients to
  // fetch private HLS manifests without exposing the service key or a public bucket.
  if (request.method === "GET") {
    const ticketText = new URL(request.url).searchParams.get("ticket") || "";
    const ticket = await verifyTicket(ticketText, privilegedKey);
    if (!ticket) return textResponse(401, "Playback ticket is invalid or expired");

    const { data: video, error } = await admin.from("videos")
      .select("id,creator_id,status,visibility,media_status,playback_manifest_path")
      .eq("id", ticket.videoId).maybeSingle();
    if (error || !video || video.status !== "published" || video.media_status !== "ready" || !video.playback_manifest_path) {
      return textResponse(404, "Media manifest is unavailable");
    }
    const discoverable = ["public", "unlisted"].includes(video.visibility);
    // A visibility change invalidates the entire ticket family, including child
    // playlists and segments minted before the video was made private.
    if (ticket.visibility !== video.visibility) return textResponse(404, "Media manifest is unavailable");
    if (!discoverable && ticket.viewerId !== video.creator_id) return textResponse(404, "Media manifest is unavailable");

    const manifestPath = video.playback_manifest_path;
    if (!manifestPath.endsWith("/master.m3u8")) return textResponse(503, "Media manifest configuration is invalid");
    const root = manifestPath.slice(0, -"/master.m3u8".length);
    const isManifest = ticket.assetPath === manifestPath || ticket.assetPath.endsWith(".m3u8");
    const isSegment = ticket.assetPath.endsWith(".ts");
    if (!root.startsWith(video.creator_id + "/" + video.id + "/") ||
        !isSafeObjectPath(ticket.assetPath, root) ||
        (!isManifest && !isSegment)) {
      return textResponse(403, "Media asset path is invalid");
    }

    // Media segment URLs are independently ticketed and exchanged for a short
    // Storage signature at request time, so a six-hour VOD doesn't rely on a
    // signature minted when the master playlist was first loaded.
    if (isSegment) {
      const { data: signed, error: signError } = await admin.storage.from("omnitube-renditions").createSignedUrl(ticket.assetPath, 900);
      if (signError || !signed?.signedUrl) return textResponse(404, "Media segment is not available");
      return new Response(null, {
        status: 302,
        headers: { ...cors, "Location": signed.signedUrl, "Cache-Control": "no-store" },
      });
    }

    const { data: object, error: downloadError } = await admin.storage.from("omnitube-renditions").download(ticket.assetPath);
    if (downloadError || !object) return textResponse(404, "Media manifest is not available");
    const raw = await object.text();
    const lines = raw.split(/\r?\n/);
    const isMaster = ticket.assetPath === manifestPath;
    const rewritten: string[] = [];
    const parent = ticket.assetPath.slice(0, ticket.assetPath.lastIndexOf("/") + 1);

    for (const line of lines) {
      const value = line.trim();
      if (!value || value.startsWith("#")) {
        rewritten.push(line);
        continue;
      }
      if (/^https?:\/\//i.test(value) || value.startsWith("/") || value.includes("..") || !/^[a-zA-Z0-9._/-]+$/.test(value)) {
        return textResponse(502, "A generated media playlist contains an invalid relative path");
      }
      const referencedPath = parent + value;
      if (!isSafeObjectPath(referencedPath, root)) return textResponse(502, "A generated media reference is outside its rendition folder");

      if (isMaster) {
        if (!referencedPath.endsWith(".m3u8")) return textResponse(502, "The master playlist has an invalid rendition reference");
      } else if (!referencedPath.endsWith(".ts")) {
        return textResponse(502, "A rendition playlist contains an unsupported segment reference");
      }

      // Every child playlist and segment gets a bounded playback ticket. The
      // function re-checks the video's current visibility on each request.
      const assetTtl = 7 * 60 * 60;
      const assetTicket = await signTicket({
        v: 1, videoId: video.id, viewerId: ticket.viewerId, visibility: ticket.visibility,
        assetPath: referencedPath, exp: Math.floor(Date.now() / 1000) + assetTtl,
      }, privilegedKey);
      rewritten.push(supabaseUrl + "/functions/v1/resolve-playback?ticket=" + encodeURIComponent(assetTicket));
    }

    return textResponse(200, rewritten.join("\n"), "application/vnd.apple.mpegurl");
  }

  if (request.method !== "POST") return respond(405, { error: "GET or POST required" });
  let input: { videoId?: unknown };
  try { input = await request.json(); } catch { return respond(400, { error: "A valid JSON body is required" }); }
  if (typeof input.videoId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.videoId)) {
    return respond(400, { error: "A valid videoId is required" });
  }

  const authorization = request.headers.get("Authorization") || "";
  const bearer = authorization.replace(/^Bearer\s+/i, "");
  let viewerId: string | null = null;
  if (bearer && !bearer.startsWith("sb_publishable_") && !bearer.startsWith("sb_secret_")) {
    const { data } = await admin.auth.getUser(bearer);
    viewerId = data.user?.id || null;
  }

  const { data: video, error } = await admin.from("videos")
    .select("id,creator_id,video_path,status,visibility,media_status,playback_manifest_path")
    .eq("id", input.videoId).maybeSingle();
  if (error) return respond(500, { error: "Could not verify video permissions" });
  if (!video) return respond(404, { error: "Video not found" });
  const owner = viewerId === video.creator_id;
  const discoverable = video.status === "published" && ["public", "unlisted"].includes(video.visibility);
  if (!discoverable && !owner) return respond(404, { error: "Video not found" });

  if (video.media_status === "ready" && video.playback_manifest_path) {
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 60 * 60;
    const ticket = await signTicket({
      v: 1,
      videoId: video.id,
      viewerId,
      visibility: video.visibility as PlaybackTicket["visibility"],
      assetPath: video.playback_manifest_path,
      exp: expiresAt,
    }, privilegedKey);
    return respond(200, {
      signedUrl: supabaseUrl + "/functions/v1/resolve-playback?ticket=" + encodeURIComponent(ticket),
      playbackType: "hls",
      expiresIn: 7 * 60 * 60,
    });
  }

  // Direct original playback remains a real, private, short-lived fallback while
  // the background HLS worker is queued, processing, or retrying a failed job.
  if (!video.video_path || !video.video_path.startsWith(video.creator_id + "/") || video.video_path.includes("..")) {
    return respond(403, { error: "Invalid media object path" });
  }
  const { data: signed, error: signError } = await admin.storage.from("omnitube-videos").createSignedUrl(video.video_path, 7 * 60 * 60);
  if (signError || !signed?.signedUrl) return respond(404, { error: "Media is not available yet" });
  return respond(200, { signedUrl: signed.signedUrl, playbackType: "file", expiresIn: 7 * 60 * 60 });
});
