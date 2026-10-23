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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "POST required" });

  const url = Deno.env.get("SUPABASE_URL") || "";
  const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !adminKey) return respond(503, { error: "Media retry is not configured on this deployment" });

  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer || bearer.startsWith("sb_publishable_") || bearer.startsWith("sb_secret_")) {
    return respond(401, { error: "Sign in to retry media processing" });
  }

  let input: { videoId?: unknown };
  try { input = await request.json(); } catch { return respond(400, { error: "A valid JSON body is required" }); }
  if (typeof input.videoId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.videoId)) {
    return respond(400, { error: "A valid videoId is required" });
  }

  const admin = createClient(url, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: auth, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !auth.user) return respond(401, { error: "Your session is not valid; sign in again" });

  const { data: video, error: lookupError } = await admin.from("videos")
    .select("id,creator_id,video_path,status,media_status")
    .eq("id", input.videoId).eq("creator_id", auth.user.id).maybeSingle();
  if (lookupError) return respond(503, { error: "Could not verify video ownership; retry safely" });
  if (!video) return respond(404, { error: "Video not found" });
  if (video.status !== "published") return respond(409, { error: "Only published videos can be reprocessed" });
  if (video.media_status !== "failed") {
    return respond(409, { error: "This video is not in a failed media state and does not need a retry" });
  }
  if (!video.video_path || !video.video_path.startsWith(auth.user.id + "/") || video.video_path.includes("..")) {
    return respond(403, { error: "The original media path is invalid" });
  }

  // Fail early if the original source was deleted or is no longer signable.
  const { data: source, error: sourceError } = await admin.storage.from("omnitube-videos")
    .createSignedUrl(video.video_path, 60);
  if (sourceError || !source?.signedUrl) {
    return respond(409, { error: "The original upload is unavailable. Re-upload the source before retrying transcoding." });
  }

  // Make the video claimable only after the state is updated. The worker's claim
  // query requires media_status='queued'; failed retries are safe to invoke again.
  const { data: queuedVideo, error: stateError } = await admin.from("videos").update({
    media_status: "queued",
    playback_manifest_path: null,
    updated_at: new Date().toISOString(),
  }).eq("id", video.id).eq("creator_id", auth.user.id).eq("status", "published").eq("media_status", "failed")
    .select("id").maybeSingle();
  if (stateError) return respond(503, { error: "Could not reset the media state; retry the request safely" });
  if (!queuedVideo) return respond(409, { error: "This video's media state changed during the retry request. Refresh Creator Studio and try again if it is still failed." });

  const now = new Date().toISOString();
  const { error: queueError } = await admin.from("media_processing_jobs").upsert({
    video_id: video.id,
    status: "pending",
    attempts: 0,
    available_at: now,
    locked_at: null,
    locked_by: null,
    last_error: "",
    updated_at: now,
  }, { onConflict: "video_id" });

  if (queueError) {
    await admin.from("videos").update({
      media_status: "failed",
      updated_at: new Date().toISOString(),
    }).eq("id", video.id).eq("creator_id", auth.user.id).eq("status", "published").eq("media_status", "queued");
    return respond(503, { error: "Could not enqueue media retry. The video remains saved; retry this action safely." });
  }

  return respond(200, { success: true, videoId: video.id, mediaStatus: "queued" });
});
