import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { Link, router } from "expo-router";
import * as Haptics from "expo-haptics";
import { AppScreen, Avatar, Brand, EmptyState, SectionTitle } from "../../src/components/ui";
import { useAuth } from "../../src/lib/AuthContext";
import { formatCount, hydratePosts, timeAgo } from "../../src/lib/media";
import { supabase } from "../../src/lib/supabase";
import type { PostRow } from "../../src/lib/types";
import { theme } from "../../src/theme";

export default function CommunityScreen() {
  const { user, profile } = useAuth();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    const { data, error } = await supabase.from("posts")
      .select("id,creator_id,body,media_urls,visibility,created_at,updated_at")
      .eq("visibility", "public").order("created_at", { ascending: false }).limit(45);
    if (error) {
      Alert.alert("Community could not load", error.message);
    } else {
      try { setPosts(await hydratePosts((data || []) as PostRow[], user?.id || null)); }
      catch (e) { Alert.alert("Community could not load", e instanceof Error ? e.message : "Please try again."); }
    }
    setLoading(false); setRefreshing(false);
  }, [user?.id]);
  useEffect(() => { void load(); }, [load]);

  const publish = async () => {
    if (!user) { Alert.alert("Sign in to post", "Your updates are shared with the real OmniTube community.", [{ text: "Cancel" }, { text: "Sign in", onPress: () => router.push("/(tabs)/profile") }]); return; }
    const text = body.trim();
    if (!text || publishing) return;
    setPublishing(true);
    const { error } = await supabase.from("posts").insert({ creator_id: user.id, body: text, visibility: "public" });
    setPublishing(false);
    if (error) Alert.alert("Post did not publish", error.message);
    else { setBody(""); await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); void load(true); }
  };

  const reactToPost = async (post: PostRow) => {
    if (!user) { Alert.alert("Join the conversation", "Sign in to react to creator posts.", [{ text: "Cancel" }, { text: "Sign in", onPress: () => router.push("/(tabs)/profile") }]); return; }
    const liked = Boolean(post.likedByMe);
    const result = liked
      ? await supabase.from("post_reactions").delete().eq("post_id", post.id).eq("user_id", user.id)
      : await supabase.from("post_reactions").insert({ post_id: post.id, user_id: user.id, reaction: "like" });
    if (result.error) Alert.alert("Reaction failed", result.error.message);
    else {
      setPosts((old) => old.map((item) => item.id === post.id ? {
        ...item,
        likesCount: Math.max(0, Number(item.likesCount || 0) + (liked ? -1 : 1)),
        likedByMe: !liked,
      } : item));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };
  const reportPost = (post: PostRow) => {
    if (!user) { Alert.alert("Sign in to report", "Reports are private and tied to your account."); return; }
    Alert.alert("Report community post", "Choose the reason that best describes your concern.", [
      { text: "Spam", onPress: () => void submitReport(post.id, "spam") },
      { text: "Harassment", onPress: () => void submitReport(post.id, "harassment") },
      { text: "Hate or abuse", onPress: () => void submitReport(post.id, "hate") },
      { text: "Other", onPress: () => void submitReport(post.id, "other") },
      { text: "Cancel", style: "cancel" },
    ]);
  };
  const submitReport = async (id: string, reason: string) => {
    const { error } = await supabase.from("reports").insert({ reporter_id: user!.id, target_type: "post", target_id: id, reason });
    Alert.alert(error ? "Report could not be submitted" : "Report received", error?.message || "Thank you. Your report has been recorded for review.");
  };

  const renderPost = ({ item }: { item: PostRow }) => <View style={styles.post}>
    <View style={styles.postHeader}>
      <Link href={{ pathname: "/creator/[id]", params: { id: item.creator_id } }} asChild><Pressable><Avatar profile={item.creator} size={41}/></Pressable></Link>
      <View style={styles.postIdentity}><Link href={{ pathname: "/creator/[id]", params: { id: item.creator_id } }} asChild><Pressable><Text style={styles.author}>{item.creator?.display_name || "Creator"} {item.creator?.is_verified ? "✓" : ""}</Text></Pressable></Link><Text style={styles.postWhen}>{timeAgo(item.created_at)} · Community</Text></View>
      <Pressable onPress={() => reportPost(item)} hitSlop={8}><Ionicons name="ellipsis-horizontal" size={21} color={theme.muted}/></Pressable>
    </View>
    <Link href={{ pathname: "/community/[id]", params: { id: item.id } }} asChild><Pressable><Text style={styles.postBody}>{item.body}</Text></Pressable></Link>
    {item.media_urls?.length ? <Text style={styles.mediaNotice}>{item.media_urls.length} attachment(s)</Text> : null}
    <View style={styles.postActions}>
      <Pressable onPress={() => void reactToPost(item)} accessibilityRole="button" accessibilityLabel={item.likedByMe ? "Unlike post" : "Like post"} accessibilityState={{ selected: Boolean(item.likedByMe) }} style={styles.postAction}><Ionicons name={item.likedByMe ? "heart" : "heart-outline"} size={18} color={item.likedByMe ? theme.coral : theme.muted}/><Text style={[styles.actionText, item.likedByMe && { color: theme.coral }]}>{formatCount(item.likesCount || 0)} {item.likedByMe ? "Liked" : "Likes"}</Text></Pressable>
      <Link href={{ pathname: "/community/[id]", params: { id: item.id } }} asChild><Pressable style={styles.postAction}><Ionicons name="chatbubble-ellipses-outline" size={17} color={theme.muted}/><Text style={styles.actionText}>{formatCount(item.commentsCount || 0)} Replies</Text></Pressable></Link>
      <Pressable onPress={() => void Share.share({ message: item.body + "\nhttps://omnitube.app/community/" + item.id })} style={styles.postAction}><Ionicons name="arrow-redo-outline" size={17} color={theme.muted}/><Text style={styles.actionText}>Share</Text></Pressable>
    </View>
  </View>;

  return <AppScreen style={{ paddingTop: 0 }}>
    <View style={styles.header}><Brand/><Pressable style={styles.headerButton} onPress={() => router.push("/notifications")}><Ionicons name="notifications-outline" size={21} color={theme.text}/></Pressable></View>
    <FlatList data={posts} keyExtractor={(item) => item.id} renderItem={renderPost}
      contentContainerStyle={styles.list} ItemSeparatorComponent={() => <View style={{ height: 12 }}/>}
      refreshControl={<RefreshControl tintColor={theme.mint} colors={[theme.mint]} refreshing={refreshing} onRefresh={() => void load(true)}/>}
      ListHeaderComponent={<View>
        <View style={styles.titleBlock}><Text style={styles.eyebrow}>BEYOND THE VIDEO</Text><Text style={styles.title}>Creator community</Text><Text style={styles.subtitle}>Ideas, updates and conversations from real people.</Text></View>
        <View style={styles.composer}>
          <View style={styles.composerTop}><Avatar profile={profile} size={36}/><Text style={styles.composerHeadline}>What’s happening in your world?</Text></View>
          <TextInput value={body} onChangeText={setBody} multiline maxLength={5000} placeholder={user ? "Share a thought, a win, a question…" : "Sign in to join the conversation…"} placeholderTextColor={theme.subtle} style={styles.input}/>
          <View style={styles.composerBottom}><Text style={styles.characterCount}>{body.length}/5000 · Public post</Text><Pressable disabled={!body.trim() || publishing} onPress={() => void publish()} style={[styles.publishButton, (!body.trim() || publishing) && { opacity: 0.5 }]}><Ionicons name="send" size={14} color="#081510"/><Text style={styles.publishText}>{publishing ? "Sharing…" : "Publish"}</Text></Pressable></View>
        </View>
        <SectionTitle title="Community feed" detail="A little more connection in every scroll."/>
        {loading ? <ActivityIndicator color={theme.mint} style={{ marginVertical: 28 }}/> : null}
      </View>}
      ListEmptyComponent={!loading ? <EmptyState icon="chatbubbles-outline" title="Start the conversation." detail="No public posts are available yet. Your first update can start the community feed."/> : undefined}
    />
  </AppScreen>;
}
const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 13, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 12, borderColor: theme.line, borderWidth: 1, backgroundColor: theme.panel2 },
  list: { paddingHorizontal: 15, paddingBottom: 22 },
  titleBlock: { paddingTop: 13, paddingBottom: 18 },
  eyebrow: { color: theme.mint, letterSpacing: 1.6, fontSize: 9, fontWeight: "900" },
  title: { color: theme.text, fontSize: 27, fontWeight: "900", letterSpacing: -0.9, marginTop: 6 },
  subtitle: { color: theme.muted, fontSize: 11, marginTop: 7 },
  composer: { padding: 14, borderRadius: 16, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.line },
  composerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  composerHeadline: { color: theme.text, fontSize: 12, fontWeight: "800" },
  input: { minHeight: 82, color: theme.text, fontSize: 12, lineHeight: 18, textAlignVertical: "top", marginTop: 12 },
  composerBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopColor: theme.line, borderTopWidth: 1, paddingTop: 11 },
  characterCount: { color: theme.subtle, fontSize: 9 },
  publishButton: { backgroundColor: theme.mint, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 6 },
  publishText: { color: "#081510", fontSize: 10, fontWeight: "900" },
  post: { borderRadius: 16, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.line, padding: 15 },
  postHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  postIdentity: { flex: 1 },
  author: { color: theme.text, fontSize: 12, fontWeight: "900" },
  postWhen: { color: theme.subtle, fontSize: 9, marginTop: 4 },
  postBody: { color: "#E6E8F3", fontSize: 13, lineHeight: 21, marginTop: 16 },
  mediaNotice: { color: theme.violet, fontSize: 10, marginTop: 10 },
  postActions: { flexDirection: "row", alignItems: "center", gap: 18, borderTopColor: theme.line, borderTopWidth: 1, paddingTop: 12, marginTop: 14 },
  postAction: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { color: theme.muted, fontSize: 9, fontWeight: "700" },
});