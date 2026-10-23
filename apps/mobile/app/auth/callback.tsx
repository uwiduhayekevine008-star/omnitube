import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
export default function AuthCallback() {
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [message, setMessage] = useState("Securing your sign-in…");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (params.error_description) throw new Error(params.error_description);
        if (!params.code) throw new Error("The sign-in link is missing its authorization code. Request a new link.");
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);
        if (error) throw error;
        if (active) { setMessage("You're signed in. Welcome to OmniTube."); router.replace("/(tabs)/profile"); }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Sign-in could not be completed.");
      }
    })();
    return () => { active = false; };
  }, [params.code, params.error_description]);
  return <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: 28, gap: 18 }}>
    <ActivityIndicator size="large" color={theme.mint} />
    <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700", textAlign: "center" }}>{message}</Text>
    {message !== "Securing your sign-in…" && <Text onPress={() => router.replace("/(tabs)/profile")} style={{ color: theme.mint, fontWeight: "800" }}>Back to OmniTube</Text>}
  </View>;
}