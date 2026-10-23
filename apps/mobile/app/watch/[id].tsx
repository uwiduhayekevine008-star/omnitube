import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";
import { AppScreen, ActionButton, Avatar, Brand, Eyebrow, Surface, ui } from "../../src/components/ui";
import { useAuth } from "../../src/lib/AuthContext";
import { formatCount, initials, resolvePlayback, timeAgo } from "../../src/lib/media";
import { supabase } from "../../src/lib/supabase";
import type { CommentRow, Profile, VideoRow } from "../../src/lib/types";
import { theme } from "../../src/theme";

export default function WatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useAuth();
  const [video, setVideo] = useState<VideoRow | null>(null);
  const [playbackError, setPlaybackError] = useState("");
  const [loading, setLoading] = useState(true);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [following, setFollowing] = useState(false);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [showAllComments, setShowAllComments] = useState(false);
  const player = useVideoPlayer(null, (instance) => { instance.loop = false; instance.muted = false; instance.timeUpdateEventInterval = 1; instance.keepScreenOnWhilePlaying = true; });
  const viewRecorded = useRef(false);
  const watchBaseSeconds = useRef(0);
  const watchedSeconds = useRef(0);
  const watchDate = useRef(new Date().toISOString().slice(0, 10));
  const [watchTrackingReady, setWatchTrackingReady] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [playbackType, setPlaybackType] = useState<"hls" | "file">("file");
  const [playbackRate, setPlaybackRate] = useState(1);
  const [qualityCap, setQualityCap] = useState<"auto" | "360" | "720" | "1080">("auto");
  const [subtitleOptions, setSubtitleOptions] = useState<Array<{ label: string; index: number }>>([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState(-1);
  const [hasAdaptiveTracks, setHasAdaptiveTracks] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [bufferedPosition, setBufferedPosition] = useState(0);

  const persistWatchTime = useCallback(async () => {
    if (!video?.id || !user?.id || !watchTrackingReady || watchedSeconds.current <= 0) return;
    const { error } = await supabase.rpc("record_video_watch", {
      p_video_id: video.id,
      p_watch_seconds: watchBaseSeconds.current + watchedSeconds.current,
      p_source: "direct",
    });
    if (error && __DEV__) console.warn("OmniTube watch-time update unavailable:", error.message);
  }, [video?.id, user?.id, watchTrackingReady]);

  useEffect(() => {
    if (!video?.id || !user?.id || !watchTrackingReady) return;
    let unsavedSeconds = 0;
    const interval = setInterval(() => {
      if (!player.playing) return;
      watchedSeconds.current += 1;
      unsavedSeconds += 1;
      if (unsavedSeconds >= 10) {
        unsavedSeconds = 0;
        void persistWatchTime();
      }
    }, 1000);
    return () => {
      clearInterval(interval);
      void persistWatchTime();
    };
  }, [video?.id, user?.id, watchTrackingReady, player, persistWatchTime]);

  const loadComments = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase.from("comments").select("*").eq("video_id", id).order("created_at", { ascending: false }).limit(80);
    if (error || !data) return;
    const rows = data as CommentRow[];
    const authorIds = Array.from(new Set(rows.map((item) => item.user_id)));
    const { data: profiles } = authorIds.length
      ? await supabase.from("profiles").select("*").in("id", authorIds)
      : { data: [] as Profile[] };
    const map = new Map((profiles || []).map((person) => [person.id, person as Profile]));
    setComments(rows.map((item) => ({ ...item, author: map.get(item.user_id) || null })));
  }, [id]);

  useEffect(() => {
    let active = true;
    viewRecorded.current = false;
    setWatchTrackingReady(false);
    watchBaseSeconds.current = 0;
    watchedSeconds.current = 0;
    watchDate.current = new Date().toISOString().slice(0, 10);
    void (async () => {
      setLoading(true);
      setPlaybackError("");
      setSubtitleOptions([]);
      setSelectedSubtitle(-1);
      setQualityCap("auto");
      try {
        const { data, error } = await supabase.from("videos").select("*").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("Video not found or not available to this account.");
        const { data: creator } = await supabase.from("profiles").select("*").eq("id", data.creator_id).maybeSingle();
        if (!active) return;
        const nextVideo = { ...(data as VideoRow), creator: creator as Profile | null };
        setVideo(nextVideo);
        try {
          const source = await resolvePlayback(id);
          if (active) {
            setPlaybackType(source.type);
            await player.replaceAsync({
              uri: source.url,
              contentType: source.type === "hls" ? "hls" : "auto",
            });
            player.playbackRate = playbackRate;
            player.maxResolution = null;
            player.play();
            setPlaybackError("");
          }
        } catch (error) {
          if (active) setPlaybackError(error instanceof Error ? error.message : "Playback could not be authorized.");
        }
        const [{ count }, userReaction, followState] = await Promise.all([
          supabase.from("video_reactions").select("video_id", { count: "exact", head: true }).eq("video_id", id).eq("reaction", "like"),
          user ? supabase.from("video_reactions").select("reaction").eq("video_id", id).eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
          user ? supabase.from("follows").select("creator_id").eq("follower_id", user.id).eq("creator_id", data.creator_id).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        if (active) {
          setLikeCount(count || 0);
          setLiked(userReaction.data?.reaction === "like" || userReaction.data?.reaction === "heart");
          setFollowing(Boolean(followState.data));
        }
        if (user && !viewRecorded.current) {
          viewRecorded.current = true;
          const today = watchDate.current;
          const { error: startTrackingError } = await supabase.rpc("record_video_watch", {
            p_video_id: id, p_watch_seconds: 0, p_source: "direct",
          });
          if (startTrackingError && __DEV__) {
            console.warn("OmniTube watch tracking could not start:", startTrackingError.message);
          }
          const { data: currentView } = await supabase.from("video_views").select("watch_seconds")
            .eq("video_id", id).eq("viewer_id", user.id).eq("view_date", today).maybeSingle();
          if (active && currentView) {
            watchBaseSeconds.current = Number(currentView.watch_seconds || 0);
            watchedSeconds.current = 0;
            setWatchTrackingReady(true);
          }
        }
        await loadComments();
      } catch (error) {
        if (active) setPlaybackError(error instanceof Error ? error.message : "This video is not available.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; player.pause(); };
  }, [id, user?.id, player, loadComments, playbackAttempt, playbackRate]);

  useEffect(() => {
    const sourceSub = player.addListener("sourceLoad", (payload) => {
      setDurationSeconds(Number(payload.duration || 0));
      setSubtitleOptions(payload.availableSubtitleTracks.map((track, index) => ({
        label: track.label || track.language || `Subtitles ${index + 1}`,
        index,
      })));
      setSelectedSubtitle(-1);
      setHasAdaptiveTracks(payload.availableVideoTracks.length > 1);
    });
    const subtitleSub = player.addListener("availableSubtitleTracksChange", ({ availableSubtitleTracks }) => {
      setSubtitleOptions(availableSubtitleTracks.map((track, index) => ({
        label: track.label || track.language || `Subtitles ${index + 1}`,
        index,
      })));
    });
    const videoSub = player.addListener("availableVideoTracksChange", ({ availableVideoTracks }) => {
      setHasAdaptiveTracks(availableVideoTracks.length > 1);
    });
    const timeSub = player.addListener("timeUpdate", ({ currentTime: position, bufferedPosition: buffered }) => {
      setCurrentTime(position);
      setDurationSeconds(Number.isFinite(player.duration) ? player.duration : 0);
      setBufferedPosition(Number.isFinite(buffered) && buffered > 0 ? buffered : 0);
    });
    const rateSub = player.addListener("playbackRateChange", ({ playbackRate: rate }) => setPlaybackRate(rate));
    return () => {
      sourceSub.remove();
      subtitleSub.remove();
      videoSub.remove();
      timeSub.remove();
      rateSub.remove();
    };
  }, [player]);

  useEffect(() => {
    player.playbackRate = playbackRate;
  }, [player, playbackRate]);

  useEffect(() => {
    if (playbackType !== "hls") {
      player.maxResolution = null;
      return;
    }
    const portrait = video?.kind === "short";
    const caps = {
      "360": portrait ? { width: 360, height: 640 } : { width: 640, height: 360 },
      "720": portrait ? { width: 720, height: 1280 } : { width: 1280, height: 720 },
      "1080": portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 },
    } as const;
    player.maxResolution = qualityCap === "auto" ? null : caps[qualityCap];
  }, [player, playbackType, qualityCap, video?.kind]);

  const selectSubtitle = (index: number) => {
    const tracks = player.availableSubtitleTracks;
    player.subtitleTrack = index < 0 ? null : (tracks[index] || null);
    setSelectedSubtitle(index);
  };

  const seekBy = (seconds: number) => {
    player.seekBy(seconds);
  };

  const formatPlayerTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
  };

  const toggleLike = async () => {
    if (!video) return;
    if (!user) { Alert.alert("Sign in to like", "Your reactions sync across devices.", [{ text: "Cancel" }, { text: "Sign in", onPress: () => router.push("/(tabs)/profile") }]); return; }
    const wasLiked = liked;
    setLiked(!wasLiked); setLikeCount((old) => Math.max(0, old + (wasLiked ? -1 : 1)));
    const result = wasLiked
      ? await supabase.from("video_reactions").delete().eq("video_id", video.id).eq("user_id", user.id)
      : await supabase.from("video_reactions").insert({ video_id: video.id, user_id: user.id, reaction: "like" });
    if (result.error) { setLiked(wasLiked); setLikeCount((old) => Math.max(0, old + (wasLiked ? 1 : -1))); Alert.alert("Like was not saved", result.error.message); }
  };

  const toggleFollow = async () => {
    if (!video) return;
    if (!user) { Alert.alert("Follow creators", "Sign in to build your personalized feed.", [{ text: "Cancel" }, { text: "Sign in", onPress: () => router.push("/(tabs)/profile") }]); return; }
    if (user.id === video.creator_id) { router.push("/(tabs)/profile"); return; }
    const result = following
      ? await supabase.from("follows").delete().eq("follower_id", user.id).eq("creator_id", video.creator_id)
      : await supabase.from("follows").insert({ follower_id: user.id, creator_id: video.creator_id });
    if (result.error) Alert.alert("Could not update follow", result.error.message);
    else setFollowing(!following);
  };

  const saveToPlaylist = async () => {
    if (!video) return;
    if (!user) { Alert.alert("Save for later", "Sign in to build your Watch later library."); return; }
    let { data: playlist } = await supabase.from("playlists").select("id").eq("owner_id", user.id).eq("title", "Watch later").maybeSingle();
    if (!playlist) {
      const result = await supabase.from("playlists").insert({ owner_id: user.id, title: "Watch later", description: "Saved from OmniTube.", visibility: "private" }).select("id").single();
      if (result.error) { Alert.alert("Could not create playlist", result.error.message); return; }
      playlist = result.data;
    }
    const { data: existingItem, error: lookupError } = await supabase.from("playlist_items")
      .select("video_id").eq("playlist_id", playlist.id).eq("video_id", video.id).maybeSingle();
    if (lookupError) { Alert.alert("Could not check saved video", lookupError.message); return; }
    if (existingItem) { Alert.alert("Already saved", "This video is already in Watch later."); return; }
    const { error } = await supabase.from("playlist_items").insert({ playlist_id: playlist.id, video_id: video.id, position: 0 });
    Alert.alert(error ? "Could not save video" : "Saved to Watch later", error?.message || "Added to your private library.");
  };

  const repost = async () => {
    if (!video || !user) { Alert.alert("Sign in to repost", "Reposts help creators reach more people."); return; }
    const { data: existing, error: lookupError } = await supabase.from("reposts")
      .select("id").eq("video_id", video.id).eq("user_id", user.id).maybeSingle();
    if (lookupError) { Alert.alert("Could not check repost", lookupError.message); return; }
    if (existing) { Alert.alert("Already reposted", "This video is already in your repost history."); return; }
    const { error } = await supabase.from("reposts").insert({ video_id: video.id, user_id: user.id });
    Alert.alert(error ? "Could not repost" : "Reposted", error?.message || "Shared with your creator network.");
  };

  const sendComment = async () => {
    if (!video || !commentBody.trim() || commenting) return;
    if (!user) { Alert.alert("Join the conversation", "Sign in before adding a comment."); return; }
    setCommenting(true);
    const body = commentBody.trim();
    const { data, error } = await supabase.from("comments").insert({ video_id: video.id, user_id: user.id, body }).select("*").single();
    setCommenting(false);
    if (error) Alert.alert("Comment was not posted", error.message);
    else {
      setComments((old) => [{ ...(data as CommentRow), author: profile }, ...old]);
      setCommentBody("");
      setShowAllComments(true);
    }
  };

  const reportVideo = () => {
    if (!user || !video) { Alert.alert("Sign in to report content", "Reports are private."); return; }
    Alert.alert("Report this video", "Choose the reason.", [
      { text: "Spam", onPress: () => void submitReport("spam") },
      { text: "Harassment", onPress: () => void submitReport("harassment") },
      { text: "Copyright", onPress: () => void submitReport("copyright") },
      { text: "Harmful content", onPress: () => void submitReport("other") },
      { text: "Cancel", style: "cancel" },
    ]);
  };
  const submitReport = async (reason: string) => {
    if (!user || !video) return;
    const { error } = await supabase.from("reports").insert({ reporter_id: user.id, target_type: "video", target_id: video.id, reason });
    Alert.alert(error ? "Report failed" : "Report received", error?.message || "Thank you. The concern has been recorded for review.");
  };

  return <AppScreen style={{ paddingTop: 0 }}>
    <View style={styles.topbar}><Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={theme.text}/></Pressable><Brand/><Pressable onPress={reportVideo} style={styles.more}><Ionicons name="shield-outline" size={20} color={theme.muted}/></Pressable></View>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.player}>
        {video && !playbackError ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls allowsPictureInPicture /> : <View style={styles.playerFallback}><Ionicons name={playbackError ? "alert-circle-outline" : "play-circle-outline"} size={35} color={theme.violet}/><Text style={styles.playerErrorText}>{playbackError || "Preparing your video…"}</Text>{loading ? <ActivityIndicator color={theme.mint}/> : null}{playbackError && !loading ? <Pressable style={styles.retryButton} onPress={() => setPlaybackAttempt((value) => value + 1)}><Ionicons name="refresh" size={15} color={theme.text}/><Text style={styles.retryButtonText}>Retry secure playback</Text></Pressable> : null}</View>}
      </View>
      {video && !playbackError && <View style={styles.playerTools}>
        <View style={styles.playerToolHeader}>
          <Text style={styles.playerToolTitle}>PLAYBACK</Text>
          <Text style={styles.playerTime}>{formatPlayerTime(currentTime)} / {formatPlayerTime(durationSeconds || video.duration_seconds || 0)}</Text>
        </View>
        <View style={styles.playerProgress}><View style={[styles.playerBuffered,{width: `${durationSeconds > 0 ? Math.min(100, bufferedPosition / durationSeconds * 100) : 0}%`]}/><View style={[styles.playerProgressFill,{width: `${durationSeconds > 0 ? Math.min(100, currentTime / durationSeconds * 100) : 0}%`]}/></View>
        <View style={styles.playerControlRow}>
          <Pressable onPress={() => seekBy(-10)} style={styles.playerControlButton} accessibilityRole="button" accessibilityLabel="Back 10 seconds"><Ionicons name="play-back" size={15} color={theme.text}/><Text style={styles.playerControlLabel}>10s</Text></Pressable>
          <Pressable onPress={() => seekBy(10)} style={styles.playerControlButton} accessibilityRole="button" accessibilityLabel="Forward 10 seconds"><Ionicons name="play-forward" size={15} color={theme.text}/><Text style={styles.playerControlLabel}>10s</Text></Pressable>
          <View style={styles.playerControlSpacer}/>
          <Text style={styles.playerSettingLabel}>SPEED</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.playerSettingChips}>
            {[0.5,0.75,1,1.25,1.5,2].map((rate) => <Pressable key={rate} onPress={() => setPlaybackRate(rate)} style={[styles.playerSettingChip, playbackRate === rate && styles.playerSettingChipActive]}><Text style={[styles.playerSettingChipText, playbackRate === rate && styles.playerSettingChipTextActive]}>{rate === 1 ? "1×" : `${rate}×`}</Text></Pressable>)}
          </ScrollView>
        </View>
        {playbackType === "hls" && hasAdaptiveTracks ? <View style={styles.playerControlRow}>
          <Text style={styles.playerSettingLabel}>QUALITY</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.playerSettingChips}>
            {(["auto","360","720","1080"] as const).map((quality) => <Pressable key={quality} onPress={() => setQualityCap(quality)} style={[styles.playerSettingChip, qualityCap === quality && styles.playerSettingChipActive]}><Text style={[styles.playerSettingChipText, qualityCap === quality && styles.playerSettingChipTextActive]}>{quality === "auto" ? "Auto" : quality + "p max"}</Text></Pressable>)}
          </ScrollView>
        </View> : null}
        {subtitleOptions.length > 0 ? <View style={styles.playerControlRow}>
          <Text style={styles.playerSettingLabel}>CAPTIONS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.playerSettingChips}>
            <Pressable onPress={() => selectSubtitle(-1)} style={[styles.playerSettingChip, selectedSubtitle === -1 && styles.playerSettingChipActive]}><Text style={[styles.playerSettingChipText, selectedSubtitle === -1 && styles.playerSettingChipTextActive]}>Off</Text></Pressable>
            {subtitleOptions.map((track) => <Pressable key={track.index} onPress={() => selectSubtitle(track.index)} style={[styles.playerSettingChip, selectedSubtitle === track.index && styles.playerSettingChipActive]}><Text style={[styles.playerSettingChipText, selectedSubtitle === track.index && styles.playerSettingChipTextActive]}>{track.label}</Text></Pressable>)}
          </ScrollView>
        </View> : null}
      </View>}
      {loading && !video ? <ActivityIndicator color={theme.mint} style={{ marginTop: 24 }}/> : video ? <>
        <View style={styles.videoMeta}><Text style={styles.videoTitle}>{video.title}</Text><Text style={styles.videoStats}>{formatCount(video.views_count)} views · {timeAgo(video.published_at || video.created_at)} · {video.category}</Text></View>
        <Surface style={styles.creatorCard}>
          <Pressable style={styles.creatorInfo} onPress={() => router.push({ pathname: "/creator/[id]", params: { id: video.creator_id } })}><Avatar profile={video.creator} size={46}/><View style={{ flex: 1 }}><Text style={styles.creatorName}>{video.creator?.display_name || "Creator"} {video.creator?.is_verified ? "✓" : ""}</Text><Text style={styles.creatorBio}>{video.creator?.username ? "@" + video.creator.username : "OmniTube creator"}</Text></View></Pressable>
          <ActionButton title={following ? "Following" : "Follow"} icon={following ? "checkmark" : "person-add-outline"} variant={following ? "secondary" : "primary"} onPress={() => void toggleFollow()}/>
        </Surface>
        <View style={styles.actions}>
          <Pressable onPress={() => void toggleLike()} style={[styles.action, liked && styles.actionActive]}><Ionicons name={liked ? "heart" : "heart-outline"} size={19} color={liked ? theme.coral : theme.text}/><Text style={styles.actionLabel}>{formatCount(likeCount)}</Text></Pressable>
          <Pressable onPress={() => void saveToPlaylist()} style={styles.action}><Ionicons name="bookmark-outline" size={19} color={theme.text}/><Text style={styles.actionLabel}>Save</Text></Pressable>
          <Pressable onPress={() => void repost()} style={styles.action}><Ionicons name="repeat-outline" size={19} color={theme.text}/><Text style={styles.actionLabel}>Repost</Text></Pressable>
          <Pressable onPress={() => void Share.share({ message: video.title + "\nomnitube:///watch/" + video.id })} style={styles.action}><Ionicons name="arrow-redo-outline" size={19} color={theme.text}/><Text style={styles.actionLabel}>Share</Text></Pressable>
        </View>
        {video.description ? <Surface style={styles.description}><Eyebrow>ABOUT THIS VIDEO</Eyebrow><Text style={styles.descriptionText}>{video.description}</Text></Surface> : null}
        <View style={styles.commentsSection}>
          <View style={styles.commentsHeading}><Text style={styles.commentsTitle}>Conversation</Text><Text style={styles.commentsCount}>{comments.length}</Text></View>
          <View style={styles.commentComposer}><Avatar profile={profile} size={33}/><TextInput value={commentBody} onChangeText={setCommentBody} placeholder={user ? "Leave a thoughtful comment…" : "Sign in to comment"} placeholderTextColor={theme.subtle} maxLength={3000} style={styles.commentInput}/><Pressable onPress={() => void sendComment()} disabled={!commentBody.trim() || commenting}><Ionicons name="send" size={19} color={commentBody.trim() ? theme.mint : theme.subtle}/></Pressable></View>
          {(showAllComments ? comments : comments.slice(0, 6)).map((comment) => <View key={comment.id} style={styles.comment}><Avatar profile={comment.author} size={32}/><View style={{ flex: 1 }}><View style={styles.commentByline}><Text style={styles.commentAuthor}>{comment.author?.display_name || "Creator"}</Text><Text style={styles.commentTime}>{timeAgo(comment.created_at)}</Text></View><Text style={styles.commentBody}>{comment.body}</Text></View></View>)}
          {!comments.length ? <Text style={styles.noComments}>No comments yet. Start a good conversation.</Text> : !showAllComments && comments.length > 6 ? <Pressable style={styles.viewAll} onPress={() => setShowAllComments(true)}><Text style={styles.viewAllText}>View all {comments.length} comments</Text></Pressable> : null}
        </View>
      </> : <Text style={styles.playerErrorText}>This video is unavailable.</Text>}
    </ScrollView>
  </AppScreen>;
}

const styles = StyleSheet.create({
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 },
  back: { width: 36, height: 36, borderRadius: 11, borderColor: theme.line, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  more: { width: 36, height: 36, borderRadius: 11, borderColor: theme.line, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  page: { paddingHorizontal: 15, paddingBottom: 30 },
  player: { width: "100%", aspectRatio: 16 / 9, borderRadius: 14, overflow: "hidden", backgroundColor: "#030408", borderWidth: 1, borderColor: theme.line },
  playerFallback: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 10 },
  playerErrorText: { color: theme.muted, fontSize: 11, textAlign: "center", lineHeight: 17 },
  retryButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 38, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel2 },
  retryButtonText: { color: theme.text, fontSize: 10, fontWeight: "800" },
  playerTools: { marginTop: 9, padding: 11, gap: 10, borderRadius: 13, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel },
  playerToolHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  playerToolTitle: { color: theme.muted, fontSize: 8, letterSpacing: 1.1, fontWeight: "900" },
  playerTime: { color: theme.muted, fontSize: 9, fontVariant: ["tabular-nums"] },
  playerProgress: { height: 4, overflow: "hidden", borderRadius: 5, backgroundColor: theme.panel3 },
  playerBuffered: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "#3A465E" },
  playerProgressFill: { height: 4, borderRadius: 5, backgroundColor: theme.mint },
  playerControlRow: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  playerControlButton: { minHeight: 33, paddingHorizontal: 9, gap: 4, borderRadius: 8, borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center", flexDirection: "row", backgroundColor: theme.panel2 },
  playerControlLabel: { color: theme.text, fontSize: 8, fontWeight: "900" },
  playerControlSpacer: { flex: 1, minWidth: 5 },
  playerSettingLabel: { color: theme.subtle, fontSize: 8, fontWeight: "900", letterSpacing: 0.7 },
  playerSettingChips: { flexDirection: "row", alignItems: "center", gap: 5 },
  playerSettingChip: { minHeight: 30, paddingHorizontal: 9, justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel2 },
  playerSettingChipActive: { borderColor: theme.mint, backgroundColor: theme.mintDark },
  playerSettingChipText: { color: theme.muted, fontSize: 9, fontWeight: "800" },
  playerSettingChipTextActive: { color: theme.mint },
  videoMeta: { paddingTop: 17, paddingBottom: 13 },
  videoTitle: { color: theme.text, fontSize: 20, lineHeight: 26, letterSpacing: -0.5, fontWeight: "900" },
  videoStats: { color: theme.muted, fontSize: 10, marginTop: 7 },
  creatorCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 9 },
  creatorInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  creatorName: { color: theme.text, fontSize: 12, fontWeight: "900" },
  creatorBio: { color: theme.muted, fontSize: 9, marginTop: 5 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12, marginBottom: 13 },
  action: { flex: 1, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  actionActive: { borderColor: "#FF8A9D4D", backgroundColor: "#FF8A9D12" },
  actionLabel: { color: theme.text, fontSize: 9, fontWeight: "800" },
  description: { marginTop: 2 },
  descriptionText: { color: "#D3D7E5", fontSize: 11, lineHeight: 19, marginTop: 9 },
  commentsSection: { marginTop: 22 },
  commentsHeading: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 13 },
  commentsTitle: { color: theme.text, fontSize: 16, fontWeight: "900" },
  commentsCount: { color: theme.muted, fontSize: 10, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: theme.panel2 },
  commentComposer: { flexDirection: "row", alignItems: "center", gap: 9, padding: 10, borderWidth: 1, borderColor: theme.line, borderRadius: 13, backgroundColor: theme.panel },
  commentInput: { flex: 1, color: theme.text, fontSize: 11, minHeight: 35 },
  comment: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 16 },
  commentByline: { flexDirection: "row", alignItems: "center", gap: 8 },
  commentAuthor: { color: theme.text, fontSize: 10, fontWeight: "900" },
  commentTime: { color: theme.subtle, fontSize: 8 },
  commentBody: { color: "#D3D7E5", fontSize: 11, lineHeight: 18, marginTop: 5 },
  noComments: { color: theme.muted, fontSize: 11, textAlign: "center", paddingVertical: 25 },
  viewAll: { paddingVertical: 13, alignItems: "center" },
  viewAllText: { color: theme.mint, fontSize: 10, fontWeight: "900" },
});