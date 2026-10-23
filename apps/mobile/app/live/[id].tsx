import { Ionicons } from "@expo/vector-icons";
import { AudioSession, LiveKitRoom, TrackReferenceOrPlaceholder, VideoTrack, isTrackReference, useRoomContext, useTracks } from "@livekit/react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Track } from "livekit-client";
import { AppScreen, ActionButton, Avatar, Brand, EmptyState, Eyebrow } from "../../src/components/ui";
import { useAuth } from "../../src/lib/AuthContext";
import { getAccessToken, timeAgo } from "../../src/lib/media";
import { liveKitUrl, supabase } from "../../src/lib/supabase";
import type { LiveStreamRow, Profile, StreamMessageRow } from "../../src/lib/types";
import { theme } from "../../src/theme";

export default function LiveRoomScreen() {
  const { id, token: initialToken, role: initialRole } = useLocalSearchParams<{ id: string; token?: string; role?: string }>();
  const { user } = useAuth();
  const [stream, setStream] = useState<LiveStreamRow | null>(null);
  const [token, setToken] = useState(initialToken || "");
  const [isHost, setIsHost] = useState(initialRole === "publisher");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error: streamError } = await supabase.from("live_streams").select("*").eq("id", id).maybeSingle();
        if (streamError) throw streamError;
        if (!data) throw new Error("Live room not found or it is no longer available.");
        if (!active) return;
        setStream(data as LiveStreamRow);
        const host = Boolean(user?.id && data.creator_id === user.id);
        const role = initialRole === "publisher" && host ? "publisher" : "viewer";
        setIsHost(role === "publisher");
        if (!(role === "publisher" && initialToken)) {
          if (!user) throw new Error("Sign in before joining a live room.");
          if (role === "viewer" && (data.status !== "live" || data.visibility === "private")) throw new Error("This stream isn't available to viewers.");
          const { data: auth, error: tokenError } = await supabase.functions.invoke("livekit-token", { body: { streamId: id, role } });
          if (tokenError) throw tokenError;
          if (!auth?.token) throw new Error(auth?.error || "The live authorization service did not issue a token.");
          if (active) setToken(auth.token);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not open this live room.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [id, user?.id, initialToken, initialRole]);

  const finish = async (ended: boolean) => {
    if (ended && stream && user?.id && isHost) {
      const { error: closeError } = await supabase.from("live_streams").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", stream.id).eq("creator_id", user.id);
      if (closeError) Alert.alert("Could not update live status", closeError.message);
    }
    router.back();
  };

  if (loading) return <AppScreen><View style={styles.loading}><ActivityIndicator color={theme.mint} size="large"/><Text style={styles.loadingText}>Connecting to live room…</Text></View></AppScreen>;
  if (error || !stream || !token || !liveKitUrl) return <AppScreen style={styles.errorScreen}><Brand/><EmptyState icon="radio-outline" title="Live room unavailable." detail={error || (!liveKitUrl ? "Configure EXPO_PUBLIC_LIVEKIT_URL and LiveKit server credentials before joining a native room." : "Room authorization did not complete.")} action={<ActionButton title="Go back" icon="arrow-back" onPress={() => router.back()}/>}/></AppScreen>;

  return <AppScreen style={{paddingTop:0}}><View style={styles.topbar}><Pressable onPress={() => void finish(false)} style={styles.back}><Ionicons name="chevron-down" size={22} color={theme.text}/></Pressable><View style={styles.roomHeading}><View style={styles.liveDot}/><Text style={styles.roomStatus}>{isHost ? "YOU ARE LIVE" : "LIVE NOW"}</Text></View><Pressable style={styles.more} onPress={() => Alert.alert("Live room options", "Report or leave this room.", [{text:"Report",onPress:()=>void reportStream(stream.id,user?.id)}, {text:"Leave",style:"cancel",onPress:()=>void finish(false)}])}><Ionicons name="ellipsis-horizontal" size={20} color={theme.text}/></Pressable></View>
    <LiveKitRoom serverUrl={liveKitUrl} token={token} connect={true} audio={isHost} video={isHost} options={{ adaptiveStream: { pixelDensity: "screen" } }} onDisconnected={() => { if (!isHost) router.back(); }}>
      <RoomStage stream={stream} userId={user?.id || ""} isHost={isHost} onFinish={() => void finish(true)} onLeave={() => void finish(false)}/>
    </LiveKitRoom>
  </AppScreen>;
}

