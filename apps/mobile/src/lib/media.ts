import { supabase } from "./supabase";
import type { Profile, VideoRow, PostRow, LiveStreamRow } from "./types";

export function formatCount(value: number | string | null | undefined): string {
  const n = Number(value || 0);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "K";
  return new Intl.NumberFormat().format(n);
}
export function timeAgo(value: string | null | undefined): string {
  if (!value) return "Recently";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3_600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86_400) return Math.floor(seconds / 3_600) + "h ago";
  if (seconds < 604_800) return Math.floor(seconds / 86_400) + "d ago";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}
export function initials(name?: string | null): string {
  return (name || "Creator").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}
export async function getSignedThumbnail(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("omnitube-thumbnails").createSignedUrl(path, 3600);
  return error ? null : data.signedUrl;
}
export type PlaybackSource = {
  url: string;
  type: "hls" | "file";
  expiresIn?: number;
};

export async function resolvePlayback(videoId: string): Promise<PlaybackSource> {
  if (!/^[0-9a-f-]{36}$/i.test(videoId)) throw new Error("A valid video ID is required.");
  const { data, error } = await supabase.functions.invoke("resolve-playback", { body: { videoId } });
  if (error) throw error;
  if (!data?.signedUrl || typeof data.signedUrl !== "string") {
    throw new Error(data?.error || "Video playback could not be authorized.");
  }
  return {
    url: data.signedUrl,
    type: data.playbackType === "hls" ? "hls" : "file",
    expiresIn: typeof data.expiresIn === "number" ? data.expiresIn : undefined,
  };
}
export async function hydrateVideos(rows: VideoRow[]): Promise<VideoRow[]> {
  if (!rows.length) return [];
  const ids = Array.from(new Set(rows.map((row) => row.creator_id)));
  const { data: profiles } = await supabase.from("profiles")
    .select("id,username,display_name,avatar_url,bio,website,is_verified,created_at,updated_at")
    .in("id", ids);
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile as Profile]));
  return Promise.all(rows.map(async (row) => ({
    ...row,
    creator: profileMap.get(row.creator_id) || null,
    thumbnailUrl: await getSignedThumbnail(row.thumbnail_path),
  })));
}
export async function hydratePosts(rows: PostRow[], viewerId: string | null = null): Promise<PostRow[]> {
  if (!rows.length) return [];
  const ids = Array.from(new Set(rows.map((row) => row.creator_id)));
  const postIds = rows.map((row) => row.id);
  const [profileResult, reactionResult, commentResult] = await Promise.all([
    supabase.from("profiles").select("id,username,display_name,avatar_url,bio,website,is_verified,created_at,updated_at").in("id", ids),
    supabase.from("post_reactions").select("post_id,user_id").in("post_id", postIds),
    supabase.from("comments").select("post_id").in("post_id", postIds),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (reactionResult.error) throw reactionResult.error;
  if (commentResult.error) throw commentResult.error;
  const profileMap = new Map((profileResult.data || []).map((profile) => [profile.id, profile as Profile]));
  const likes = new Map<string, number>();
  const likedByMe = new Set<string>();
  const comments = new Map<string, number>();
  (reactionResult.data || []).forEach((reaction) => {
    likes.set(reaction.post_id, (likes.get(reaction.post_id) || 0) + 1);
    if (viewerId && reaction.user_id === viewerId) likedByMe.add(reaction.post_id);
  });
  (commentResult.data || []).forEach((comment) => { if (comment.post_id) comments.set(comment.post_id, (comments.get(comment.post_id) || 0) + 1); });
  return rows.map((row) => ({
    ...row,
    creator: profileMap.get(row.creator_id) || null,
    likesCount: likes.get(row.id) || 0,
    commentsCount: comments.get(row.id) || 0,
    likedByMe: likedByMe.has(row.id),
  }));
}
export async function hydrateStreams(rows: LiveStreamRow[]): Promise<LiveStreamRow[]> {
  if (!rows.length) return [];
  const ids = Array.from(new Set(rows.map((row) => row.creator_id)));
  const { data } = await supabase.from("profiles")
    .select("id,username,display_name,avatar_url,bio,website,is_verified,created_at,updated_at").in("id", ids);
  const map = new Map((data || []).map((profile) => [profile.id, profile as Profile]));
  return rows.map((row) => ({ ...row, creator: map.get(row.creator_id) || null }));
}
export async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Sign in again to continue.");
  return data.session.access_token;
}