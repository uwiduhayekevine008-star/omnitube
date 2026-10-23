import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { AppScreen, Avatar, Brand, EmptyState, Eyebrow, SectionTitle } from "../../src/components/ui";
import VideoCard from "../../src/components/VideoCard";
import { useAuth } from "../../src/lib/AuthContext";
import { formatCount, hydrateStreams, hydrateVideos, timeAgo } from "../../src/lib/media";
import { supabase, isConfigured } from "../../src/lib/supabase";
import type { LiveStreamRow, VideoRow } from "../../src/lib/types";
import { theme } from "../../src/theme";

const topics = ["For you", "Technology", "Music", "Education", "Gaming", "Science", "Comedy", "Lifestyle"];
const chips = ["For you", "Newest", "Trending", "Videos", "Shorts", "Following"];

export default function DiscoverScreen() {
  const { user, profile } = useAuth();
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [streams, setStreams] = useState<LiveStreamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("For you");
  const [feed, setFeed] = useState("For you");
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const load = useCallback(async (reset = true, pullRefresh = false) => {
    if (!isConfigured) {
      setLoading(false);
      setError("Set the EXPO_PUBLIC Supabase values in apps/mobile/.env.local first.");
      return;
    }
    if (!reset && loadingMoreRef.current) return;
    if (!reset) loadingMoreRef.current = true;
    const nextPage = reset ? 0 : pageRef.current;
    if (reset) { setLoading(!pullRefresh); setHasMore(true); pageRef.current = 0; }
    setRefreshing(pullRefresh);
    try {
      let request = supabase.from("videos")
        .select("id,creator_id,title,description,video_path,thumbnail_path,duration_seconds,visibility,kind,status,category,tags,allow_comments,views_count,published_at,created_at,updated_at")
        .eq("status", "published").eq("visibility", "public");
      if (feed === "Shorts") request = request.eq("kind", "short") as typeof request;
      if (feed === "Videos") request = request.eq("kind", "video") as typeof request;
      if (topic !== "For you") request = request.eq("category", topic) as typeof request;
      const q = query.trim().replace(/[,%()]/g, " ").replace(/\\s+/g, " ").slice(0, 90);
      if (q) request = request.or("title.ilike.%" + q + "%,description.ilike.%" + q + "%") as typeof request;

      if (feed === "Following") {
        if (!user?.id) {
          setVideos([]);
          setHasMore(false);
          setError("Sign in to build a feed from the creators you follow.");
          return;
        }
        const { data: follows, error: followsError } = await supabase.from("follows").select("creator_id").eq("follower_id", user.id);
        if (followsError) throw followsError;
        const followedIds = (follows || []).map((item) => item.creator_id);
        if (!followedIds.length) {
          setVideos([]);
          setHasMore(false);
          setError("");
          return;
        }
        request = request.in("creator_id", followedIds) as typeof request;
      }

      const personalized = feed === "For you";
      if (feed === "Trending") request = request.order("views_count", { ascending: false }).order("published_at", { ascending: false }) as typeof request;
      else request = request.order("published_at", { ascending: false }) as typeof request;
      const { data, error: queryError } = await request.range(personalized ? 0 : nextPage * 18, personalized ? 71 : nextPage * 18 + 17);
      if (queryError) throw queryError;
      let rows = (data || []) as unknown as VideoRow[];

      if (personalized && user?.id && rows.length) {
        const [follows, recentViews, reactions] = await Promise.all([
          supabase.from("follows").select("creator_id").eq("follower_id", user.id),
          supabase.from("video_views").select("video_id,created_at").eq("viewer_id", user.id).order("created_at", { ascending: false }).limit(60),
          supabase.from("video_reactions").select("video_id").eq("user_id", user.id),
        ]);
        const followed = new Set((follows.data || []).map((item) => item.creator_id));
        const watched = new Set((recentViews.data || []).map((item) => item.video_id));
        const liked = new Set((reactions.data || []).map((item) => item.video_id));
        const categoryIds = Array.from(watched).slice(0, 25);
        const watchedCategories = categoryIds.length
          ? await supabase.from("videos").select("id,category").in("id", categoryIds)
          : { data: [] as { id: string; category: string }[] };
        const categoryAffinity = new Map<string, number>();
        (watchedCategories.data || []).forEach((item) => categoryAffinity.set(item.category, (categoryAffinity.get(item.category) || 0) + 1));
        const now = Date.now();
        rows = [...rows].sort((a, b) => {
          const score = (video: VideoRow) => {
            const ageDays = Math.max(0, (now - new Date(video.published_at || video.created_at).getTime()) / 86400000);
            const freshness = Math.exp(-ageDays / 8);
            const popularity = Math.log1p(Number(video.views_count || 0)) / 5;
            const creatorAffinity = followed.has(video.creator_id) ? 2.4 : 0;
            const category = (categoryAffinity.get(video.category) || 0) * 0.12;
            const unseen = watched.has(video.id) ? -0.65 : 0.3;
            const likedPenalty = liked.has(video.id) ? -0.5 : 0.15;
            return freshness + popularity + creatorAffinity + category + unseen + likedPenalty;
          };
          return score(b) - score(a);
        });
      }

      if (personalized) {
        const start = nextPage * 18;
        const pageRows = rows.slice(start, start + 18);
        const hydrated = await hydrateVideos(pageRows);
        setVideos((old) => reset ? hydrated : [...old, ...hydrated]);
        setHasMore(rows.length > start + 18);
      } else {
        const hydrated = await hydrateVideos(rows);
        setVideos((old) => reset ? hydrated : [...old, ...hydrated]);
        setHasMore(rows.length === 18);
      }
      pageRef.current = nextPage + 1;
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The feed could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      loadingMoreRef.current = false;
    }
  }, [feed, topic, query, user?.id]);

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => {
    let active = true;
    void supabase.from("live_streams")
      .select("id,creator_id,title,description,status,visibility,room_name,playback_url,chat_enabled,starts_at,ended_at,replay_video_id,created_at,updated_at")
      .eq("status", "live").eq("visibility", "public").order("created_at", { ascending: false }).limit(8)
      .then(async ({ data }) => {
        if (!active || !data) return;
        const hydrated = await hydrateStreams(data as LiveStreamRow[]);
        if (active) setStreams(hydrated);
      });
    return () => { active = false; };
  }, []);

  const toggleLike = async (video: VideoRow) => {
    if (!user) { Alert.alert("Sign in to like", "Your likes and creator activity sync across devices.", [{ text: "Not now" }, { text: "Sign in", onPress: () => router.push("/(tabs)/profile") }]); return; }
    const { data: existing } = await supabase.from("video_reactions").select("reaction").eq("video_id", video.id).eq("user_id", user.id).maybeSingle();
    const result = existing
      ? await supabase.from("video_reactions").delete().eq("video_id", video.id).eq("user_id", user.id)
      : await supabase.from("video_reactions").insert({ video_id: video.id, user_id: user.id, reaction: "like" });
    if (result.error) Alert.alert("Reaction failed", result.error.message);
    else void load(true);
  };

  const saveVideo = async (video: VideoRow) => {
    if (!user) { Alert.alert("Sign in to save", "Build your Watch later library across devices.", [{ text: "Cancel" }, { text: "Sign in", onPress: () => router.push("/(tabs)/profile") }]); return; }
    let { data: list } = await supabase.from("playlists").select("id").eq("owner_id", user.id).eq("title", "Watch later").maybeSingle();
    if (!list) {
      const created = await supabase.from("playlists").insert({ owner_id: user.id, title: "Watch later", description: "Keep the good stuff close.", visibility: "private" }).select("id").single();
      if (created.error) { Alert.alert("Could not create your library", created.error.message); return; }
      list = created.data;
    }
    const { error: itemError } = await supabase.from("playlist_items").upsert({ playlist_id: list.id, video_id: video.id, position: 0 }, { onConflict: "playlist_id,video_id" });
    if (itemError) Alert.alert("Could not save video", itemError.message);
    else Alert.alert("Saved", "Added to your Watch later playlist.");
  };

  const endReached = () => { if (!loading && hasMore) void load(false); };

  return <AppScreen style={{ paddingTop: 0 }}>
    <FlatList
      data={videos}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={styles.column}
      contentContainerStyle={styles.listContent}
      renderItem={({ item }) => <VideoCard video={item} onLike={() => void toggleLike(item)} onSave={() => void saveVideo(item)} />}
      ListHeaderComponent={<View>
        <View style={styles.header}>
          <Brand />
          <View style={styles.headerActions}>
            <Pressable style={styles.headerIcon} onPress={() => router.push("/notifications")}><Ionicons name="notifications-outline" size={21} color={theme.text} /></Pressable>
            <Pressable onPress={() => router.push("/(tabs)/profile")}><Avatar profile={profile} size={35} /></Pressable>
          </View>
        </View>
        <View style={styles.hero}>
          <View style={styles.heroGlow} />
          <Eyebrow>THE CREATOR UNIVERSE</Eyebrow>
          <Text style={styles.heroTitle}>Your world,{ "\n" }<Text style={{ color: theme.mint }}>in motion.</Text></Text>
          <Text style={styles.heroBody}>Find your next obsession. Build your own corner of the internet. Go beyond the feed.</Text>
          <View style={styles.heroButtons}>
            <Pressable style={styles.primaryAction} onPress={() => router.push("/(tabs)/create")}><Ionicons name="cloud-upload-outline" size={17} color="#081510" /><Text style={styles.primaryActionText}>Start creating</Text></Pressable>
            <Pressable style={styles.ghostAction} onPress={() => router.push("/(tabs)/shorts")}><Ionicons name="play-circle-outline" size={17} color={theme.text} /><Text style={styles.ghostActionText}>Watch Shorts</Text></Pressable>
          </View>
          <View style={styles.heroFoot}><View style={styles.liveDot} /><Text style={styles.heroFootText}>CREATOR-FIRST · BUILT FOR EVERY SCREEN</Text></View>
        </View>
        {streams.length > 0 && <View style={styles.liveBlock}>
          <SectionTitle title="Live right now" detail="Jump into the moment." action={<Pressable onPress={() => router.push("/(tabs)/live")}><Text style={styles.seeAll}>SEE ALL</Text></Pressable>} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 11, paddingBottom: 5 }}>
            {streams.map((stream) => <Pressable key={stream.id} style={styles.liveCard} onPress={() => router.push({ pathname: "/live/[id]", params: { id: stream.id } })}>
              <View style={styles.liveArt}><View style={styles.liveDotLarge} /><Ionicons name="radio" size={28} color={theme.violet} /><View style={styles.onAir}><View style={styles.liveDot} /><Text style={styles.onAirText}>LIVE</Text></View></View>
              <Text numberOfLines={1} style={styles.liveTitle}>{stream.title}</Text><Text numberOfLines={1} style={styles.liveCreator}>{stream.creator?.display_name || "Creator"}</Text>
            </Pressable>)}
          </ScrollView>
        </View>}
        <View style={styles.searchBox}><Ionicons name="search" size={18} color={theme.subtle} /><TextInput value={query} onChangeText={setQuery} placeholder="Search videos, topics, creators…" placeholderTextColor={theme.subtle} returnKeyType="search" style={styles.searchInput} autoCapitalize="none" /><Pressable onPress={() => void load(true)}><Ionicons name="arrow-forward-circle" size={22} color={theme.mint} /></Pressable></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topicRow}>
          {topics.map((item) => <Pressable key={item} onPress={() => setTopic(item)} style={[styles.topicChip, topic === item && styles.topicChipActive]}><Text style={[styles.topicText, topic === item && styles.topicTextActive]}>{item}</Text></Pressable>)}
        </ScrollView>
        <View style={styles.feedHeader}><View><Eyebrow>CURATED FOR YOU</Eyebrow><Text style={styles.feedTitle}>{query.trim() ? "Search results" : topic === "For you" ? "Discover something new" : topic}</Text></View><Pressable style={styles.refreshButton} onPress={() => void load(true)}><Ionicons name="refresh" size={17} color={theme.muted} /></Pressable></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.feedChips}>
          {chips.map((item) => <Pressable key={item} onPress={() => setFeed(item)} style={[styles.feedChip, feed === item && styles.feedChipActive]}><Text style={[styles.feedChipText, feed === item && styles.feedChipTextActive]}>{item}</Text></Pressable>)}
        </ScrollView>
        {error ? <View style={styles.errorBox}><Ionicons name="alert-circle-outline" size={18} color={theme.coral} /><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load(true)}><Text style={styles.retry}>Retry</Text></Pressable></View> : null}
      </View>}
      ListEmptyComponent={loading ? <View style={styles.loading}><ActivityIndicator color={theme.mint} size="large" /><Text style={styles.loadingText}>Finding the good stuff…</Text></View> :
        <EmptyState icon={query ? "search-outline" : "film-outline"} title={query ? "Nothing matched that search." : "The next great video starts here."} detail={query ? "Try a different title or topic. Search works across real published videos." : "No public videos have been published yet. Sign in, upload your first video and start the discovery universe."} action={<Pressable onPress={() => router.push("/(tabs)/create")} style={styles.emptyButton}><Text style={styles.emptyButtonText}>Publish a video</Text></Pressable>} />}
      ListFooterComponent={loading && videos.length > 0 ? <ActivityIndicator color={theme.mint} style={{ marginVertical: 18 }} /> :
        videos.length > 0 && hasMore ? <Pressable onPress={endReached} style={styles.loadMore}><Text style={styles.loadMoreText}>Load more discoveries</Text><Ionicons name="arrow-down" size={15} color={theme.mint} /></Pressable> : <View style={{ height: 35 }} />}
      refreshControl={<RefreshControl tintColor={theme.mint} colors={[theme.mint]} refreshing={refreshing} onRefresh={() => void load(true)} />}
      onEndReached={endReached}
      onEndReachedThreshold={0.65}
      keyboardShouldPersistTaps="handled"
    />
  </AppScreen>;
}
const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 15, paddingBottom: 18 },
  column: { gap: 12, alignItems: "flex-start" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 14, paddingBottom: 16 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.panel2, borderWidth: 1, borderColor: theme.line },
  hero: { position: "relative", overflow: "hidden", borderRadius: 23, borderWidth: 1, borderColor: "#A99AFF32", padding: 21, backgroundColor: "#141827" },
  heroGlow: { position: "absolute", top: -55, right: -40, width: 210, height: 210, borderRadius: 120, backgroundColor: "#A99AFF18" },
  heroTitle: { marginTop: 12, color: theme.text, fontSize: 39, lineHeight: 42, fontWeight: "900", letterSpacing: -1.9 },
  heroBody: { color: "#ABB1C5", fontSize: 12, lineHeight: 19, marginTop: 11, maxWidth: 330 },
  heroButtons: { flexDirection: "row", gap: 9, marginTop: 19 },
  primaryAction: { borderRadius: 11, backgroundColor: theme.mint, paddingHorizontal: 13, minHeight: 40, flexDirection: "row", gap: 7, alignItems: "center" },
  primaryActionText: { color: "#081510", fontWeight: "900", fontSize: 11 },
  ghostAction: { borderRadius: 11, borderWidth: 1, borderColor: "#FFFFFF26", backgroundColor: "#FFFFFF06", paddingHorizontal: 12, minHeight: 40, flexDirection: "row", gap: 7, alignItems: "center" },
  ghostActionText: { color: theme.text, fontWeight: "800", fontSize: 11 },
  heroFoot: { flexDirection: "row", alignItems: "center", gap: 7, borderTopWidth: 1, borderTopColor: "#FFFFFF12", marginTop: 19, paddingTop: 13 },
  liveDot: { width: 6, height: 6, borderRadius: 4, backgroundColor: theme.coral },
  heroFootText: { fontSize: 8, letterSpacing: 1, color: theme.subtle, fontWeight: "800" },
  liveBlock: { marginTop: 5 },
  seeAll: { fontSize: 9, color: theme.mint, fontWeight: "900", letterSpacing: 1 },
  liveCard: { width: 132 },
  liveArt: { height: 92, borderRadius: 13, overflow: "hidden", justifyContent: "center", alignItems: "center", backgroundColor: "#171B2C", borderWidth: 1, borderColor: "#A99AFF24" },
  liveDotLarge: { position: "absolute", width: 95, height: 95, borderRadius: 60, backgroundColor: "#A99AFF14" },
  onAir: { flexDirection: "row", gap: 5, position: "absolute", top: 7, left: 7, alignItems: "center", backgroundColor: "#080A11DD", paddingHorizontal: 6, paddingVertical: 4, borderRadius: 5 },
  onAirText: { fontSize: 8, fontWeight: "900", color: theme.coral },
  liveTitle: { color: theme.text, fontSize: 11, fontWeight: "800", marginTop: 8 },
  liveCreator: { color: theme.muted, fontSize: 9, marginTop: 4 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: theme.line, borderRadius: 13, paddingHorizontal: 12, marginTop: 20, height: 47, backgroundColor: theme.panel },
  searchInput: { flex: 1, color: theme.text, fontSize: 12, paddingVertical: 0 },
  topicRow: { gap: 8, paddingTop: 13, paddingBottom: 3 },
  topicChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel },
  topicChipActive: { backgroundColor: theme.mint, borderColor: theme.mint },
  topicText: { fontSize: 10, color: theme.muted, fontWeight: "800" },
  topicTextActive: { color: "#081510" },
  feedHeader: { marginTop: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  feedTitle: { color: theme.text, fontSize: 21, fontWeight: "900", marginTop: 5, letterSpacing: -0.6 },
  refreshButton: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.line },
  feedChips: { gap: 8, paddingTop: 12, paddingBottom: 17 },
  feedChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: theme.panel2, borderWidth: 1, borderColor: theme.line },
  feedChipActive: { backgroundColor: "#63EAC817", borderColor: "#63EAC842" },
  feedChipText: { color: theme.muted, fontSize: 10, fontWeight: "700" },
  feedChipTextActive: { color: theme.mint },
  loading: { height: 175, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: theme.muted, fontSize: 11 },
  errorBox: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", padding: 12, borderRadius: 11, borderColor: "#FF8A9D33", borderWidth: 1, backgroundColor: "#FF8A9D0D" },
  errorText: { flex: 1, minWidth: 130, color: "#FFB9C2", fontSize: 10 },
  retry: { color: theme.mint, fontSize: 10, fontWeight: "900" },
  emptyButton: { backgroundColor: theme.mint, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11, marginTop: 10 },
  emptyButtonText: { color: "#071712", fontSize: 11, fontWeight: "900" },
  loadMore: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, marginBottom: 8, padding: 14, borderColor: theme.line, borderWidth: 1, borderRadius: 12, backgroundColor: theme.panel },
  loadMoreText: { color: theme.muted, fontSize: 11, fontWeight: "800" },
});