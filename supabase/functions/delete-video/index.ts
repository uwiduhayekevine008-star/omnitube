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
  // Idempotent retry: once the same authenticated owner has completed deletion,
  // a repeated request returns success without exposing another user's records.
  if (!video) return respond(200, { success: true, videoId: input.videoId, alreadyDeleted: true });

  if (!video.video_path || !video.video_path.startsWith(auth.user.id + "/") || video.video_path.includes("..")) {
    return respond(403, { error: "Original media path is invalid; deletion was stopped for safety" });
  }
  if (video.thumbnail_path && (!video.thumbnail_path.startsWith(auth.user.id + "/") || video.thumbnail_path.includes(".."))) {
    return respond(403, { error: "Thumbnail path is invalid; deletion was stopped for safety" });
  }

  // Make the content private before touching storage. If storage is unavailable,
  // the row remains available for a safe retry but no longer appears publicly.
  const { error: hideError } = await admin.from("videos")
    .update({ visibility: "private", updated_at: new Date().toISOString() })
    .eq("id", video.id)
    .eq("creator_id", auth.user.id);
  if (hideError) return respond(503, { error: "Could not make the video private; no media was deleted" });

  const storageResults = await Promise.all([
    admin.storage.from("omnitube-videos").remove([video.video_path]),
    video.thumbnail_path
      ? admin.storage.from("omnitube-thumbnails").remove([video.thumbnail_path])
      : Promise.resolve({ error: null }),
  ]);
  if (storageResults.some((result) => result.error)) {
    return respond(503, {
      error: "The video is private, but one or more media files could not be removed. Retry deletion to finish cleanup.",
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
