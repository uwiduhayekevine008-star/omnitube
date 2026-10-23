import { createClient } from "@supabase/supabase-js";
const env = import.meta.env as ImportMetaEnv;
export const supabaseUrl = env.VITE_SUPABASE_URL || "";
export const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
export const isSupabaseConfigured = Boolean(supabaseUrl.startsWith("https://") && supabasePublishableKey.startsWith("sb_publishable_"));
export const supabase = createClient(
  supabaseUrl || "https://configuration-required.invalid",
  supabasePublishableKey || "configuration-required",
  { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true, flowType: "pkce" },
    global: { headers: { "X-Client-Info": "omnitube-web/1.0.0" } } }
);
export const storagePublicUrl = (path: string | null | undefined) => path ? supabase.storage.from("omnitube-assets").getPublicUrl(path).data.publicUrl : "";
export const formatCount = (value: number | string | null | undefined) => {
  const n = Number(value || 0);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "K";
  return new Intl.NumberFormat().format(n);
};
export const timeAgo = (value: string | null | undefined) => {
  if (!value) return "Recently";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  if (seconds < 604800) return Math.floor(seconds / 86400) + "d ago";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
};