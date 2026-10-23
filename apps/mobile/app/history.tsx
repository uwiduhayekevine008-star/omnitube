import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { AppScreen, Avatar, Brand, EmptyState, Eyebrow } from "../src/components/ui";
import VideoCard from "../src/components/VideoCard";
import { useAuth } from "../src/lib/AuthContext";
import { formatCount, hydrateVideos, timeAgo } from "../src/lib/media";
import { supabase } from "../src/lib/supabase";
import type { VideoRow } from "../src/lib/types";
import { theme } from "../src/theme";

type HistoryRow = { video_id: string; created_at: string; watch_seconds: number };

export default function HistoryScreen(){
  const {user}=useAuth();
  const [videos,setVideos]=useState<VideoRow[]>([]);
  const [timestamps,setTimestamps]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const load=useCallback(async(refresh=false)=>{
    if(!user){setVideos([]);setLoading(false);return;}
    if(refresh)setRefreshing(true);else setLoading(true);
    const {data,error}=await supabase.from("video_views").select("video_id,created_at,watch_seconds").eq("viewer_id",user.id).order("created_at",{ascending:false}).limit(1000);
    if(error){Alert.alert("Watch history unavailable",error.message);setLoading(false);setRefreshing(false);return;}
    const recent:HistoryRow[]=[];const found=new Set<string>();const times:Record<string,string>={};
    (data||[]).forEach((row)=>{
      if(found.has(row.video_id))return;
      found.add(row.video_id);recent.push(row as HistoryRow);times[row.video_id]=row.created_at;
    });
    setTimestamps(times);
    const ids=recent.map(row=>row.video_id);
    if(!ids.length){setVideos([]);setLoading(false);setRefreshing(false);return;}
    const {data:foundVideos,error:videoError}=await supabase.from("videos").select("*").in("id",ids);
    if(videoError){Alert.alert("Could not load watched videos",videoError.message);setVideos([]);}
    else{
      const hydrated=await hydrateVideos((foundVideos||[]) as VideoRow[]);
      setVideos(ids.map(id=>hydrated.find(row=>row.id===id)).filter(Boolean) as VideoRow[]);
    }
    setLoading(false);setRefreshing(false);
  },[user?.id]);
  useEffect(()=>{void load();},[load]);

  const remove=async(video:VideoRow)=>{
    if(!user)return;
    const {error}=await supabase.from("video_views").delete().eq("viewer_id",user.id).eq("video_id",video.id);
    if(error)Alert.alert("History item not removed",error.message);
    else{setVideos(old=>old.filter(row=>row.id!==video.id));setTimestamps(old=>{const next={...old};delete next[video.id];return next;});}
  };
  const clearAll=()=>{
    if(!user||!videos.length)return;
    Alert.alert("Clear watch history?","This removes your stored watch-history records. It does not delete videos or your playlists.",[
      {text:"Cancel",style:"cancel"},
      {text:"Clear history",style:"destructive",onPress:()=>void (async()=>{
        const {error}=await supabase.from("video_views").delete().eq("viewer_id",user.id);
        if(error)Alert.alert("History not cleared",error.message);else{setVideos([]);setTimestamps({});}
      })()}
    ]);
  };

  return <AppScreen style={{paddingTop:0}}>
    <View style={styles.topbar}><Pressable style={styles.back} onPress={()=>router.back()}><Ionicons name="arrow-back" size={20} color={theme.text}/></Pressable><Brand/><Pressable style={styles.clear} onPress={clearAll}><Ionicons name="trash-outline" size={17} color={theme.coral}/><Text style={styles.clearText}>Clear</Text></Pressable></View>
    <FlatList data={videos} keyExtractor={item=>item.id} contentContainerStyle={styles.list} ItemSeparatorComponent={()=> <View style={{height:12}}/>}
      refreshControl={<RefreshControl tintColor={theme.mint} colors={[theme.mint]} refreshing={refreshing} onRefresh={()=>void load(true)}/>}
      renderItem={({item})=><View style={styles.row}><View style={styles.card}><VideoCard video={item}/><View style={styles.historyDetails}><Ionicons name="time-outline" size={13} color={theme.muted}/><Text style={styles.historyText}>Watched {timeAgo(timestamps[item.id])}</Text><Text style={styles.historyText}>· {formatCount(item.views_count)} views</Text></View></View><Pressable onPress={()=>void remove(item)} style={styles.remove} hitSlop={8}><Ionicons name="close" size={18} color={theme.muted}/></Pressable></View>}
      ListHeaderComponent={<View style={styles.heading}><Eyebrow>YOUR ACTIVITY</Eyebrow><Text style={styles.title}>Watch history</Text><Text style={styles.subtitle}>Pick up where you left off on any device.</Text></View>}
      ListEmptyComponent={!loading?<EmptyState icon="time-outline" title="Your next rewatch is waiting." detail="Sign in and watch videos to build a private history that syncs across your devices."/>:<ActivityIndicator color={theme.mint} style={{marginTop:35}}/>}
    />
  </AppScreen>;
}
const styles=StyleSheet.create({
  topbar:{paddingHorizontal:15,paddingTop:13,paddingBottom:10,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  back:{width:35,height:35,borderRadius:11,borderWidth:1,borderColor:theme.line,alignItems:"center",justifyContent:"center"},
  clear:{flexDirection:"row",alignItems:"center",gap:4,padding:8},
  clearText:{color:theme.coral,fontSize:9,fontWeight:"900"},
  list:{paddingHorizontal:15,paddingBottom:25},
  heading:{paddingTop:13,paddingBottom:21},
  title:{color:theme.text,fontSize:28,fontWeight:"900",letterSpacing:-.8,marginTop:7},
  subtitle:{color:theme.muted,fontSize:11,marginTop:6},
  row:{flexDirection:"row",alignItems:"flex-start",gap:8},
  card:{flex:1,minWidth:0},
  remove:{width:28,height:28,alignItems:"center",justifyContent:"center",borderRadius:9,borderWidth:1,borderColor:theme.line,backgroundColor:theme.panel},
  historyDetails:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:5,marginTop:6},
  historyText:{fontSize:8,color:theme.subtle},
});