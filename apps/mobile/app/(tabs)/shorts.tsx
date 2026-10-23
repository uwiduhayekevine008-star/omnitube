import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";
import * as Haptics from "expo-haptics";
import { AppScreen, Avatar, Brand, EmptyState } from "../../src/components/ui";
import { useAuth } from "../../src/lib/AuthContext";
import { formatCount, hydrateVideos, resolvePlayback, timeAgo } from "../../src/lib/media";
import { supabase } from "../../src/lib/supabase";
import type { VideoRow } from "../../src/lib/types";
import { theme } from "../../src/theme";

function ShortSlide({ video, active, userId, onLike, onSave }: { video: VideoRow; active: boolean; userId: string | null; onLike: () => void; onSave: () => void }) {
  const [playback, setPlayback] = useState("");
  const [playbackError, setPlaybackError] = useState("");
  const [liked, setLiked] = useState(false);
  const player = useVideoPlayer(null, (instance) => { instance.loop = true; instance.muted = false; });
  useEffect(() => {
    let activeRequest = true;
    if (!active) { player.pause(); return () => { activeRequest = false; }; }
    setPlaybackError("");
    void resolvePlayback(video.id).then((url) => {
      if (!activeRequest) return;
      setPlayback(url);
      return player.replaceAsync({ uri: url }).then(() => { if (activeRequest) player.play(); });
    }).catch((error) => { if (activeRequest) setPlaybackError(error instanceof Error ? error.message : "Playback could not be loaded."); });
    return () => { activeRequest = false; player.pause(); };
  }, [active, video.id, player]);
  useEffect(() => {
    let alive = true;
    if (!active || !userId) { setLiked(false); return () => { alive = false; }; }
    void supabase.from("video_reactions").select("reaction").eq("video_id", video.id).eq("user_id", userId).maybeSingle()
      .then(({ data }) => { if (alive) setLiked(data?.reaction === "like" || data?.reaction === "heart"); });
    return () => { alive = false; };
  }, [active, userId, video.id]);

  return <View style={styles.slide}>
    {active && playback ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} /> : <View style={styles.videoFallback}><View style={styles.fallbackOrb} /><Ionicons name="play" size={32} color={theme.violet} /></View>}
    <View style={styles.gradientTop}><Brand compact /><View style={styles.shortsWord}><Ionicons name="flash" size={14} color={theme.mint} /><Text style={styles.shortsWordText}>OMNI SHORTS</Text></View></View>
    {playbackError ? <View style={styles.playbackError}><Ionicons name="alert-circle-outline" size={23} color={theme.coral}/><Text style={styles.playbackErrorText}>{playbackError}</Text></View> : !playback && active ? <View style={styles.preparing}><ActivityIndicator color={theme.mint}/><Text style={styles.preparingText}>Preparing secure playback…</Text></View> : null}
    <View style={styles.bottomGradient}>
      <View style={styles.bottomCopy}>
        <Pressable onPress={() => router.push({ pathname: "/creator/[id]", params: { id: video.creator_id } })} style={styles.creatorRow}>
          <Avatar profile={video.creator} size={36}/><Text style={styles.creatorName}>{video.creator?.display_name || "Creator"}</Text>
          {video.creator?.is_verified && <Ionicons name="checkmark-circle" size={14} color={theme.mint}/>}
        </Pressable>
        <Text style={styles.videoTitle} numberOfLines={3}>{video.title}</Text>
        {video.description ? <Text style={styles.videoDescription} numberOfLines={2}>{video.description}</Text> : null}
        <View style={styles.videoStats}><Ionicons name="eye-outline" size={13} color="#C5C9D8"/><Text style={styles.videoStatsText}>{formatCount(video.views_count)} views · {timeAgo(video.published_at || video.created_at)}</Text></View>
        <Pressable onPress={() => router.push({ pathname: "/watch/[id]", params: { id: video.id } })} style={styles.fullVideo}><Ionicons name="open-outline" size={14} color={theme.mint}/><Text style={styles.fullVideoText}>Open full video & comments</Text></Pressable>
      </View>
      <View style={styles.actionRail}>
        <Pressable style={styles.railAction} onPress={async () => { await Haptics.selectionAsync(); setLiked((old) => !old); onLike(); }}><View style={[styles.railIcon, liked && styles.likedIcon]}><Ionicons name={liked ? "heart" : "heart-outline"} size={23} color={liked ? theme.coral : theme.text}/></View><Text style={styles.railLabel}>Like</Text></Pressable>
        <Pressable style={styles.railAction} onPress={() => router.push({ pathname: "/watch/[id]", params: { id: video.id } })}><View style={styles.railIcon}><Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.text}/></View><Text style={styles.railLabel}>Discuss</Text></Pressable>
        <Pressable style={styles.railAction} onPress={onSave}><View style={styles.railIcon}><Ionicons name="bookmark-outline" size={22} color={theme.text}/></View><Text style={styles.railLabel}>Save</Text></Pressable>
        <Pressable style={styles.railAction} onPress={() => void Share.share({ message: video.title + "\n" + "https://omnitube.app/watch/" + video.id })}><View style={styles.railIcon}><Ionicons name="arrow-redo-outline" size={22} color={theme.text}/></View><Text style={styles.railLabel}>Share</Text></Pressable>
      </View>
    </View>
  </View>;
}

