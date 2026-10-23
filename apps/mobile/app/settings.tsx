import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { clearVideoCacheAsync } from "expo-video";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { AppScreen, ActionButton, Brand, Eyebrow, Surface, ui } from "../src/components/ui";
import { useAuth } from "../src/lib/AuthContext";
import { unregisterDevicePushToken, registerDevicePushToken } from "../src/lib/pushNotifications";
import { supabase } from "../src/lib/supabase";
import { readDevicePreferences, setDevicePreference, type DevicePreferences } from "../src/lib/preferences";
import { theme } from "../src/theme";

function SettingRow({ icon, title, detail, tint = theme.mint, action }: {
  icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; tint?: string; action?: ReactNode;
}) {
  return <View style={styles.row}><View style={[styles.iconBox,{backgroundColor:tint+"15"}]}><Ionicons name={icon} size={18} color={tint}/></View><View style={styles.copy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View>{action}</View>;
}

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const [pushPermission, setPushPermission] = useState("Checking…");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushRegistered, setPushRegistered] = useState(false);
  const [preferences, setPreferences] = useState<DevicePreferences>(() => readDevicePreferences());
  const [clearCacheBusy, setClearCacheBusy] = useState(false);
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const pushConfigured = Boolean(projectId && projectId !== "CONFIGURE_WITH_EAS_INIT");

  const refreshPushState = useCallback(async () => {
    const permission = await Notifications.getPermissionsAsync();
    setPushPermission(permission.granted ? "Allowed on this device" : permission.canAskAgain ? "Not enabled" : "Blocked in system settings");
    if (user?.id) {
      const { data } = await supabase.from("device_push_tokens").select("id").eq("user_id",user.id).limit(1);
      setPushRegistered(Boolean(data?.length));
    } else setPushRegistered(false);
  },[user?.id]);

  useEffect(()=>{void refreshPushState();},[refreshPushState]);

  const updatePreference = (key: keyof DevicePreferences, value: boolean) => {
    try { setPreferences(setDevicePreference(key, value)); }
    catch (error) { Alert.alert("Preference was not saved", error instanceof Error ? error.message : "Please try again."); }
  };

  const enablePush = async () => {
    if (!user?.id) { Alert.alert("Sign in required","Sign in before registering this device for account activity alerts."); return; }
    if (!pushConfigured) {
      Alert.alert("Link the mobile app to Expo", "Run npx eas-cli login and npx eas-cli init from apps/mobile to create a valid EAS project ID. Then rebuild the native development client to activate remote push delivery.");
      return;
    }
    setPushBusy(true);
    try {
      const registered = await registerDevicePushToken(user.id);
      await refreshPushState();
      if (registered) Alert.alert("Notifications enabled","This device is registered for new follows, reactions, comments and reposts.");
      else Alert.alert("Permission needed","Allow notifications in your device settings, then return here and try again.");
    } catch (error) {
      Alert.alert("Could not enable notifications",error instanceof Error?error.message:"Please try again.");
    } finally {setPushBusy(false);}
  };

  const disablePush = async () => {
    if (!user?.id) return;
    setPushBusy(true);
    try {
      await unregisterDevicePushToken(user.id);
      await refreshPushState();
      Alert.alert("Push registration removed","This device will no longer be targeted by OmniTube activity pushes.");
    } catch(error) {
      Alert.alert("Could not update notifications",error instanceof Error?error.message:"Please try again.");
    } finally {setPushBusy(false);}
  };

  const clearCache = async () => {
    Alert.alert("Clear downloaded video cache?", "This removes cached playback data from this device. It does not delete your uploads or Watch later list.", [
      {text:"Cancel",style:"cancel"},
      {text:"Clear cache",style:"destructive",onPress:()=>void performClearCache()},
    ]);
  };
  const performClearCache = async () => {
    setClearCacheBusy(true);
    try {
      await clearVideoCacheAsync();
      Alert.alert("Cache cleared","Local video cache has been cleared.");
    } catch(error) {
      Alert.alert("Could not clear cache",error instanceof Error?error.message:"The video cache could not be cleared.");
    } finally { setClearCacheBusy(false); }
  };

  const confirmSignOut = () => Alert.alert("Sign out of OmniTube?", "Your videos and creator profile remain online.", [
    {text:"Cancel",style:"cancel"},
    {text:"Sign out",style:"destructive",onPress:()=>void signOut().then(()=>router.replace("/(tabs)/profile")).catch(error=>Alert.alert("Sign out failed",error.message))},
  ]);

  return <AppScreen style={{paddingTop:0}}>
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}><Pressable onPress={()=>router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={theme.text}/></Pressable><Brand/><View style={{width:36}}/></View>
      <Eyebrow>PERSONALIZATION / DEVICE</Eyebrow>
      <Text style={styles.heading}>Settings & control.</Text>
      <Text style={styles.subheading}>Control how OmniTube behaves on this device and how it keeps you connected.</Text>

      <Text style={styles.section}>Notifications</Text>
      <Surface style={styles.panel}>
        <SettingRow icon="notifications-outline" title="Push notifications" tint={theme.coral} detail={pushPermission + (pushRegistered ? " · Server token registered" : "")}/>
        <View style={ui.separator}/>
        <SettingRow icon="phone-portrait-outline" title="Remote delivery setup" tint={theme.violet} detail={pushConfigured ? "Expo project linked" : "EAS project ID not linked yet"}/>
        <Text style={styles.explainer}>Push messages are dispatched securely from Supabase through Expo Push Service. Device tokens are private and scoped to your account.</Text>
        <ActionButton title={pushRegistered?"Refresh notification registration":"Enable notifications"} icon="notifications" busy={pushBusy} onPress={()=>void enablePush()} />
        {pushRegistered ? <ActionButton title="Disable on this device" icon="notifications-off-outline" variant="quiet" busy={pushBusy} onPress={()=>void disablePush()}/> : null}
        {!pushConfigured ? <Text style={styles.setupHint}>First-time setup: run npx eas-cli init inside apps/mobile, then build a development client. Expo Go cannot receive Android remote push notifications.</Text> : null}
      </Surface>

      <Text style={styles.section}>Playback & interaction</Text>
      <Surface style={styles.panel}>
        <SettingRow icon="play-circle-outline" title="Autoplay in Shorts" detail="Automatically play the active Short as you swipe" action={<Switch value={preferences.autoPlayShorts} onValueChange={(v)=>updatePreference("autoPlayShorts",v)} trackColor={{false:theme.panel3,true:"#63EAC85A"}} thumbColor={preferences.autoPlayShorts?theme.mint:"#AAB1C4"}/>}/>
        <View style={ui.separator}/>
        <SettingRow icon="phone-portrait-outline" title="Haptic feedback" detail="Use subtle feedback for key interactions" action={<Switch value={preferences.hapticsEnabled} onValueChange={(v)=>updatePreference("hapticsEnabled",v)} trackColor={{false:theme.panel3,true:"#63EAC85A"}} thumbColor={preferences.hapticsEnabled?theme.mint:"#AAB1C4"}/>}/>
        <View style={ui.separator}/>
        <SettingRow icon="cellular-outline" title="Reduce data usage" tint={theme.blue} detail="Prefer lighter thumbnails and avoid unnecessary preloading" action={<Switch value={preferences.reduceDataUsage} onValueChange={(v)=>updatePreference("reduceDataUsage",v)} trackColor={{false:theme.panel3,true:"#63EAC85A"}} thumbColor={preferences.reduceDataUsage?theme.mint:"#AAB1C4"}/>}/>
        <View style={ui.separator}/>
        <SettingRow icon="cloud-download-outline" title="Playback cache" tint={theme.blue} detail="Clear video playback cache stored on this device"/>
        <ActionButton title="Clear video cache" icon="trash-outline" variant="quiet" busy={clearCacheBusy} onPress={()=>void clearCache()}/>
        <Text style={styles.setupHint}>Playback, haptic and data-saving choices are stored locally on this device and do not alter account privacy.</Text>
      </Surface>

      <Text style={styles.section}>Privacy & account</Text>
      <Surface style={styles.panel}>
        <SettingRow icon="lock-closed-outline" title="Account session" detail={user?.email || "No account signed in"} tint={theme.violet}/>
        <View style={ui.separator}/>
        <SettingRow icon="shield-checkmark-outline" title="Content privacy" detail="Private uploads and thumbnails use signed access" tint={theme.mint}/>
        <View style={ui.separator}/>
        <Pressable onPress={()=>router.push("/library?mode=saved")}><SettingRow icon="bookmark-outline" title="Your saved library" detail="Review your private Watch later collection" tint={theme.blue} action={<Ionicons name="chevron-forward" size={16} color={theme.subtle}/>}/></Pressable>
        <View style={ui.separator}/>
        <Pressable onPress={()=>router.push("/notifications")}><SettingRow icon="notifications-outline" title="Activity inbox" detail="View alerts and mark them as read" tint={theme.coral} action={<Ionicons name="chevron-forward" size={16} color={theme.subtle}/>}/></Pressable>
        {user ? <View style={{marginTop:12}}><ActionButton title="Sign out of OmniTube" icon="log-out-outline" variant="danger" onPress={confirmSignOut}/></View> : null}
      </Surface>

      <View style={styles.version}><Brand compact/><Text style={styles.versionText}>OmniTube Mobile · {Constants.expoConfig?.version || "1.0.0"} · Expo SDK 58</Text><Text style={styles.versionSub}>Built for creators. Designed for every screen.</Text></View>
    </ScrollView>
  </AppScreen>;
}
const styles=StyleSheet.create({
  page:{paddingHorizontal:16,paddingBottom:35},
  header:{paddingTop:12,paddingBottom:22,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  back:{width:36,height:36,borderRadius:11,borderColor:theme.line,borderWidth:1,alignItems:"center",justifyContent:"center"},
  heading:{color:theme.text,fontSize:30,fontWeight:"900",letterSpacing:-1.2,marginTop:9},
  subheading:{color:theme.muted,fontSize:11,lineHeight:18,marginTop:8,maxWidth:340},
  section:{color:theme.text,fontSize:15,fontWeight:"900",marginTop:23,marginBottom:10},
  panel:{paddingVertical:5,gap:9},
  row:{flexDirection:"row",alignItems:"center",gap:11,minHeight:59},
  iconBox:{width:36,height:36,borderRadius:11,justifyContent:"center",alignItems:"center"},
  copy:{flex:1},
  rowTitle:{color:theme.text,fontSize:11,fontWeight:"800"},
  rowDetail:{color:theme.muted,fontSize:9,lineHeight:14,marginTop:4},
  explainer:{color:theme.muted,fontSize:10,lineHeight:16,marginVertical:3},
  setupHint:{color:theme.subtle,fontSize:9,lineHeight:15,marginTop:2},
  version:{alignItems:"center",paddingTop:28,gap:9},
  versionText:{color:theme.muted,fontSize:10,fontWeight:"800"},
  versionSub:{color:theme.subtle,fontSize:9},
});