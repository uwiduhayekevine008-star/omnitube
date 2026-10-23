import { createClient } from "npm:@supabase/supabase-js@2.118.0";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const respond = (status: number, payload: Record<string, unknown>) => new Response(JSON.stringify(payload), { status, headers: cors });
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return respond(405, { error: "POST required" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const privilegedKey = Deno.env.get(["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_")) || "";
  if (!supabaseUrl || !privilegedKey) return respond(503, { error: "Playback authorization is not configured" });
  let input: { videoId?: unknown };
  try { input = await request.json(); } catch { return respond(400, { error: "A valid JSON body is required" }); }
  if (typeof input.videoId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.videoId)) return respond(400, { error: "A valid videoId is required" });
  const admin = createClient(supabaseUrl, privilegedKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\\s+/i, "");
  let viewerId: string | null = null;
  if (bearer && !bearer.startsWith("sb_publishable_")) {
    const { data } = await admin.auth.getUser(bearer);
    viewerId = data.user?.id || null;
  }
  const { data: video, error } = await admin.from("videos").select("id,creator_id,video_path,status,visibility").eq("id", input.videoId).maybeSingle();
  if (error) return respond(500, { error: "Could not verify video permissions" });
  if (!video) return respond(404, { error: "Video not found" });
  const owner = viewerId === video.creator_id;
  const discoverable = video.status === "published" && ["public", "unlisted"].includes(video.visibility);
  if (!discoverable && !owner) return respond(404, { error: "Video not found" });
  if (!video.video_path || !video.video_path.startsWith(video.creator_id + "/") || video.video_path.includes("..")) return respond(403, { error: "Invalid media object path" });
  const { data: signed, error: signError } = await admin.storage.from("omnitube-videos").createSignedUrl(video.video_path, 900);
  if (signError || !signed?.signedUrl) return respond(404, { error: "Media is not available yet" });
  return respond(200, { signedUrl: signed.signedUrl, expiresIn: 900 });
});