import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AudioSession, registerGlobals } from "@livekit/react-native";
import * as Notifications from "expo-notifications";
import { routeForNotification, type OmniPushPayload } from "../src/lib/pushNotifications";
import { AuthProvider } from "../src/lib/AuthContext";
import { theme } from "../src/theme";
registerGlobals();
export default function RootLayout() {
  useEffect(() => {
    void AudioSession.startAudioSession();
    const response = Notifications.addNotificationResponseReceivedListener((event) => {
      const data = event.notification.request.content.data as OmniPushPayload;
      const destination = routeForNotification(data);
      if (destination) router.push(destination as never);
    });
    return () => {
      response.remove();
      void AudioSession.stopAudioSession();
    };
  }, []);
  return <AuthProvider><StatusBar style="light" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg }, animation: "fade_from_bottom" }}>
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