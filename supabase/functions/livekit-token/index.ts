import { AccessToken } from "npm:livekit-server-sdk@2.13.1";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const respond = (status: number, payload: Record<string, unknown>) => new Response(JSON.stringify(payload), { status, headers: cors });
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return respond(405, { error: "POST required" });
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get(["SUPABASE", "ANON", "KEY"].join("_")) || "";
  const apiKey = Deno.env.get(["LIVEKIT", "API", "KEY"].join("_")) || "";
  const apiSecret = Deno.env.get(["LIVEKIT", "API", "SECRET"].join("_")) || "";
  if (!url || !anonKey) return respond(503, { error: "Supabase server configuration is missing" });
  if (!apiKey || !apiSecret) return respond(503, { error: "LiveKit server credentials are not configured in Edge Function secrets" });
  const authorization = request.headers.get("Authorization") || "";
  const bearer = authorization.replace(/^Bearer\s+/i, "");
  if (!bearer || bearer.startsWith("sb_publishable_")) return respond(401, { error: "Sign-in is required" });
  const client = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await client.auth.getUser(bearer);
  if (authError || !auth.user) return respond(401, { error: "Your session is not valid; sign in again" });
  let input: { streamId?: unknown; role?: unknown };
  try { input = await request.json(); } catch { return respond(400, { error: "A valid JSON body is required" }); }
  if (typeof input.streamId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.streamId)) return respond(400, { error: "A valid streamId is required" });
  if (input.role !== "publisher" && input.role !== "viewer") return respond(400, { error: "Unsupported room role" });
  const { data: stream, error } = await client.from("live_streams")
    .select("id,creator_id,room_name,status,visibility,title").eq("id", input.streamId).maybeSingle();
  if (error) return respond(500, { error: "Could not load live room permissions" });
  if (!stream) return respond(404, { error: "Live room not found" });
  const isOwner = stream.creator_id === auth.user.id;
  if (input.role === "publisher" && !isOwner) return respond(403, { error: "Only the channel owner can broadcast" });
  if (input.role === "publisher" && !["live", "scheduled"].includes(stream.status)) return respond(409, { error: "This stream is not available for broadcasting" });
  if (input.role === "viewer" && (!["public", "unlisted"].includes(stream.visibility) || stream.status !== "live")) return respond(403, { error: "This live room is not available to viewers" });
  const { data: profile } = await client.from("profiles").select("display_name").eq("id", auth.user.id).maybeSingle();
  const token = new AccessToken(apiKey, apiSecret, { identity: auth.user.id, name: profile?.display_name || auth.user.email || "OmniTube creator", ttl: "1h" });
  token.addGrant({
    roomJoin: true, room: stream.room_name,
    canPublish: input.role === "publisher" && isOwner,
    canSubscribe: true, canPublishData: true
  });
  return respond(200, { token: await token.toJwt(), roomName: stream.room_name, role: input.role });
});