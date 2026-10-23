import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { File as ExpoFile } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import * as Crypto from "expo-crypto";
import { Upload } from "tus-js-client";
import { router } from "expo-router";
import { AppScreen, ActionButton, Avatar, Brand, Eyebrow, Surface, ui } from "../../src/components/ui";
import { useAuth } from "../../src/lib/AuthContext";
import { getAccessToken } from "../../src/lib/media";
import { isConfigured, supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";

type PickedAsset = ImagePicker.ImagePickerAsset;

export default function CreateScreen() {
  const { user, profile } = useAuth();
  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const [thumbnail, setThumbnail] = useState<PickedAsset | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [category, setCategory] = useState("Other");
  const [kind, setKind] = useState<"video" | "short">("video");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [allowComments, setAllowComments] = useState(true);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [busy, setBusy] = useState(false);

  const pickVideo = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert("Permission needed", "Allow OmniTube to access your video library to choose media for upload."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], allowsEditing: false, videoMaxDuration: 3600, quality: 1 });
    if (!result.canceled && result.assets[0]) {
      setAsset(result.assets[0]);
      if (!title.trim()) setTitle((result.assets[0].fileName || "").replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").slice(0, 180));
    }
  };
  const recordVideo = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera permission needed", "Allow camera access to record a video directly into your OmniTube upload flow.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["videos"],
      videoMaxDuration: 300,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const recorded = result.assets[0];
      setAsset(recorded);
      if (!title.trim()) setTitle((recorded.fileName || "My OmniTube video").replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").slice(0, 180));
    }
  };

  const pickThumbnail = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [16, 9], quality: 0.9 });
    if (!result.canceled && result.assets[0]) setThumbnail(result.assets[0]);
  };

  const uploadResumably = async (fileBlob: Blob, path: string, mimeType: string, accessToken: string) => {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
    const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    const endpoint = "https://" + projectRef + ".storage.supabase.co/storage/v1/upload/resumable";
    await new Promise<void>((resolve, reject) => {
      const task = new Upload(fileBlob, {
        endpoint,
        retryDelays: [0, 2000, 5000, 10000, 20000],
        chunkSize: 6 * 1024 * 1024,
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        headers: { apikey: publishableKey, authorization: "Bearer " + accessToken, "x-upsert": "false" },
        metadata: { bucketName: "omnitube-videos", objectName: path, contentType: mimeType, cacheControl: "3600" },
        onError: reject,
        onProgress: (sent, total) => setProgress(Math.round((sent / Math.max(total, 1)) * 100)),
        onSuccess: () => resolve(),
      });
      void task.findPreviousUploads().then((previous) => {
        if (previous.length) task.resumeFromPreviousUpload(previous[0]);
        task.start();
      }).catch(reject);
    });
  };

  const publish = async () => {
    if (!user) { Alert.alert("Sign in to publish", "Your creator studio and uploads are linked to your account.", [{ text: "Cancel" }, { text: "Sign in", onPress: () => router.push("/(tabs)/profile") }]); return; }
    if (!isConfigured) { Alert.alert("Supabase configuration needed", "Add the EXPO_PUBLIC Supabase URL and publishable key to apps/mobile/.env.local."); return; }
    if (!asset || !title.trim()) { Alert.alert("Add a video and a title", "Choose the original video and give it a clear title first."); return; }
    const mimeType = asset.mimeType || "video/mp4";
    if (!["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"].includes(mimeType)) { Alert.alert("Unsupported video", "Choose an MP4, WebM, MOV or MKV video."); return; }
    const approximateSize = asset.fileSize || 0;
    if (approximateSize > 200 * 1024 * 1024) { Alert.alert("Mobile upload size limit", "For reliability on mobile connections, this Expo upload currently supports videos up to 200 MB. Use the desktop Creator Studio for larger files."); return; }
    setBusy(true); setProgress(0); setPhase("Preparing upload");
    const id = Crypto.randomUUID();
    const name = asset.fileName || ("omnitube-" + id + ".mp4");
    const ext = (name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "mp4";
    const videoPath = user.id + "/" + id + "." + ext;
    try {
      const { error: insertError } = await supabase.from("videos").insert({
        id, creator_id: user.id, title: title.trim(), description: description.trim(), video_path: videoPath,
        visibility, kind, status: "draft", category,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
        allow_comments: allowComments,
        duration_seconds: asset.duration ? asset.duration / 1000 : null,
      });
      if (insertError) throw insertError;
      setPhase("Reading media from this device");
      const sourceFile = new ExpoFile(asset.uri);
      const size = sourceFile.size || approximateSize;
      if (!size || size > 200 * 1024 * 1024) throw new Error("Video must be between 1 byte and 200 MB for native mobile uploads.");
      const response = await expoFetch(asset.uri);
      const fileBlob = await response.blob();
      const accessToken = await getAccessToken();
      setPhase("Uploading securely");
      await uploadResumably(fileBlob, videoPath, mimeType, accessToken);

      if (thumbnail) {
        setPhase("Uploading thumbnail");
        const imageResponse = await expoFetch(thumbnail.uri);
        const imageBlob = await imageResponse.blob();
        const imageType = thumbnail.mimeType || "image/jpeg";
        if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(imageType)) throw new Error("Choose a JPEG, PNG, WebP or AVIF thumbnail.");
        const imagePath = user.id + "/" + id + "-thumbnail";
        const { error: thumbError } = await supabase.storage.from("omnitube-thumbnails").upload(imagePath, imageBlob, { contentType: imageType, upsert: false });
        if (thumbError) throw thumbError;
        const { error: updateThumbError } = await supabase.from("videos").update({ thumbnail_path: imagePath }).eq("id", id).eq("creator_id", user.id);
        if (updateThumbError) throw updateThumbError;
      }

      setPhase("Validating and publishing");
      const { data, error: publishError } = await supabase.functions.invoke("publish-video", { body: { videoId: id } });
      if (publishError) throw publishError;
      if (!data?.success) throw new Error(data?.error || "The server could not confirm the upload.");
      setProgress(100);
      Alert.alert("Your content is live", "The video has been uploaded and published to OmniTube.", [{ text: "View Creator Studio", onPress: () => router.push("/(tabs)/profile") }]);
      setAsset(null); setThumbnail(null); setTitle(""); setDescription(""); setTags(""); setKind("video");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The upload did not finish.";
      Alert.alert("Upload failed", message);
    } finally { setBusy(false); setPhase(""); }
  };

  return <AppScreen style={{ paddingTop: 0 }}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.top}><Brand/><View style={styles.creatorChip}><Avatar profile={profile} size={28}/><Text style={styles.creatorChipText} numberOfLines={1}>{profile?.display_name || "Creator"}</Text></View></View>
      <Eyebrow>CREATOR STUDIO / NATIVE</Eyebrow>
      <Text style={styles.heading}>Make something{"\n"}worth sharing.</Text>
      <Text style={styles.subtitle}>Resumable upload · Secure storage · Real publishing checks</Text>

      <Pressable onPress={() => void pickVideo()} disabled={busy} style={[styles.dropzone, asset && styles.dropzoneReady]}>
        <View style={styles.uploadIcon}><Ionicons name={asset ? "checkmark" : "cloud-upload-outline"} size={26} color={asset ? theme.mint : theme.violet}/></View>
        <Text style={styles.dropTitle}>{asset?.fileName || "Choose a video from your device"}</Text>
        <Text style={styles.dropDetail}>{asset ? ((asset.fileSize || 0) / (1024 * 1024)).toFixed(1) + " MB · " + (asset.duration ? Math.round(asset.duration / 1000) + " sec" : "Duration detected by player") : "MP4, WebM, MOV, MKV · up to 200 MB on mobile"}</Text>
        <View style={styles.selectMedia}><Ionicons name="folder-open-outline" size={15} color={theme.mint}/><Text style={styles.selectMediaText}>{asset ? "Replace video" : "Browse media library"}</Text></View>
      </Pressable>
      <View style={styles.captureRow}>
        <Pressable onPress={() => void recordVideo()} disabled={busy} style={styles.captureButton}>
          <Ionicons name="camera-outline" size={16} color={theme.mint}/>
          <Text style={styles.captureButtonText}>Record video</Text>
        </Pressable>
        <Text style={styles.captureHint}>Capture up to 5 minutes directly on your device.</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>CONTENT FORMAT</Text>
        <View style={styles.segment}><Pressable style={[styles.segmentItem, kind === "video" && styles.segmentActive]} onPress={() => setKind("video")}><Ionicons name="videocam-outline" size={16} color={kind === "video" ? "#071712" : theme.muted}/><Text style={[styles.segmentText, kind === "video" && styles.segmentTextActive]}>Long-form video</Text></Pressable><Pressable style={[styles.segmentItem, kind === "short" && styles.segmentActive]} onPress={() => setKind("short")}><Ionicons name="flash-outline" size={16} color={kind === "short" ? "#071712" : theme.muted}/><Text style={[styles.segmentText, kind === "short" && styles.segmentTextActive]}>Shorts</Text></Pressable></View>
        <Text style={styles.label}>TITLE <Text style={styles.count}>{title.length}/180</Text></Text>
        <TextInput value={title} onChangeText={setTitle} maxLength={180} placeholder="Make it easy to discover." placeholderTextColor={theme.subtle} style={ui.input}/>
        <Text style={styles.label}>DESCRIPTION</Text>
        <TextInput value={description} onChangeText={setDescription} maxLength={5000} multiline placeholder="What should viewers know?" placeholderTextColor={theme.subtle} style={[ui.input, ui.multiline]}/>
        <Text style={styles.label}>TOPIC</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>{["Other","Education","Gaming","Music","Technology","Lifestyle","Science","Sports","News","Comedy","Film"].map((value) => <Pressable key={value} onPress={() => setCategory(value)} style={[styles.category, category === value && styles.categoryActive]}><Text style={[styles.categoryText, category === value && styles.categoryTextActive]}>{value}</Text></Pressable>)}</ScrollView>
        <Text style={styles.label}>TAGS <Text style={styles.count}>OPTIONAL</Text></Text>
        <TextInput value={tags} onChangeText={setTags} placeholder="technology, tutorial, creator" placeholderTextColor={theme.subtle} style={ui.input}/>
        <Text style={styles.label}>THUMBNAIL</Text>
        <Pressable style={styles.thumbnailPicker} onPress={() => void pickThumbnail()} disabled={busy}><Ionicons name={thumbnail ? "image" : "image-outline"} size={19} color={theme.violet}/><View style={{ flex: 1 }}><Text style={styles.thumbTitle}>{thumbnail?.fileName || "Choose custom thumbnail"}</Text><Text style={styles.thumbDetail}>Private storage · signed viewer URL</Text></View><Ionicons name="chevron-forward" size={18} color={theme.muted}/></Pressable>
        <Text style={styles.label}>VISIBILITY</Text>
        <View style={styles.visibilityList}>{(["public","unlisted","private"] as const).map((value) => <Pressable key={value} onPress={() => setVisibility(value)} style={[styles.visibilityOption, visibility === value && styles.visibilitySelected]}><Ionicons name={value === "public" ? "globe-outline" : value === "unlisted" ? "link-outline" : "lock-closed-outline"} size={18} color={visibility === value ? theme.mint : theme.muted}/><View style={{ flex: 1 }}><Text style={styles.visibilityTitle}>{value[0].toUpperCase() + value.slice(1)}</Text><Text style={styles.visibilityDetail}>{value === "public" ? "Available in public discovery and search." : value === "unlisted" ? "Not listed in discovery; direct-link access only." : "Only you can access this upload."}</Text></View><Ionicons name={visibility === value ? "radio-button-on" : "radio-button-off"} size={18} color={visibility === value ? theme.mint : theme.subtle}/></Pressable>)}</View>
        <Pressable style={styles.commentToggle} onPress={() => setAllowComments((value) => !value)}><Ionicons name={allowComments ? "chatbubble-ellipses" : "chatbubble-ellipses-outline"} size={18} color={theme.mint}/><Text style={styles.commentToggleText}>Allow comments</Text><View style={[styles.switch, allowComments && styles.switchOn]}><View style={[styles.switchDot, allowComments && styles.switchDotOn]}/></View></Pressable>
        {busy ? <View style={styles.progressBox}><View style={styles.progressTop}><Text style={styles.progressPhase}>{phase}</Text><Text style={styles.progressPercent}>{progress}%</Text></View><View style={styles.progressTrack}><View style={[styles.progressFill, { width: (String(progress) + "%") as `${number}%` }]}/></View><Text style={styles.progressHint}>Keep OmniTube open while the server verifies the upload.</Text></View> : null}
        <ActionButton title={busy ? phase || "Publishing…" : "Upload & publish"} icon="cloud-upload-outline" busy={busy} disabled={!asset || !title.trim()} onPress={() => void publish()} />
        <Text style={styles.disclaimer}>Original media stays in a private storage bucket. Publishing is confirmed by the server; this app never ships a service-role key.</Text>
      </View>
    </ScrollView>
  </AppScreen>;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingBottom: 35 },
  top: { paddingTop: 13, paddingBottom: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  creatorChip: { maxWidth: 140, flexDirection: "row", alignItems: "center", gap: 7, padding: 5, paddingRight: 10, borderRadius: 99, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel },
  creatorChipText: { color: theme.muted, fontSize: 10, fontWeight: "800", flexShrink: 1 },
  heading: { color: theme.text, fontSize: 36, lineHeight: 39, fontWeight: "900", letterSpacing: -1.6, marginTop: 9 },
  subtitle: { color: theme.muted, fontSize: 11, lineHeight: 18, marginTop: 10, marginBottom: 20 },
  dropzone: { borderRadius: 17, borderWidth: 1, borderStyle: "dashed", borderColor: "#A99AFF55", backgroundColor: "#A99AFF09", minHeight: 178, padding: 17, alignItems: "center", justifyContent: "center" },
  dropzoneReady: { borderColor: "#63EAC85D", backgroundColor: "#63EAC809" },
  uploadIcon: { width: 49, height: 49, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel2 },
  dropTitle: { color: theme.text, fontSize: 12, fontWeight: "900", marginTop: 12, textAlign: "center" },
  dropDetail: { color: theme.muted, fontSize: 9, marginTop: 6, textAlign: "center" },
  selectMedia: { marginTop: 12, flexDirection: "row", gap: 7, alignItems: "center" },
  selectMediaText: { color: theme.mint, fontSize: 10, fontWeight: "900" },
  captureRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  captureButton: { minHeight: 37, borderRadius: 10, borderWidth: 1, borderColor: "#63EAC83D", backgroundColor: "#63EAC80C", paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7 },
  captureButtonText: { color: theme.mint, fontSize: 10, fontWeight: "900" },
  captureHint: { flex: 1, color: theme.subtle, fontSize: 8, lineHeight: 13 },
  form: { marginTop: 22, gap: 10 },
  label: { color: theme.muted, fontSize: 9, letterSpacing: 1.25, fontWeight: "900", marginTop: 10 },
  count: { color: theme.subtle, letterSpacing: 0, fontWeight: "700" },
  segment: { flexDirection: "row", borderRadius: 12, padding: 4, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.line, gap: 4 },
  segmentItem: { flex: 1, minHeight: 39, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 9 },
  segmentActive: { backgroundColor: theme.mint },
  segmentText: { color: theme.muted, fontSize: 10, fontWeight: "800" },
  segmentTextActive: { color: "#071712" },
  categoryRow: { gap: 7, paddingVertical: 2 },
  category: { borderRadius: 99, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.panel, paddingHorizontal: 11, paddingVertical: 8 },
  categoryActive: { borderColor: theme.mint, backgroundColor: "#63EAC81A" },
  categoryText: { color: theme.muted, fontSize: 10, fontWeight: "800" },
  categoryTextActive: { color: theme.mint },
  thumbnailPicker: { flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 12, backgroundColor: theme.panel },
  thumbTitle: { color: theme.text, fontSize: 11, fontWeight: "800" },
  thumbDetail: { color: theme.subtle, fontSize: 9, marginTop: 4 },
  visibilityList: { gap: 7 },
  visibilityOption: { flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderWidth: 1, borderColor: theme.line, borderRadius: 12, backgroundColor: theme.panel },
  visibilitySelected: { borderColor: "#63EAC84A", backgroundColor: "#63EAC809" },
  visibilityTitle: { color: theme.text, fontSize: 11, fontWeight: "900" },
  visibilityDetail: { color: theme.muted, fontSize: 9, lineHeight: 15, marginTop: 3 },
  commentToggle: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 8 },
  commentToggleText: { color: theme.text, fontSize: 11, fontWeight: "800", flex: 1 },
  switch: { width: 40, height: 23, borderRadius: 14, backgroundColor: theme.panel3, padding: 3, justifyContent: "center" },
  switchOn: { backgroundColor: "#63EAC84B" },
  switchDot: { width: 17, height: 17, borderRadius: 9, backgroundColor: "#8892A8" },
  switchDotOn: { alignSelf: "flex-end", backgroundColor: theme.mint },
  progressBox: { padding: 13, backgroundColor: theme.panel, borderRadius: 11, borderWidth: 1, borderColor: theme.line },
  progressTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 9 },
  progressPhase: { color: theme.muted, fontSize: 10, fontWeight: "800", flex: 1 },
  progressPercent: { color: theme.mint, fontSize: 10, fontWeight: "900" },
  progressTrack: { height: 5, backgroundColor: theme.panel3, borderRadius: 8, overflow: "hidden" },
  progressFill: { height: 5, backgroundColor: theme.mint, borderRadius: 8 },
  progressHint: { color: theme.subtle, fontSize: 9, lineHeight: 14, marginTop: 7 },
  disclaimer: { color: theme.subtle, fontSize: 9, lineHeight: 15, textAlign: "center", marginTop: 10 },
});