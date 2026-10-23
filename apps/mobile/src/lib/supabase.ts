import "expo-sqlite/localStorage/install";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../../src/lib/database.types";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

export const isConfigured =
  url.startsWith("https://") && publishableKey.startsWith("sb_publishable_");
export const supabase = createClient<Database>(
  url || "https://configuration-required.invalid",
  publishableKey || "configuration-required",
  {
    auth: {
      storage: globalThis.localStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
    global: { headers: { "X-Client-Info": "omnitube-expo/1.0.0" } },
  }
);
export const liveKitUrl = process.env.EXPO_PUBLIC_LIVEKIT_URL || "";