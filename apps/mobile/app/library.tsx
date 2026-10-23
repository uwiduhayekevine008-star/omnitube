import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { AppScreen, ActionButton, Brand, EmptyState, Eyebrow, SectionTitle, Surface } from "../src/components/ui";
import { useAuth } from "../src/lib/AuthContext";
import { supabase } from "../src/lib/supabase";
import { theme } from "../src/theme";

type PlaylistRow={id:string;owner_id:string;title:string;description:string;visibility:string;created_at:string;updated_at:string};

export default function LibraryScreen(){
  const {user}=useAuth();
  const [playlists,setPlaylists]=useState<PlaylistRow[]>([]);
  const [counts,setCounts]=useState<Record<string,number>>({});
  const [loading,setLoading]=useState(true);
  const [showCreate,setShowCreate]=useState(false);
  const [title,setTitle]=useState("");
  const [description,setDescription]=useState("");
  const [visibility,setVisibility]=useState<"private"|"public"|"unlisted">("private");
  const [creating,setCreating]=useState(false);

  const load=useCallback(async()=>{
    if(!user){setPlaylists([]);setLoading(false);return;}
    setLoading(true);
    const {data,error}=await supabase.from("playlists").select("*").eq("owner_id",user.id).order("updated_at",{ascending:false}).limit(100);
    if(error){Alert.alert("Library unavailable",error.message);setPlaylists([]);setLoading(false);return;}
    const rows=(data||[]) as PlaylistRow[];
    setPlaylists(rows);
    if(rows.length){
      const ids=rows.map(row=>row.id);
      const {data:items}=await supabase.from("playlist_items").select("playlist_id").in("playlist_id",ids);
      const map:Record<string,number>={};(items||[]).forEach(item=>{map[item.playlist_id]=(map[item.playlist_id]||0)+1;});setCounts(map);
    }else setCounts({});
    setLoading(false);
  },[user?.id]);
  useEffect(()=>{void load();},[load]);

  const create=async()=>{
    if(!user){Alert.alert("Sign in to create a playlist","Your libraries are private to your account.");router.push("/(tabs)/profile");return;}
    if(!title.trim()||creating)return;
    setCreating(true);
    const {data,error}=await supabase.from("playlists").insert({owner_id:user.id,title:title.trim(),description:description.trim(),visibility}).select("*").single();
    setCreating(false);
    if(error){Alert.alert("Playlist not created",error.message);return;}
    setPlaylists(old=>[data as PlaylistRow,...old]);setCounts(old=>({...old,[data.id]:0}));setTitle("");setDescription("");setShowCreate(false);
    router.push({pathname:"/library/[id]",params:{id:data.id}});
  };
  const deletePlaylist=(row:PlaylistRow)=>{
    Alert.alert("Delete playlist?", "This removes the playlist and its saved-item references, not the original videos.", [
      {text:"Cancel",style:"cancel"},
      {text:"Delete",style:"destructive",onPress:()=>void (async()=>{
        const {error}=await supabase.from("playlists").delete().eq("id",row.id).eq("owner_id",user?.id||"");
        if(error)Alert.alert("Playlist not deleted",error.message);else{setPlaylists(old=>old.filter(item=>item.id!==row.id));setCounts(old=>{const next={...old};delete next[row.id];return next;});}
      })()}
    ]);
  };

  return <AppScreen style={{paddingTop:0}}>
    <View style={styles.topbar}><Pressable style={styles.back} onPress={()=>router.back()}><Ionicons name="arrow-back" size={20} color={theme.text}/></Pressable><Brand/><Pressable onPress={()=>setShowCreate(old=>!old)} style={styles.add}><Ionicons name={showCreate?"close":"add"} size={21} color="#071712"/></Pressable></View>
    <FlatList data={playlists} keyExtractor={item=>item.id} contentContainerStyle={styles.list}
      renderItem={({item})=><Pressable onPress={()=>router.push({pathname:"/library/[id]",params:{id:item.id}})} style={styles.playlist}>
        <View style={styles.playlistArt}><View style={styles.tile}><Ionicons name="play" size={18} color={theme.mint}/></View><View style={styles.tile}><Ionicons name="flash" size={18} color={theme.violet}/></View><View style={styles.tile}><Ionicons name="heart" size={18} color={theme.coral}/></View><View style={styles.tile}><Ionicons name="bookmark" size={18} color={theme.blue}/></View><View style={styles.countBadge}><Text style={styles.countBadgeText}>{counts[item.id]||0}</Text></View></View>
        <View style={styles.playlistInfo}><Text style={styles.playlistTitle}>{item.title}</Text><Text style={styles.playlistDescription} numberOfLines={2}>{item.description||"A personal collection of videos."}</Text><View style={styles.playlistMeta}><Ionicons name={item.visibility==="private"?"lock-closed-outline":item.visibility==="unlisted"?"link-outline":"globe-outline"} size={12} color={theme.muted}/><Text style={styles.metaText}>{item.visibility} · {counts[item.id]||0} videos</Text></View></View>
        <Pressable onPress={()=>deletePlaylist(item)} style={styles.more} hitSlop={8}><Ionicons name="ellipsis-vertical" size={17} color={theme.muted}/></Pressable>
      </Pressable>}
      ListHeaderComponent={<View>
        <Eyebrow>YOUR COLLECTIONS</Eyebrow><Text style={styles.title}>Your library.</Text><Text style={styles.subtitle}>Build playlists around every side of your world.</Text>
        {showCreate&&<Surface style={styles.createCard}><Text style={styles.createTitle}>New playlist</Text><Text style={styles.label}>NAME</Text><TextInput value={title} onChangeText={setTitle} maxLength={120} placeholder="A name you'll remember" placeholderTextColor={theme.subtle} style={styles.input}/><Text style={styles.label}>DESCRIPTION</Text><TextInput value={description} onChangeText={setDescription} maxLength={1000} placeholder="What's this collection for?" placeholderTextColor={theme.subtle} style={styles.input}/><Text style={styles.label}>VISIBILITY</Text><View style={styles.visibilityRow}>{(["private","unlisted","public"] as const).map(value=><Pressable key={value} onPress={()=>setVisibility(value)} style={[styles.visibility,value===visibility&&styles.visibilityActive]}><Text style={[styles.visibilityText,value===visibility&&styles.visibilityTextActive]}>{value}</Text></Pressable>)}</View><ActionButton title="Create playlist" icon="add-circle-outline" busy={creating} disabled={!title.trim()} onPress={()=>void create()}/></Surface>}
        <SectionTitle title="Playlists" detail="Private, public and unlisted collections." action={<Text style={styles.playlistNumber}>{playlists.length}</Text>}/>
        {loading?<ActivityIndicator color={theme.mint} style={{marginVertical:22}}/>:null}
      </View>}
      ListEmptyComponent={!loading?<EmptyState icon="albums-outline" title="Your library, your rules." detail="Create playlists for tutorials, inspiration, favorites, research or any collection you want to keep." action={<ActionButton title="Create your first playlist" icon="add-circle-outline" onPress={()=>setShowCreate(true)}/>}/>:null}
      ListFooterComponent={<View style={{height:25}}/>}
    />
  </AppScreen>;
}
const styles=StyleSheet.create({
  topbar:{paddingHorizontal:15,paddingTop:13,paddingBottom:17,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  back:{width:35,height:35,borderRadius:11,borderWidth:1,borderColor:theme.line,alignItems:"center",justifyContent:"center"},
  add:{width:35,height:35,borderRadius:11,backgroundColor:theme.mint,alignItems:"center",justifyContent:"center"},
  list:{paddingHorizontal:15,paddingBottom:22},
  title:{fontSize:29,color:theme.text,fontWeight:"900",letterSpacing:-.9,marginTop:6},
  subtitle:{fontSize:11,color:theme.muted,marginTop:7,marginBottom:12},
  playlist:{flexDirection:"row",alignItems:"center",gap:12,padding:11,borderRadius:15,borderWidth:1,borderColor:theme.line,backgroundColor:theme.panel,marginBottom:10},
  playlistArt:{width:93,height:89,borderRadius:11,overflow:"hidden",flexDirection:"row",flexWrap:"wrap",padding:4,gap:3,backgroundColor:"#1A1D2D",position:"relative"},
  tile:{width:39,height:38,borderRadius:7,backgroundColor:"#25283A",alignItems:"center",justifyContent:"center"},
  countBadge:{position:"absolute",bottom:5,right:5,borderRadius:5,backgroundColor:"#080A11D9",paddingHorizontal:5,paddingVertical:3},
  countBadgeText:{fontSize:8,color:theme.text,fontWeight:"900"},
  playlistInfo:{flex:1,minWidth:0},
  playlistTitle:{color:theme.text,fontSize:12,fontWeight:"900"},
  playlistDescription:{color:theme.muted,fontSize:9,lineHeight:14,marginTop:5},
  playlistMeta:{flexDirection:"row",alignItems:"center",gap:5,marginTop:8},
  metaText:{color:theme.subtle,fontSize:8,fontWeight:"700",textTransform:"capitalize"},
  more:{width:25,alignItems:"center"},
  playlistNumber:{color:theme.mint,fontSize:10,fontWeight:"900"},
  createCard:{gap:10,marginTop:8},
  createTitle:{color:theme.text,fontSize:15,fontWeight:"900"},
  label:{color:theme.muted,fontSize:9,fontWeight:"900",letterSpacing:1,marginTop:4},
  input:{minHeight:44,borderRadius:10,borderWidth:1,borderColor:theme.line,backgroundColor:theme.bg,color:theme.text,paddingHorizontal:12,fontSize:11},
  visibilityRow:{flexDirection:"row",gap:7},
  visibility:{flex:1,alignItems:"center",paddingVertical:9,borderRadius:9,borderWidth:1,borderColor:theme.line,backgroundColor:theme.panel2},
  visibilityActive:{borderColor:theme.mint,backgroundColor:"#63EAC812"},
  visibilityText:{color:theme.muted,fontSize:9,fontWeight:"800",textTransform:"capitalize"},
  visibilityTextActive:{color:theme.mint},
});