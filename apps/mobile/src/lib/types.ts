import type { Database } from "../../../../src/lib/database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type VideoRow = Database["public"]["Tables"]["videos"]["Row"] & {
  creator?: Profile | null;
  thumbnailUrl?: string | null;
};
export type PostRow = Database["public"]["Tables"]["posts"]["Row"] & {
  creator?: Profile | null;
  likesCount?: number;
  commentsCount?: number;
};
export type LiveStreamRow = Database["public"]["Tables"]["live_streams"]["Row"] & {
  creator?: Profile | null;
};
export type CommentRow = Database["public"]["Tables"]["comments"]["Row"] & {
  author?: Profile | null;
};
export type StreamMessageRow = Database["public"]["Tables"]["stream_messages"]["Row"] & {
  author?: Profile | null;
};