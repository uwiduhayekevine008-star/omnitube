import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { AppScreen, ActionButton, Avatar, Brand, EmptyState, Eyebrow, SectionTitle, Surface } from "../../src/components/ui";
import { useAuth } from "../../src/lib/AuthContext";
import { hydrateStreams, timeAgo } from "../../src/lib/media";
import { liveKitUrl, supabase } from "../../src/lib/supabase";
import type { LiveStreamRow } from "../../src/lib/types";
import { theme } from "../../src/theme";

export default function LiveScreen() {
  const { user, profile } = useAuth();
  const [streams, setStreams] = useState<LiveStreamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    const { data, error } = await supabase.from("live_streams")
      .select("*").in("status", ["live", "scheduled"]).eq("visibility", "public")
      .order("starts_at", { ascending: true }).limit(60);
    if (error) Alert.alert("Live directory unavailable", error.message);
    else setStreams(await hydrateStreams((data || []) as LiveStreamRow[]));
    setLoading(false); setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const goLive = async () => {
    if (!user) { Alert.alert("Sign in to go live", "You need a creator account to start a broadcast.", [{ text: "Cancel" }, { text: "Sign in", onPress: () => router.push("/(tabs)/profile") }]); return; }
    if (!liveKitUrl.startsWith("wss://") && !liveKitUrl.startsWith("ws://")) {
      Alert.alert("LiveKit needs configuration", "Set EXPO_PUBLIC_LIVEKIT_URL in apps/mobile/.env.local and configure LIVEKIT_API_KEY and LIVEKIT_API_SECRET in Supabase Edge Function secrets.");
      return;
    }
    if (!title.trim()) { Alert.alert("Give your stream a title", "A title makes it easier for the community to understand the live session."); return; }
    setStarting(true);
    const id = Crypto.randomUUID();
    const { data: created, error } = await supabase.from("live_streams").insert({
      id, creator_id: user.id, title: title.trim(), description: description.trim(),
      status: "live", visibility: "public", provider: "livekit", room_name: "omnitube-" + id,
    }).select("*").single();
    if (error || !created) { setStarting(false); Alert.alert("Could not create stream", error?.message || "The room was not created."); return; }
    const { data, error: tokenError } = await supabase.functions.invoke("livekit-token", { body: { streamId: id, role: "publisher" } });
    setStarting(false);
    if (tokenError || !data?.token) {
      await supabase.from("live_streams").update({ status: "cancelled", ended_at: new Date().toISOString() }).eq("id", id).eq("creator_id", user.id);
      Alert.alert("Broadcast authorization failed", tokenError?.message || data?.error || "Check the LiveKit secrets in Supabase.");
      return;
    }
    setShowSetup(false); setTitle(""); setDescription("");
    router.push({ pathname: "/live/[id]", params: { id, role: "publisher" } });
  };

  return <AppScreen style={{ paddingTop: 0 }}>
    <FlatList data={streams} keyExtractor={(item) => item.id} contentContainerStyle={styles.list}
      refreshControl={<RefreshControl tintColor={theme.mint} colors={[theme.mint]} refreshing={refreshing} onRefresh={() => void load(true)}/>}
      renderItem={({ item }) => <Pressable onPress={() => {
        if (item.status !== "live") { Alert.alert("Scheduled stream", "This broadcast has not started yet."); return; }
        if (!user) { Alert.alert("Sign in to watch live", "Create an account to join the realtime room."); return; }
        router.push({ pathname: "/live/[id]", params: { id: item.id, role: "viewer" } });
      }} style={styles.streamRow}>
        <View style={styles.streamPoster}><View style={styles.posterGlow}/><Ionicons name="radio" size={28} color={theme.violet}/><View style={[styles.statusPill, item.status === "live" && styles.statusLive]}><View style={[styles.dot, item.status !== "live" && { backgroundColor: theme.violet }]}/><Text style={[styles.statusText, item.status !== "live" && { color: theme.violet }]}>{item.status === "live" ? "LIVE NOW" : "SCHEDULED"}</Text></View><View style={styles.joinArrow}><Ionicons name="play" size={14} color="#071712"/></View></View>
        <View style={styles.streamInfo}><Text style={styles.streamTitle} numberOfLines={2}>{item.title}</Text><View style={styles.creatorLine}><Avatar profile={item.creator} size={24}/><Text style={styles.creatorName} numberOfLines={1}>{item.creator?.display_name || "Creator"}</Text>{item.creator?.is_verified && <Ionicons name="checkmark-circle" size={12} color={theme.mint}/>}</View><Text style={styles.streamDescription} numberOfLines={2}>{item.description || "Join a live moment with the OmniTube community."}</Text><Text style={styles.streamTime}>{item.status === "live" ? "Broadcasting now" : "Starts " + timeAgo(item.starts_at)}</Text></View>
      </Pressable>}
      ListHeaderComponent={<View>
        <View style={styles.header}><Brand/><Pressable style={styles.refreshIcon} onPress={() => void load(true)}><Ionicons name="refresh" size={19} color={theme.text}/></Pressable></View>
        <View style={styles.hero}><View style={styles.heroOrb}/><Eyebrow>REAL PEOPLE · REAL TIME</Eyebrow><Text style={styles.heroTitle}>Be there{"\n"}<Text style={{ color: theme.coral }}>as it happens.</Text></Text><Text style={styles.heroDetail}>Low-latency live video rooms with realtime audio, video and community chat.</Text><ActionButton title="Start a broadcast" icon="radio-outline" onPress={() => setShowSetup((value) => !value)}/><View style={styles.heroFoot}><View style={styles.dot}/><Text style={styles.heroFootText}>{streams.filter((stream) => stream.status === "live").length} public room(s) currently live</Text></View></View>
        {showSetup && <Surface style={styles.setupCard}><Eyebrow>ON-AIR STUDIO</Eyebrow><Text style={styles.setupTitle}>Set up your live session.</Text><Text style={styles.label}>STREAM TITLE</Text><TextInput value={title} onChangeText={setTitle} maxLength={180} placeholder="What are we getting into today?" placeholderTextColor={theme.subtle} style={styles.input}/><Text style={styles.label}>DESCRIPTION</Text><TextInput value={description} onChangeText={setDescription} maxLength={3000} multiline placeholder="Tell viewers why they should tune in." placeholderTextColor={theme.subtle} style={[styles.input,{minHeight:80,textAlignVertical:"top",paddingTop:12}]}/><ActionButton title="Go live now" icon="radio" busy={starting} onPress={() => void goLive()}/><Text style={styles.setupHint}>Requires your own configured LiveKit endpoint and server-only LiveKit credentials.</Text></Surface>}
        <SectionTitle title="Live & scheduled" detail="Discover who's on air and what's next." action={<Text style={styles.count}>{streams.length} rooms</Text>}/>
        {loading ? <ActivityIndicator color={theme.mint} style={{ marginVertical: 30 }}/> : null}
      </View>}
      ListEmptyComponent={!loading ? <EmptyState icon="radio-outline" title="The stage is yours." detail="No public creator is live right now. Start a broadcast once LiveKit is configured." action={<ActionButton title="Start a broadcast" icon="radio-outline" onPress={() => setShowSetup(true)}/>}/> : null}
      ListFooterComponent={<View style={{height:25}}/>}/>
  </AppScreen>;
}
const styles = StyleSheet.create({
  list:{paddingHorizontal:15,paddingBottom:20},
  header:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingTop:14,paddingBottom:16},
  refreshIcon:{width:36,height:36,borderRadius:11,borderWidth:1,borderColor:theme.line,alignItems:"center",justifyContent:"center",backgroundColor:theme.panel},
  hero:{position:"relative",overflow:"hidden",borderRadius:20,borderWidth:1,borderColor:"#FF8A9D2B",backgroundColor:"#1B1726",padding:19},
  heroOrb:{position:"absolute",right:-65,top:-80,width:225,height:225,borderRadius:120,backgroundColor:"#FF8A9D10"},
  heroTitle:{fontSize:35,lineHeight:37,color:theme.text,fontWeight:"900",letterSpacing:-1.3,marginTop:12},
  heroDetail:{fontSize:11,lineHeight:18,color:"#B3B5C9",marginTop:11,marginBottom:16,maxWidth:330},
  heroFoot:{flexDirection:"row",alignItems:"center",gap:7,marginTop:14},
  dot:{width:6,height:6,borderRadius:4,backgroundColor:theme.coral},
  heroFootText:{color:theme.muted,fontSize:9,fontWeight:"700"},
  setupCard:{marginTop:13,gap:10},
  setupTitle:{color:theme.text,fontSize:17,fontWeight:"900"},
  label:{marginTop:5,color:theme.muted,fontWeight:"900",fontSize:9,letterSpacing:1},
  input:{minHeight:47,borderWidth:1,borderColor:theme.line,borderRadius:11,paddingHorizontal:12,backgroundColor:theme.bg,color:theme.text,fontSize:12},
  setupHint:{color:theme.subtle,fontSize:9,lineHeight:14},
  count:{color:theme.mint,fontSize:10,fontWeight:"800"},
  streamRow:{flexDirection:"row",gap:12,padding:10,borderWidth:1,borderColor:theme.line,backgroundColor:theme.panel,borderRadius:15,marginBottom:11},
  streamPoster:{width:130,aspectRatio:1.05,borderRadius:11,backgroundColor:"#1A1C2E",borderWidth:1,borderColor:"#A99AFF25",alignItems:"center",justifyContent:"center",overflow:"hidden"},
  posterGlow:{position:"absolute",width:100,height:100,borderRadius:60,backgroundColor:"#A99AFF19"},
  statusPill:{position:"absolute",top:7,left:6,flexDirection:"row",gap:4,alignItems:"center",paddingHorizontal:6,paddingVertical:4,backgroundColor:"#090A11E6",borderRadius:5},
  statusLive:{backgroundColor:"#FF8A9D24"},
  statusText:{fontSize:7,fontWeight:"900",letterSpacing:.5,color:theme.coral},
  joinArrow:{position:"absolute",right:7,bottom:7,width:28,height:28,borderRadius:9,alignItems:"center",justifyContent:"center",backgroundColor:theme.mint},
  streamInfo:{flex:1,justifyContent:"center",minWidth:0},
  streamTitle:{color:theme.text,fontSize:13,lineHeight:18,fontWeight:"900"},
  creatorLine:{flexDirection:"row",alignItems:"center",gap:6,marginTop:8},
  creatorName:{color:theme.muted,fontSize:9,fontWeight:"700",maxWidth:130},
  streamDescription:{color:"#8E96AC",fontSize:9,lineHeight:14,marginTop:7},
  streamTime:{color:theme.subtle,fontSize:8,marginTop:7,fontWeight:"800"},
});