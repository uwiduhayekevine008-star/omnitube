import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AudioSession, registerGlobals } from "@livekit/react-native";
import { AuthProvider } from "../src/lib/AuthContext";
import { theme } from "../src/theme";
registerGlobals();
export default function RootLayout() {
  useEffect(() => {
    void AudioSession.startAudioSession();
    return () => { void AudioSession.stopAudioSession(); };
  }, []);
  return <AuthProvider><StatusBar style="light" backgroundColor={theme.bg} /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg }, animation: "fade_from_bottom" }}>
    <Stack.Screen name="(tabs)" />
    <Stack.Screen name="watch/[id]" options={{ animation: "slide_from_bottom" }} />
    <Stack.Screen name="creator/[id]" options={{ animation: "slide_from_right" }} />
    <Stack.Screen name="community/[id]" options={{ animation: "slide_from_bottom" }} />
    <Stack.Screen name="live/[id]" options={{ presentation: "fullScreenModal", animation: "slide_from_bottom", gestureEnabled: false }} />
    <Stack.Screen name="auth/callback" options={{ presentation: "modal" }} />
    <Stack.Screen name="notifications" options={{ animation: "slide_from_right" }} />
    <Stack.Screen name="history" options={{ animation: "slide_from_right" }} />
    <Stack.Screen name="library" options={{ animation: "slide_from_right" }} />
    <Stack.Screen name="library/[id]" options={{ animation: "slide_from_right" }} />
  </Stack></AuthProvider>;
}