async function reportStream(streamId: string, userId?: string) {
  if (!userId) { Alert.alert("Sign in to report", "Reports are private."); return; }
  Alert.alert("Report live room", "Choose a reason.", [
    {text:"Spam",onPress:()=>void sendReport(streamId,userId,"spam")},
    {text:"Harassment",onPress:()=>void sendReport(streamId,userId,"harassment")},
    {text:"Hate or abuse",onPress:()=>void sendReport(streamId,userId,"hate")},
    {text:"Other",onPress:()=>void sendReport(streamId,userId,"other")},
    {text:"Cancel",style:"cancel"},
  ]);
}
async function sendReport(id:string,userId:string,reason:string){
  const {error}=await supabase.from("reports").insert({reporter_id:userId,target_type:"stream",target_id:id,reason});
  Alert.alert(error?"Report failed":"Report received",error?.message||"The concern was recorded for review.");
}

function RoomStage({stream,userId,isHost,onFinish,onLeave}:{stream:LiveStreamRow;userId:string;isHost:boolean;onFinish:()=>void;onLeave:()=>void}){
  const tracks = useTracks([Track.Source.Camera]);
  const room = useRoomContext();
  const [micOn,setMicOn] = useState(isHost);
  const [cameraOn,setCameraOn] = useState(isHost);
  const [messages,setMessages] = useState<StreamMessageRow[]>([]);
  const [profiles,setProfiles] = useState<Record<string,Profile>>({});
  const [body,setBody] = useState("");
  const [sending,setSending] = useState(false);

  useEffect(() => {
    let active = true;
    void (async()=>{
      const {data,error}=await supabase.from("stream_messages").select("*").eq("stream_id",stream.id).order("created_at",{ascending:false}).limit(100);
      if(error||!data||!active)return;
      const ordered=data as StreamMessageRow[];
      const ids=Array.from(new Set(ordered.map(row=>row.user_id)));
      const {data:people}=ids.length?await supabase.from("profiles").select("*").in("id",ids):{data:[] as Profile[]};
      const map:Record<string,Profile>={};(people||[]).forEach(person=>{map[person.id]=person as Profile;});
      if(active){setMessages(ordered);setProfiles(map);}
    })();
    const channel=supabase.channel("mobile-live-chat-"+stream.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"stream_messages",filter:"stream_id=eq."+stream.id},async(event)=>{
      const row=event.new as StreamMessageRow;
      const {data:person}=await supabase.from("profiles").select("*").eq("id",row.user_id).maybeSingle();
      if(!active)return;
      if(person)setProfiles(old=>({...old,[person.id]:person as Profile}));
      setMessages(old=>old.some(item=>item.id===row.id)?old:[row,...old].slice(0,100));
    }).subscribe();
    return ()=>{active=false;void supabase.removeChannel(channel);};
  },[stream.id]);

  const send=async()=>{
    const text=body.trim();if(!text||sending)return;
    if(!userId){Alert.alert("Sign in to chat","Join the conversation by signing in.");return;}
    setSending(true);
    const {data,error}=await supabase.from("stream_messages").insert({stream_id:stream.id,user_id:userId,body:text}).select("*").single();
    setSending(false);
    if(error)Alert.alert("Message not sent",error.message);
    else if(data){setMessages(old=>old.some(row=>row.id===data.id)?old:[data as StreamMessageRow,...old].slice(0,100));setBody("");}
  };

  return <View style={styles.stage}>
    <View style={styles.mediaStage}>
      {tracks.length ? <ScrollView contentContainerStyle={styles.trackGrid}>{tracks.map((track,index)=>isTrackReference(track)?<View key={track.participant.identity+"-"+index} style={[styles.trackCell,tracks.length===1&&styles.trackCellSingle]}><VideoTrack trackRef={track} style={StyleSheet.absoluteFill}/><View style={styles.trackName}><Text style={styles.trackNameText}>{track.participant.name||track.participant.identity}</Text></View></View>:<View key={"placeholder-"+index} style={styles.trackCell}/>)}</ScrollView> :
        <View style={styles.noVideo}><View style={styles.noVideoOrb}/><Ionicons name="radio" size={35} color={theme.violet}/><Text style={styles.noVideoTitle}>{stream.title}</Text><Text style={styles.noVideoDetail}>{isHost?"Camera is starting. You are broadcasting to your room.":"Waiting for the creator to share video."}</Text></View>}
      <View style={styles.mediaPill}><View style={styles.liveDot}/><Text style={styles.mediaPillText}>{isHost?"BROADCASTING":"WATCHING LIVE"}</Text></View>
    </View>
    <View style={styles.roomInfo}><View style={{flex:1}}><Text style={styles.streamTitle}>{stream.title}</Text><Text style={styles.streamCreator}>{stream.description||"A live moment on OmniTube"}</Text></View><Avatar profile={profiles[stream.creator_id]} size={37}/></View>
    <View style={styles.chatHeader}><Ionicons name="chatbubbles-outline" size={18} color={theme.mint}/><Text style={styles.chatHeading}>Live chat</Text><Text style={styles.chatCount}>{messages.length}</Text></View>
    <FlatList data={messages} keyExtractor={item=>item.id} inverted renderItem={({item})=><View style={styles.chatMessage}><Avatar profile={profiles[item.user_id]} size={27}/><View style={{flex:1}}><View style={styles.chatMeta}><Text style={styles.chatName}>{profiles[item.user_id]?.display_name||(item.user_id===userId?"You":"Creator")}</Text><Text style={styles.chatTime}>{timeAgo(item.created_at)}</Text></View><Text style={styles.chatBody}>{item.body}</Text></View></View>} contentContainerStyle={styles.chatList} ListEmptyComponent={<Text style={styles.chatEmpty}>No messages yet. Be the first to say hello.</Text>}/>
    <View style={styles.chatComposer}><TextInput value={body} onChangeText={setBody} maxLength={1000} placeholder="Say something kind…" placeholderTextColor={theme.subtle} style={styles.chatInput}/><Pressable disabled={!body.trim()||sending} onPress={()=>void send()} style={styles.sendButton}><Ionicons name="send" size={16} color="#081510"/></Pressable></View>
    <View style={styles.controls}>
      {isHost&&<><Pressable style={[styles.controlButton,!micOn&&styles.controlOff]} onPress={async()=>{try{const next=!micOn;await room.localParticipant.setMicrophoneEnabled(next);setMicOn(next);}catch(e){Alert.alert("Microphone unavailable",e instanceof Error?e.message:"Check microphone permissions.");}}}><Ionicons name={micOn?"mic":"mic-off"} size={19} color={theme.text}/><Text style={styles.controlText}>{micOn?"Mute":"Unmute"}</Text></Pressable><Pressable style={[styles.controlButton,!cameraOn&&styles.controlOff]} onPress={async()=>{try{const next=!cameraOn;await room.localParticipant.setCameraEnabled(next);setCameraOn(next);}catch(e){Alert.alert("Camera unavailable",e instanceof Error?e.message:"Check camera permissions.");}}}><Ionicons name={cameraOn?"videocam":"videocam-off"} size={19} color={theme.text}/><Text style={styles.controlText}>{cameraOn?"Camera off":"Camera on"}</Text></Pressable></>}
      <Pressable style={[styles.controlButton,styles.leaveButton]} onPress={isHost?onFinish:onLeave}><Ionicons name={isHost?"stop-circle-outline":"exit-outline"} size={19} color={theme.coral}/><Text style={[styles.controlText,{color:theme.coral}]}>{isHost?"End live":"Leave room"}</Text></Pressable>
    </View>
  </View>;
}
const styles=StyleSheet.create({
  loading:{flex:1,alignItems:"center",justifyContent:"center",gap:12},
  loadingText:{color:theme.muted,fontSize:11},
  errorScreen:{padding:20,justifyContent:"center"},
  topbar:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:14,paddingTop:9,paddingBottom:11},
  back:{width:36,height:36,borderRadius:11,borderWidth:1,borderColor:theme.line,alignItems:"center",justifyContent:"center"},
  more:{width:36,height:36,borderRadius:11,borderWidth:1,borderColor:theme.line,alignItems:"center",justifyContent:"center"},
  roomHeading:{flexDirection:"row",alignItems:"center",gap:7},
  liveDot:{width:6,height:6,borderRadius:4,backgroundColor:theme.coral},
  roomStatus:{color:theme.coral,fontSize:9,fontWeight:"900",letterSpacing:1},
  stage:{flex:1,paddingHorizontal:12,paddingBottom:10},
  mediaStage:{flex:1.1,minHeight:180,maxHeight:"49%",overflow:"hidden",borderRadius:15,borderWidth:1,borderColor:theme.line,backgroundColor:"#030408"},
  trackGrid:{flexGrow:1,gap:7,padding:5},
  trackCell:{width:"100%",height:190,overflow:"hidden",borderRadius:11,backgroundColor:theme.panel2},
  trackCellSingle:{height:"100%"},
  trackName:{position:"absolute",bottom:7,left:7,paddingHorizontal:7,paddingVertical:4,borderRadius:6,backgroundColor:"#080A11C9"},
  trackNameText:{color:theme.text,fontSize:9,fontWeight:"800"},
  noVideo:{flex:1,alignItems:"center",justifyContent:"center",padding:15,gap:10},
  noVideoOrb:{position:"absolute",width:190,height:190,borderRadius:100,backgroundColor:"#A99AFF10"},
  noVideoTitle:{color:theme.text,fontSize:14,fontWeight:"900",textAlign:"center"},
  noVideoDetail:{color:theme.muted,fontSize:10,textAlign:"center",lineHeight:16},
  mediaPill:{position:"absolute",top:9,left:9,flexDirection:"row",alignItems:"center",gap:6,paddingHorizontal:8,paddingVertical:6,borderRadius:7,backgroundColor:"#080A11E8"},
  mediaPillText:{color:theme.text,fontSize:8,fontWeight:"900",letterSpacing:.9},
  roomInfo:{flexDirection:"row",alignItems:"center",gap:10,paddingTop:11,paddingBottom:10},
  streamTitle:{color:theme.text,fontSize:15,fontWeight:"900",lineHeight:19},
  streamCreator:{color:theme.muted,fontSize:9,lineHeight:14,marginTop:4},
  chatHeader:{flexDirection:"row",alignItems:"center",gap:7,borderTopWidth:1,borderTopColor:theme.line,paddingTop:12,paddingBottom:8},
  chatHeading:{color:theme.text,fontSize:12,fontWeight:"900",flex:1},
  chatCount:{color:theme.muted,fontSize:9,backgroundColor:theme.panel2,borderRadius:6,paddingHorizontal:7,paddingVertical:4},
  chatList:{flexGrow:1,justifyContent:"flex-end",paddingVertical:4},
  chatMessage:{flexDirection:"row",alignItems:"flex-start",gap:8,paddingVertical:6},
  chatMeta:{flexDirection:"row",alignItems:"center",gap:8},
  chatName:{color:theme.text,fontSize:9,fontWeight:"900"},
  chatTime:{color:theme.subtle,fontSize:8},
  chatBody:{color:"#D7DCEB",fontSize:10,lineHeight:15,marginTop:3},
  chatEmpty:{color:theme.subtle,fontSize:10,textAlign:"center",paddingVertical:20},
  chatComposer:{flexDirection:"row",alignItems:"center",gap:7,borderWidth:1,borderColor:theme.line,borderRadius:12,backgroundColor:theme.panel,padding:5,paddingLeft:11},
  chatInput:{flex:1,height:37,color:theme.text,fontSize:11},
  sendButton:{width:32,height:32,borderRadius:10,backgroundColor:theme.mint,alignItems:"center",justifyContent:"center"},
  controls:{flexDirection:"row",gap:8,paddingTop:10},
  controlButton:{flex:1,minHeight:50,borderRadius:12,borderWidth:1,borderColor:theme.line,backgroundColor:theme.panel2,alignItems:"center",justifyContent:"center",gap:4},
  controlOff:{backgroundColor:"#FF8A9D12",borderColor:"#FF8A9D40"},
  leaveButton:{backgroundColor:"#FF8A9D10",borderColor:"#FF8A9D30"},
  controlText:{color:theme.text,fontSize:8,fontWeight:"900"},
});