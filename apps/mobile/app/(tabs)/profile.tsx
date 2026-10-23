import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { AppScreen, ActionButton, Avatar, Brand, EmptyState, Eyebrow, SectionTitle, Surface, ui } from "../../src/components/ui";
import VideoCard from "../../src/components/VideoCard";
import { useAuth } from "../../src/lib/AuthContext";
import { formatCount, hydrateVideos } from "../../src/lib/media";
import { supabase } from "../../src/lib/supabase";
import type { VideoRow } from "../../src/lib/types";
import { theme } from "../../src/theme";

export default function ProfileScreen() {
  const { user, profile, loading, signInWithEmail, signOut, refreshProfile } = useAuth();
  const [email, setEmail] = useState("");
  const [sendingLink, setSendingLink] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [savedVideos, setSavedVideos] = useState<VideoRow[]>([]);
  const [stats, setStats] = useState({ videos: 0, followers: 0, following: 0, views: 0 });
  const [pageLoading, setPageLoading] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.display_name || "");
    setUsername(profile?.username || "");
    setBio(profile?.bio || "");
  }, [profile?.id, profile?.display_name, profile?.username, profile?.bio]);

  const loadCreatorData = useCallback(async () => {
    if (!user) { setVideos([]); setSavedVideos([]); return; }
    setPageLoading(true);
    const [uploads, followers, following, playlist] = await Promise.all([
      supabase.from("videos").select("*").eq("creator_id", user.id).order("created_at", { ascending: false }).limit(24),
      supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("creator_id", user.id),
      supabase.from("follows").select("creator_id", { count: "exact", head: true }).eq("follower_id", user.id),
      supabase.from("playlists").select("id").eq("owner_id", user.id).eq("title", "Watch later").maybeSingle(),
    ]);
    const videoRows = (uploads.data || []) as VideoRow[];
    const hydrated = await hydrateVideos(videoRows);
    setVideos(hydrated);
    const views = videoRows.reduce((sum, row) => sum + Number(row.views_count || 0), 0);
    setStats({ videos: videoRows.filter((row) => row.status === "published").length, followers: followers.count || 0, following: following.count || 0, views });
    if (playlist.data) {
      const { data: items } = await supabase.from("playlist_items").select("video_id,position").eq("playlist_id", playlist.data.id).order("position", { ascending: true }).limit(100);
      const ids = (items || []).map((item) => item.video_id);
      if (ids.length) {
        const { data: found } = await supabase.from("videos").select("*").in("id", ids);
        const saved = await hydrateVideos((found || []) as VideoRow[]);
        setSavedVideos(ids.map((id) => saved.find((row) => row.id === id)).filter(Boolean) as VideoRow[]);
      } else setSavedVideos([]);
    } else setSavedVideos([]);
    setPageLoading(false);
  }, [user?.id]);

  useEffect(() => { void loadCreatorData(); }, [loadCreatorData]);

  const requestLink = async () => {
    try {
      setSendingLink(true);
      await signInWithEmail(email);
      Alert.alert("Check your email", "A secure OmniTube sign-in link has been sent. Open it on this device to finish signing in.");
    } catch (error) {
      Alert.alert("Could not send sign-in link", error instanceof Error ? error.message : "Please try again.");
    } finally { setSendingLink(false); }
  };

  const saveProfile = async () => {
    if (!user || savingProfile) return;
    const cleanName = displayName.trim();
    const cleanUsername = username.trim().replace(/^@/, "").toLowerCase();
    if (cleanName.length < 1 || cleanName.length > 80) { Alert.alert("Name is required", "Use between 1 and 80 characters."); return; }
    if (cleanUsername && !/^[a-z0-9_]{3,24}$/.test(cleanUsername)) { Alert.alert("Username format", "Use 3–24 lowercase letters, numbers, or underscores."); return; }
    setSavingProfile(true);
    const { error } = await supabase.from("profiles").update({ display_name: cleanName, username: cleanUsername || null, bio: bio.trim().slice(0, 500), updated_at: new Date().toISOString() }).eq("id", user.id);
    setSavingProfile(false);
    if (error) Alert.alert("Profile not saved", error.message);
    else { await refreshProfile(); setEditMode(false); Alert.alert("Profile updated", "Your creator identity is saved."); }
  };

  if (loading) return <AppScreen><View style={styles.loading}><ActivityIndicator color={theme.mint}/></View></AppScreen>;

  if (!user) return <AppScreen style={{ paddingTop: 0 }}>
    <ScrollView contentContainerStyle={styles.loginPage} keyboardShouldPersistTaps="handled">
      <View style={styles.loginHeader}><Brand/><View style={styles.loginSpark}><Ionicons name="sparkles" size={19} color={theme.violet}/></View></View>
      <View style={styles.loginArt}><View style={styles.loginOrbit}/><View style={styles.loginPlay}><Ionicons name="play" size={33} color="#081510"/></View><View style={styles.loginOrbitTwo}/></View>
      <Eyebrow>YOUR ACCOUNT. YOUR WORLD.</Eyebrow>
      <Text style={styles.loginTitle}>Come make{"\n"}some noise.</Text>
      <Text style={styles.loginDescription}>Your creators, your saved videos, your uploads and your community activity—all in one place.</Text>
      <Surface style={styles.loginCard}>
        <Text style={styles.loginCardTitle}>Sign in with a magic link</Text>
        <Text style={styles.loginCardText}>No password to remember. We’ll email you a secure, one-time link.</Text>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={theme.subtle} style={ui.input}/>
        <ActionButton title="Email me a sign-in link" icon="mail-outline" busy={sendingLink} onPress={() => void requestLink()}/>
        <Text style={styles.securityNote}><Ionicons name="shield-checkmark-outline" size={13} color={theme.mint}/> Protected by Supabase Auth and row-level security.</Text>
      </Surface>
      <Text style={styles.terms}>By continuing, you agree to participate respectfully and follow the OmniTube community guidelines.</Text>
    </ScrollView>
  </AppScreen>;

  return <AppScreen style={{ paddingTop: 0 }}>
    <FlatList
      data={videos.filter((row) => row.status === "published")}
      numColumns={2} keyExtractor={(item) => item.id}
      columnWrapperStyle={{ gap: 12, alignItems: "flex-start" }}
      contentContainerStyle={styles.profileList}
      renderItem={({ item }) => <VideoCard video={item}/>}
      ListHeaderComponent={<View>
        <View style={styles.header}><Brand/><Pressable onPress={() => router.push("/notifications")} style={styles.headerIcon}><Ionicons name="notifications-outline" size={21} color={theme.text}/></Pressable></View>
        <View style={styles.profileHero}>
          <View style={styles.profileHeroTop}><Avatar profile={profile} size={75}/><View style={{ flex: 1 }}><Eyebrow>CREATOR PROFILE</Eyebrow><Text style={styles.displayName}>{profile?.display_name || user.email?.split("@")[0] || "Creator"}</Text><Text style={styles.handle}>{profile?.username ? "@" + profile.username : user.email}</Text></View><Pressable onPress={() => setEditMode((value) => !value)} style={styles.editIcon}><Ionicons name={editMode ? "close" : "create-outline"} size={19} color={theme.mint}/></Pressable></View>
          {profile?.bio && !editMode ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          <View style={styles.stats}>
            <View><Text style={styles.statValue}>{formatCount(stats.videos)}</Text><Text style={styles.statLabel}>VIDEOS</Text></View>
            <View><Text style={styles.statValue}>{formatCount(stats.followers)}</Text><Text style={styles.statLabel}>FOLLOWERS</Text></View>
            <View><Text style={styles.statValue}>{formatCount(stats.following)}</Text><Text style={styles.statLabel}>FOLLOWING</Text></View>
            <View><Text style={styles.statValue}>{formatCount(stats.views)}</Text><Text style={styles.statLabel}>VIEWS</Text></View>
          </View>
        </View>
        {editMode && <Surface style={styles.editForm}>
          <Text style={styles.formLabel}>DISPLAY NAME</Text><TextInput value={displayName} onChangeText={setDisplayName} maxLength={80} style={ui.input} placeholder="Creator name" placeholderTextColor={theme.subtle}/>
          <Text style={styles.formLabel}>USERNAME</Text><TextInput value={username} onChangeText={setUsername} autoCapitalize="none" maxLength={24} style={ui.input} placeholder="creator_handle" placeholderTextColor={theme.subtle}/>
          <Text style={styles.formLabel}>BIO</Text><TextInput value={bio} onChangeText={setBio} multiline maxLength={500} style={[ui.input, ui.multiline]} placeholder="Tell people what you create…" placeholderTextColor={theme.subtle}/>
          <ActionButton title="Save creator profile" icon="checkmark-circle-outline" busy={savingProfile} onPress={() => void saveProfile()}/>
        </Surface>}
        <View style={styles.quickActions}>
          <Pressable style={styles.quickAction} onPress={() => router.push("/notifications")}><View style={styles.quickIcon}><Ionicons name="notifications-outline" size={19} color={theme.violet}/></View><Text style={styles.quickLabel}>Notifications</Text><Ionicons name="chevron-forward" size={17} color={theme.subtle}/></Pressable>
          <Pressable style={styles.quickAction} onPress={() => router.push("/(tabs)/create")}><View style={styles.quickIcon}><Ionicons name="cloud-upload-outline" size={19} color={theme.mint}/></View><Text style={styles.quickLabel}>Creator Studio</Text><Ionicons name="chevron-forward" size={17} color={theme.subtle}/></Pressable>
          <Pressable style={styles.quickAction} onPress={() => { void signOut().then(() => Alert.alert("Signed out", "Your OmniTube account has been signed out.")).catch((error) => Alert.alert("Could not sign out", error.message)); }}><View style={styles.quickIcon}><Ionicons name="log-out-outline" size={19} color={theme.coral}/></View><Text style={styles.quickLabel}>Sign out</Text><Ionicons name="chevron-forward" size={17} color={theme.subtle}/></Pressable>
        </View>
        <SectionTitle title="Watch later" detail="Your private, cross-device saved library." action={savedVideos.length ? <Text style={styles.countLabel}>{savedVideos.length} saved</Text> : null}/>
        {savedVideos.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedStrip}>{savedVideos.slice(0, 10).map((row) => <View key={row.id} style={styles.savedCard}><VideoCard video={row}/></View>)}</ScrollView> : <Text style={styles.smallMuted}>Videos you save from the feed and player will appear here.</Text>}
        <SectionTitle title="Your uploads" detail="Manage content you have published."/>
        {pageLoading ? <ActivityIndicator color={theme.mint} style={{ marginVertical: 18 }}/> : null}
        {videos.length === 0 ? <EmptyState icon="videocam-outline" title="Your channel starts here." detail="Upload a video or a Short to build your creator universe." action={<ActionButton title="Create your first video" icon="cloud-upload-outline" onPress={() => router.push("/(tabs)/create")}/>}/> : null}
      </View>}
      ListFooterComponent={<View style={{ height: 20 }}/>}
      />
  </AppScreen>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  loginPage: { paddingHorizontal: 19, paddingBottom: 35 },
  loginHeader: { paddingTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  loginSpark: { width: 37, height: 37, borderRadius: 12, backgroundColor: "#A99AFF12", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#A99AFF24" },
  loginArt: { height: 205, alignItems: "center", justifyContent: "center", position: "relative", marginVertical: 17, overflow: "hidden" },
  loginOrbit: { position: "absolute", width: 210, height: 160, borderRadius: 110, borderWidth: 1, borderColor: "#A99AFF27", transform: [{ rotate: "-24deg" }] },
  loginOrbitTwo: { position: "absolute", width: 255, height: 180, borderRadius: 120, borderWidth: 1, borderColor: "#63EAC820", transform: [{ rotate: "35deg" }] },
  loginPlay: { width: 98, height: 98, borderRadius: 30, alignItems: "center", justifyContent: "center", backgroundColor: theme.mint, borderColor: "#A99AFF44", borderWidth: 1 },
  loginTitle: { color: theme.text, fontWeight: "900", fontSize: 39, lineHeight: 42, letterSpacing: -1.7, marginTop: 10 },
  loginDescription: { color: theme.muted, fontSize: 12, lineHeight: 20, marginTop: 11, marginBottom: 19, maxWidth: 365 },
  loginCard: { gap: 11 },
  loginCardTitle: { color: theme.text, fontSize: 14, fontWeight: "900" },
  loginCardText: { color: theme.muted, fontSize: 10, lineHeight: 16, marginBottom: 2 },
  securityNote: { color: theme.subtle, fontSize: 9, lineHeight: 15, textAlign: "center" },
  terms: { color: theme.subtle, textAlign: "center", fontSize: 9, lineHeight: 15, marginTop: 18, paddingHorizontal: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 13, paddingBottom: 14 },
  headerIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.line, borderRadius: 11, backgroundColor: theme.panel },
  profileList: { paddingHorizontal: 15, paddingBottom: 22 },
  profileHero: { padding: 15, backgroundColor: theme.panel, borderRadius: 17, borderWidth: 1, borderColor: theme.line },
  profileHeroTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  displayName: { color: theme.text, fontSize: 18, fontWeight: "900", marginTop: 4 },
  handle: { color: theme.muted, fontSize: 10, marginTop: 5 },
  editIcon: { width: 35, height: 35, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel2 },
  bio: { color: "#C4CBDB", fontSize: 11, lineHeight: 18, marginTop: 14 },
  stats: { flexDirection: "row", justifyContent: "space-between", gap: 6, marginTop: 17, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.line },
  statValue: { color: theme.text, fontSize: 17, fontWeight: "900" },
  statLabel: { color: theme.subtle, fontSize: 8, fontWeight: "900", letterSpacing: 0.8, marginTop: 5 },
  editForm: { marginTop: 12, gap: 10 },
  formLabel: { color: theme.muted, fontSize: 9, letterSpacing: 1.1, fontWeight: "900", marginTop: 5 },
  quickActions: { marginTop: 13, borderWidth: 1, borderColor: theme.line, borderRadius: 14, overflow: "hidden", backgroundColor: theme.panel },
  quickAction: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: theme.line },
  quickIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.panel2 },
  quickLabel: { flex: 1, color: theme.text, fontSize: 11, fontWeight: "800" },
  countLabel: { color: theme.mint, fontSize: 10, fontWeight: "800" },
  savedStrip: { gap: 12 },
  savedCard: { width: 260 },
  smallMuted: { color: theme.subtle, fontSize: 10, lineHeight: 16, marginBottom: 5 },
});