export default function ShortsScreen() {
  const { user } = useAuth();
  const { height } = useWindowDimensions();
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const listRef = useRef<FlatList<VideoRow>>(null);
  const pageHeight = Math.max(420, height - 145);
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("videos")
      .select("id,creator_id,title,description,video_path,thumbnail_path,duration_seconds,visibility,kind,status,category,tags,allow_comments,views_count,published_at,created_at,updated_at")
      .eq("status", "published").eq("visibility", "public").eq("kind", "short")
      .order("published_at", { ascending: false }).limit(30);
    if (error) { setMessage(error.message); setLoading(false); return; }
    try { setVideos(await hydrateVideos((data || []) as unknown as VideoRow[])); setMessage(""); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not prepare Shorts."); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggleLike = async (video: VideoRow) => {
    if (!user) { Alert.alert("Sign in to like", "Your reactions stay synced across devices.", [{ text: "Cancel" }, { text: "Sign in", onPress: () => router.push("/(tabs)/profile") }]); return; }
    const { data } = await supabase.from("video_reactions").select("reaction").eq("video_id", video.id).eq("user_id", user.id).maybeSingle();
    const result = data
      ? await supabase.from("video_reactions").delete().eq("video_id", video.id).eq("user_id", user.id)
      : await supabase.from("video_reactions").insert({ video_id: video.id, user_id: user.id, reaction: "like" });
    if (result.error) Alert.alert("Could not react", result.error.message);
  };
  const save = async (video: VideoRow) => {
    if (!user) { Alert.alert("Sign in to save videos", "Keep Shorts in Watch later.", [{ text: "Cancel" }, { text: "Sign in", onPress: () => router.push("/(tabs)/profile") }]); return; }
    let { data: playlist } = await supabase.from("playlists").select("id").eq("owner_id", user.id).eq("title", "Watch later").maybeSingle();
    if (!playlist) {
      const result = await supabase.from("playlists").insert({ owner_id: user.id, title: "Watch later", description: "Saved from OmniTube.", visibility: "private" }).select("id").single();
      if (result.error) { Alert.alert("Could not create library", result.error.message); return; }
      playlist = result.data;
    }
    const { error } = await supabase.from("playlist_items").upsert({ playlist_id: playlist.id, video_id: video.id, position: 0 }, { onConflict: "playlist_id,video_id" });
    Alert.alert(error ? "Could not save" : "Saved to Watch later", error?.message || "Your Short is in your library.");
  };

  if (loading) return <AppScreen><View style={styles.loadingFull}><Brand/><ActivityIndicator size="large" color={theme.mint}/><Text style={styles.preparingText}>Loading your Shorts feed…</Text></View></AppScreen>;
  if (!videos.length) return <AppScreen><View style={styles.emptyHeader}><Brand/></View><EmptyState icon="play-circle-outline" title="Your vertical universe is ready." detail={message || "Published public Shorts will appear here. Upload a vertical video to start the next story."} action={<Pressable style={styles.emptyButton} onPress={() => router.push("/(tabs)/create")}><Text style={styles.emptyButtonText}>Create a Short</Text></Pressable>}/></AppScreen>;

  return <AppScreen style={{ paddingTop: 0 }}>
    <FlatList ref={listRef} data={videos} keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => <ShortSlide video={item} active={index === active} userId={user?.id || null} onLike={() => void toggleLike(item)} onSave={() => void save(item)} />}
      pagingEnabled snapToInterval={pageHeight} decelerationRate="fast" snapToAlignment="start"
      showsVerticalScrollIndicator={false} getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
      onMomentumScrollEnd={(event) => { const next = Math.round(event.nativeEvent.contentOffset.y / pageHeight); setActive(next); }}
      initialNumToRender={2} maxToRenderPerBatch={2} windowSize={3} removeClippedSubviews
      onEndReachedThreshold={0.4} onEndReached={() => { if (videos.length < 30) void load(); }}
      style={{ flex: 1 }} />
  </AppScreen>;
}
const styles = StyleSheet.create({
  slide: { height: "100%", backgroundColor: "#05060A", overflow: "hidden" },
  videoFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: "#111626", justifyContent: "center", alignItems: "center" },
  fallbackOrb: { position: "absolute", width: 260, height: 260, borderRadius: 150, backgroundColor: "#A99AFF16" },
  gradientTop: { position: "absolute", top: 12, left: 16, right: 16, zIndex: 5, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  shortsWord: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#090B13C9", paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8 },
  shortsWordText: { color: theme.text, fontSize: 9, letterSpacing: 1.2, fontWeight: "900" },
  bottomGradient: { position: "absolute", bottom: 21, left: 15, right: 13, flexDirection: "row", alignItems: "flex-end", gap: 9, zIndex: 5 },
  bottomCopy: { flex: 1, paddingBottom: 6 },
  creatorRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 13 },
  creatorName: { color: theme.text, fontSize: 12, fontWeight: "900" },
  videoTitle: { color: "white", fontSize: 16, lineHeight: 21, fontWeight: "900" },
  videoDescription: { color: "#E2E5F0", fontSize: 11, lineHeight: 17, marginTop: 7 },
  videoStats: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 9 },
  videoStatsText: { color: "#D2D7E6", fontSize: 9, fontWeight: "600" },
  fullVideo: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 11, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: "#63EAC846", borderRadius: 8, backgroundColor: "#080A11B8" },
  fullVideoText: { color: theme.mint, fontSize: 9, fontWeight: "900" },
  actionRail: { width: 46, alignItems: "center", gap: 16, paddingBottom: 8 },
  railAction: { alignItems: "center", gap: 5 },
  railIcon: { width: 43, height: 43, borderRadius: 16, backgroundColor: "#0B0D16B3", borderWidth: 1, borderColor: "#FFFFFF20", justifyContent: "center", alignItems: "center" },
  likedIcon: { backgroundColor: "#FF8A9D25", borderColor: "#FF8A9D55" },
  railLabel: { color: "#F0F2FA", fontSize: 8, fontWeight: "800" },
  preparing: { position: "absolute", top: "45%", left: 0, right: 0, alignItems: "center", gap: 9 },
  preparingText: { color: "#D8DCEC", fontSize: 11 },
  playbackError: { position: "absolute", top: "45%", left: 25, right: 25, alignItems: "center", gap: 9 },
  playbackErrorText: { color: "#FFC2CB", textAlign: "center", fontSize: 11 },
  loadingFull: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18 },
  emptyHeader: { padding: 17 },
  emptyButton: { paddingHorizontal: 15, paddingVertical: 11, backgroundColor: theme.mint, borderRadius: 10, marginTop: 9 },
  emptyButtonText: { color: "#071712", fontWeight: "900", fontSize: 11 },
});