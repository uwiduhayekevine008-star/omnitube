import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatCount, timeAgo } from "../lib/media";
import type { VideoRow } from "../lib/types";
import { theme } from "../theme";
import { Avatar } from "./ui";

export default function VideoCard({ video, onLike, onSave }: { video: VideoRow; onLike?: () => void; onSave?: () => void }) {
  return <View style={styles.card}>
    <Link href={{ pathname: "/watch/[id]", params: { id: video.id } }} asChild>
      <Pressable style={({ pressed }) => [styles.media, pressed && { opacity: 0.9 }]}>
        {video.thumbnailUrl ? <Image source={{ uri: video.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} cachePolicy="memory-disk" /> :
          <View style={styles.thumbnailBlank}><Ionicons name="play-circle-outline" size={36} color={theme.violet} /></View>}
        <View style={styles.playBadge}><Ionicons name="play" size={16} color={theme.text} /></View>
        <View style={styles.durationBadge}><Text style={styles.duration}>{video.duration_seconds ? Math.floor(video.duration_seconds / 60) + ":" + String(Math.floor(video.duration_seconds % 60)).padStart(2, "0") : video.kind === "short" ? "SHORT" : "VIDEO"}</Text></View>
        {video.kind === "short" && <View style={styles.shortBadge}><Ionicons name="flash" size={10} color="#0C1512" /><Text style={styles.shortBadgeText}>SHORT</Text></View>}
      </Pressable>
    </Link>
    <View style={styles.meta}>
      <Link href={{ pathname: "/creator/[id]", params: { id: video.creator_id } }} asChild>
        <Pressable><Avatar profile={video.creator} size={38} /></Pressable>
      </Link>
      <View style={styles.copy}>
        <Link href={{ pathname: "/watch/[id]", params: { id: video.id } }} asChild>
          <Pressable><Text style={styles.title} numberOfLines={2}>{video.title}</Text></Pressable>
        </Link>
        <Link href={{ pathname: "/creator/[id]", params: { id: video.creator_id } }} asChild>
          <Pressable style={styles.creator}><Text style={styles.creatorName} numberOfLines={1}>{video.creator?.display_name || "Creator"}</Text>{video.creator?.is_verified && <Ionicons name="checkmark-circle" size={13} color={theme.mint} />}</Pressable>
        </Link>
        <Text style={styles.stats}>{formatCount(video.views_count)} views · {timeAgo(video.published_at || video.created_at)}</Text>
      </View>
      {onLike && <Pressable onPress={onLike} hitSlop={8} style={styles.action}><Ionicons name="heart-outline" size={19} color={theme.muted} /></Pressable>}
      {onSave && <Pressable onPress={onSave} hitSlop={8} style={styles.action}><Ionicons name="bookmark-outline" size={18} color={theme.muted} /></Pressable>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, marginBottom: 8 },
  media: { aspectRatio: 16 / 9, overflow: "hidden", borderRadius: 15, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel2 },
  thumbnailBlank: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#171B29" },
  playBadge: { position: "absolute", left: "50%", top: "50%", width: 39, height: 39, marginLeft: -19.5, marginTop: -19.5, borderRadius: 20, backgroundColor: "#080A11B3", borderWidth: 1, borderColor: "#FFFFFF55", alignItems: "center", justifyContent: "center", paddingLeft: 2 },
  durationBadge: { position: "absolute", right: 7, bottom: 7, backgroundColor: "#070910D9", paddingHorizontal: 6, paddingVertical: 4, borderRadius: 5 },
  duration: { color: "white", fontSize: 9, fontWeight: "800" },
  shortBadge: { position: "absolute", top: 8, left: 8, flexDirection: "row", gap: 4, alignItems: "center", backgroundColor: theme.mint, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 6 },
  shortBadgeText: { color: "#0C1512", fontSize: 8, fontWeight: "900" },
  meta: { flexDirection: "row", alignItems: "flex-start", gap: 9, paddingTop: 10 },
  copy: { flex: 1, minWidth: 0 },
  title: { color: theme.text, fontWeight: "800", fontSize: 12, lineHeight: 17 },
  creator: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 },
  creatorName: { color: theme.muted, fontSize: 10, flexShrink: 1 },
  stats: { color: theme.subtle, fontSize: 9, marginTop: 5 },
  action: { padding: 3, marginTop: 1 },
});