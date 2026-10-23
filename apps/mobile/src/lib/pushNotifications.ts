import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export type OmniPushPayload = {
  notificationId?: string;
  entityType?: string | null;
  entityId?: string | null;
  kind?: string;
};

export function routeForNotification(data: OmniPushPayload): string | null {
  if (!data.entityId) return "/notifications";
  const id = encodeURIComponent(data.entityId);
  if (data.entityType === "video") return "/watch/" + id;
  if (data.entityType === "post") return "/community/" + id;
  if (data.entityType === "stream") return "/live/" + id;
  if (data.entityType === "profile") return "/creator/" + id;
  return "/notifications";
}

export async function registerDevicePushToken(userId: string): Promise<boolean> {
  if (!Device.isDevice || Platform.OS === "web") return false;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId || projectId === "CONFIGURE_WITH_EAS_INIT") return false;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("omnitube-activity", {
      name: "OmniTube activity",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 200, 250],
      lightColor: "#63EAC8",
      sound: "default",
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const permissions = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!permissions.granted) return false;

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  const platform = Platform.OS === "ios" ? "ios" : "android";
  const { error } = await supabase.from("device_push_tokens").upsert({
    user_id: userId,
    expo_push_token: token.data,
    platform,
    device_name: (Device.deviceName || Device.modelName || "Mobile device").slice(0, 160),
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,expo_push_token" });
  if (error) throw error;
  return true;
}

export async function unregisterDevicePushToken(userId: string): Promise<void> {
  if (!Device.isDevice || Platform.OS === "web") return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId || projectId === "CONFIGURE_WITH_EAS_INIT") return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  const { error } = await supabase.from("device_push_tokens")
    .delete().eq("user_id", userId).eq("expo_push_token", token.data);
  if (error) throw error;
}

export async function presentForegroundActivity(data: OmniPushPayload, title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: "default",
      ...(Platform.OS === "android" ? { channelId: "omnitube-activity" } : {}),
    },
    trigger: null,
  });
}