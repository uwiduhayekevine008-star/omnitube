import { createClient } from "npm:@supabase/supabase-js@2.118.0";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const respond = (status: number, payload: Record<string, unknown>) => new Response(JSON.stringify(payload), { status, headers: cors });
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return respond(405, { error: "POST required" });
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get(["SUPABASE", "ANON", "KEY"].join("_")) || "";
  if (!url || !anonKey) return respond(503, { error: "Publishing service is not configured" });
  const authorization = request.headers.get("Authorization") || "";
  const bearer = authorization.replace(/^Bearer\s+/i, "");
  if (!bearer || bearer.startsWith("sb_publishable_")) return respond(401, { error: "Sign-in is required" });
  let input: { videoId?: unknown };
  try { input = await request.json(); } catch { return respond(400, { error: "A valid JSON body is required" }); }
  if (typeof input.videoId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.videoId)) return respond(400, { error: "A valid videoId is required" });
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: auth, error: authError } = await userClient.auth.getUser(bearer);
  if (authError || !auth.user) return respond(401, { error: "Your session is not valid; sign in again" });
  const { data: video, error } = await userClient.from("videos")
    .select("id,creator_id,video_path,status").eq("id", input.videoId).eq("creator_id", auth.user.id).maybeSingle();
  if (error) return respond(500, { error: "Could not load upload record" });
  if (!video) return respond(404, { error: "Upload was not found in your account" });
  if (video.status === "published") return respond(200, { success: true, videoId: video.id });
  if (!["draft", "processing"].includes(video.status)) return respond(409, { error: "This upload cannot be published from its current state" });
  if (!video.video_path || !video.video_path.startsWith(auth.user.id + "/") || video.video_path.includes("..")) return respond(403, { error: "Upload path does not match your account" });
  const slash = video.video_path.lastIndexOf("/");
  const folder = video.video_path.slice(0, slash);
  const filename = video.video_path.slice(slash + 1);
  const { data: objects, error: listError } = await userClient.storage.from("omnitube-videos").list(folder, { search: filename, limit: 50 });
  if (listError) return respond(503, { error: "Could not verify the uploaded media object" });
  if (!(objects || []).some((object) => object.name === filename)) return respond(422, { error: "Video upload is incomplete; finish uploading before publishing" });
  const now = new Date().toISOString();
  const { data: published, error: publishError } = await userClient.from("videos").update({
    status: "published", updated_at: now
  }).eq("id", video.id).eq("creator_id", auth.user.id).select("id,published_at").single();
  if (publishError || !published) return respond(422, { error: "The upload could not be published. Confirm that the uploaded video object is complete and valid." });
  return respond(200, { success: true, videoId: video.id, publishedAt: published.published_at });
});