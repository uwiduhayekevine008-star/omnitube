import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppScreen, ActionButton, Avatar, Brand, Eyebrow, SectionTitle, Surface } from "../../src/components/ui";
import VideoCard from "../../src/components/VideoCard";
import { useAuth } from "../../src/lib/AuthContext";
import { formatCount, hydrateVideos } from "../../src/lib/media";
import { supabase } from "../../src/lib/supabase";
import type { Profile, VideoRow } from "../../src/lib/types";
import { theme } from "../../src/theme";

export default function CreatorScreen(){
  const {id}=useLocalSearchParams<{id:string}>();
  const {user}=useAuth();
  const [creator,setCreator]=useState<Profile|null>(null);
  const [videos,setVideos]=useState<VideoRow[]>([]);
  const [stats,setStats]=useState({followers:0,following:0,views:0});
  const [isFollowing,setIsFollowing]=useState(false);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);

  const load=useCallback(async(refresh=false)=>{
    if(refresh)setRefreshing(true);else setLoading(true);
    const {data:person,error}=await supabase.from("profiles").select("*").eq("id",id).maybeSingle();
    if(error||!person){if(error)Alert.alert("Creator unavailable",error.message);setCreator(null);setVideos([]);setLoading(false);setRefreshing(false);return;}
    setCreator(person as Profile);
    const [videoResult,followers,following,followState]=await Promise.all([
      supabase.from("videos").select("*").eq("creator_id",id).eq("status","published").eq("visibility","public").order("published_at",{ascending:false}).limit(60),
      supabase.from("follows").select("follower_id",{count:"exact",head:true}).eq("creator_id",id),
      supabase.from("follows").select("creator_id",{count:"exact",head:true}).eq("follower_id",id),
      user&&user.id!==id?supabase.from("follows").select("creator_id").eq("follower_id",user.id).eq("creator_id",id).maybeSingle():Promise.resolve({data:null}),
    ]);
    if(videoResult.error){Alert.alert("Creator videos unavailable",videoResult.error.message);}else{
      const rows=(videoResult.data||[]) as VideoRow[];
      setVideos(await hydrateVideos(rows));
      setStats({followers:followers.count||0,following:following.count||0,views:rows.reduce((sum,row)=>sum+Number(row.views_count||0),0)});
    }
    setIsFollowing(Boolean(followState.data));
    setLoading(false);setRefreshing(false);
  },[id,user?.id]);
  useEffect(()=>{void load();},[load]);

  const toggleFollow=async()=>{
    if(!creator)return;
    if(!user){Alert.alert("Follow this creator","Sign in to build your own following feed.",[{text:"Cancel"},{text:"Sign in",onPress:()=>router.push("/(tabs)/profile")}]);return;}
    if(user.id===creator.id){Alert.alert("Your channel","Edit your creator profile in the You tab.");return;}
    const was=isFollowing;setIsFollowing(!was);setStats(old=>({...old,followers:Math.max(0,old.followers+(was?-1:1))}));
    const result=was?await supabase.from("follows").delete().eq("follower_id",user.id).eq("creator_id",creator.id)
      :await supabase.from("follows").insert({follower_id:user.id,creator_id:creator.id});
    if(result.error){setIsFollowing(was);setStats(old=>({...old,followers:Math.max(0,old.followers+(was?1:-1))}));Alert.alert("Follow not updated",result.error.message);}
  };
  const report=()=>{
    if(!user||!creator){Alert.alert("Sign in to report", "Reports are private.");return;}
    Alert.alert("Report creator", "Choose a reason.",[
      {text:"Spam",onPress:()=>void submitReport("spam")},
      {text:"Harassment",onPress:()=>void submitReport("harassment")},
      {text:"Hate or abuse",onPress:()=>void submitReport("hate")},
      {text:"Other",onPress:()=>void submitReport("other")},
      {text:"Cancel",style:"cancel"}
    ]);
  };
  const submitReport=async(reason:string)=>{
    if(!user||!creator)return;
    const {error}=await supabase.from("reports").insert({reporter_id:user.id,target_type:"profile",target_id:creator.id,reason});
    Alert.alert(error?"Report failed":"Report received",error?.message||"The concern was recorded for review.");
  };

  return <AppScreen style={{paddingTop:0}}>
    <View style={styles.topbar}><Pressable style={styles.topIcon} onPress={()=>router.back()}><Ionicons name="arrow-back" size={20} color={theme.text}/></Pressable><Brand/><View style={styles.topRight}><Pressable style={styles.topIcon} onPress={()=>void Share.share({message:(creator?.display_name||"Creator")+" on OmniTube\nhttps://omnitube.app/creator/"+id})}><Ionicons name="arrow-redo-outline" size={18} color={theme.text}/></Pressable><Pressable style={styles.topIcon} onPress={report}><Ionicons name="shield-outline" size={18} color={theme.muted}/></Pressable></View></View>
    {loading?<View style={styles.loading}><ActivityIndicator color={theme.mint}/></View>:!creator?<View style={styles.empty}><Text style={styles.emptyTitle}>Creator not found.</Text><Text style={styles.emptyBody}>This channel may no longer be available.</Text></View>:
      <FlatList data={videos} numColumns={2} keyExtractor={item=>item.id} columnWrapperStyle={styles.videoRow} contentContainerStyle={styles.list}
        refreshControl={<RefreshControl tintColor={theme.mint} colors={[theme.mint]} refreshing={refreshing} onRefresh={()=>void load(true)}/>}
        renderItem={({item})=><VideoCard video={item}/>}
        ListHeaderComponent={<View>
          <View style={styles.cover}><View style={styles.coverOrbOne}/><View style={styles.coverOrbTwo}/><Eyebrow>OMNITUBE CREATOR</Eyebrow><View style={styles.coverStars}><Ionicons name="sparkles" size={15} color={theme.violet}/><Text style={styles.coverStarsText}>YOUR STORY, YOUR UNIVERSE</Text></View></View>
          <View style={styles.creatorPanel}>
            <View style={styles.creatorTop}><Avatar profile={creator} size={76}/><View style={{flex:1}}><Text style={styles.creatorName}>{creator.display_name}{creator.is_verified?" ✓":""}</Text><Text style={styles.handle}>{creator.username?"@"+creator.username:"Creator channel"}</Text><Text style={styles.memberSince}>Creator since {new Date(creator.created_at).toLocaleDateString(undefined,{month:"short",year:"numeric"})}</Text></View></View>
            {creator.bio?<Text style={styles.bio}>{creator.bio}</Text>:<Text style={styles.bioMuted}>This creator is building their channel. Follow to catch new stories.</Text>}
            {creator.website?<Text style={styles.website} onPress={()=>void Share.share({message:creator.website||""})}>{creator.website}</Text>:null}
            <View style={styles.stats}><View><Text style={styles.statValue}>{formatCount(stats.followers)}</Text><Text style={styles.statLabel}>FOLLOWERS</Text></View><View><Text style={styles.statValue}>{formatCount(stats.following)}</Text><Text style={styles.statLabel}>FOLLOWING</Text></View><View><Text style={styles.statValue}>{formatCount(stats.views)}</Text><Text style={styles.statLabel}>TOTAL VIEWS</Text></View></View>
            <ActionButton title={isFollowing?"Following":"Follow channel"} icon={isFollowing?"checkmark":"person-add-outline"} variant={isFollowing?"secondary":"primary"} onPress={()=>void toggleFollow()}/>
          </View>
          <View style={styles.sectionHead}><SectionTitle title="Published videos" detail="Public uploads from this creator."/></View>
          {loading?<ActivityIndicator color={theme.mint}/>:null}
        </View>}
        ListEmptyComponent={<View style={styles.noVideos}><Ionicons name="videocam-outline" size={24} color={theme.violet}/><Text style={styles.noVideosTitle}>No public videos yet.</Text><Text style={styles.noVideosBody}>When this creator publishes, their videos will appear here.</Text></View>}
        ListFooterComponent={<View style={{height:25}}/>}/>
    }
  </AppScreen>;
}
const styles=StyleSheet.create({
  topbar:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:14,paddingTop:12,paddingBottom:12},
  topRight:{flexDirection:"row",gap:7},
  topIcon:{width:35,height:35,borderWidth:1,borderColor:theme.line,borderRadius:11,alignItems:"center",justifyContent:"center"},
  loading:{flex:1,alignItems:"center",justifyContent:"center"},
  empty:{flex:1,alignItems:"center",justifyContent:"center",padding:24},
  emptyTitle:{color:theme.text,fontSize:18,fontWeight:"900"},
  emptyBody:{color:theme.muted,fontSize:11,marginTop:7,textAlign:"center"},
  list:{paddingHorizontal:15,paddingBottom:20},
  cover:{position:"relative",overflow:"hidden",height:145,borderRadius:16,padding:16,justifyContent:"flex-end",backgroundColor:"#18182B",borderWidth:1,borderColor:"#A99AFF24"},
  coverOrbOne:{position:"absolute",right:-20,top:-70,width:210,height:210,borderRadius:110,backgroundColor:"#A99AFF1C"},
  coverOrbTwo:{position:"absolute",left:90,bottom:-90,width:180,height:180,borderRadius:100,backgroundColor:"#63EAC80D"},
  coverStars:{flexDirection:"row",alignItems:"center",gap:7,marginTop:8},
  coverStarsText:{color:"#A8A2C8",fontSize:8,fontWeight:"900",letterSpacing:1},
  creatorPanel:{padding:15,marginTop:-1,backgroundColor:theme.panel,borderRadius:16,borderWidth:1,borderColor:theme.line},
  creatorTop:{flexDirection:"row",alignItems:"center",gap:12},
  creatorName:{color:theme.text,fontSize:18,fontWeight:"900",letterSpacing:-.4},
  handle:{color:theme.mint,fontSize:10,fontWeight:"800",marginTop:5},
  memberSince:{color:theme.subtle,fontSize:8,marginTop:5},
  bio:{color:"#C8CEDE",fontSize:11,lineHeight:18,marginTop:14},
  bioMuted:{color:theme.muted,fontSize:10,lineHeight:17,marginTop:14},
  website:{color:theme.blue,fontSize:10,marginTop:9},
  stats:{flexDirection:"row",justifyContent:"space-between",paddingVertical:15,marginTop:15,borderTopWidth:1,borderBottomWidth:1,borderColor:theme.line,marginBottom:13},
  statValue:{color:theme.text,fontSize:16,fontWeight:"900"},
  statLabel:{color:theme.subtle,fontSize:8,fontWeight:"900",letterSpacing:.7,marginTop:4},
  sectionHead:{marginTop:8},
  videoRow:{gap:12,alignItems:"flex-start"},
  noVideos:{alignItems:"center",paddingVertical:35,gap:7},
  noVideosTitle:{color:theme.text,fontSize:13,fontWeight:"900"},
  noVideosBody:{color:theme.muted,fontSize:10,textAlign:"center",lineHeight:16,maxWidth:280}
});