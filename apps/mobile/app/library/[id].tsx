import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppScreen, ActionButton, Brand, Eyebrow, SectionTitle, Surface } from "../../src/components/ui";
import VideoCard from "../../src/components/VideoCard";
import { useAuth } from "../../src/lib/AuthContext";
import { hydrateVideos } from "../../src/lib/media";
import { supabase } from "../../src/lib/supabase";
import type { VideoRow } from "../../src/lib/types";
import { theme } from "../../src/theme";

type PlaylistRow={id:string;owner_id:string;title:string;description:string;visibility:string};
export default function PlaylistDetailScreen(){
  const {id}=useLocalSearchParams<{id:string}>();
  const {user}=useAuth();
  const [playlist,setPlaylist]=useState<PlaylistRow|null>(null);
  const [videos,setVideos]=useState<VideoRow[]>([]);
  const [suggested,setSuggested]=useState<VideoRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [loadingSuggestions,setLoadingSuggestions]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [search,setSearch]=useState("");
  const [editMode,setEditMode]=useState(false);
  const [title,setTitle]=useState("");
  const [description,setDescription]=useState("");
  const [visibility,setVisibility]=useState<"private"|"public"|"unlisted">("private");
  const [saving,setSaving]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);
    const {data:row,error}=await supabase.from("playlists").select("*").eq("id",id).maybeSingle();
    if(error||!row){if(error)Alert.alert("Playlist unavailable",error.message);setPlaylist(null);setVideos([]);setLoading(false);return;}
    const next=row as PlaylistRow;setPlaylist(next);setTitle(next.title);setDescription(next.description||"");setVisibility(next.visibility as "private"|"public"|"unlisted");
    const {data:items,itemError}=await supabase.from("playlist_items").select("video_id,position").eq("playlist_id",id).order("position",{ascending:true}).limit(500) as any;
    if(itemError){Alert.alert("Playlist items unavailable",itemError.message);setVideos([]);setLoading(false);return;}
    const ids=(items||[]).map((item:any)=>item.video_id);
    if(ids.length){
      const {data:videoRows,error:videoError}=await supabase.from("videos").select("*").in("id",ids);
      if(videoError)Alert.alert("Could not load playlist videos",videoError.message);
      else{const hydrated=await hydrateVideos((videoRows||[]) as VideoRow[]);setVideos(ids.map((videoId:string)=>hydrated.find(video=>video.id===videoId)).filter(Boolean) as VideoRow[]);}
    }else setVideos([]);
    setLoading(false);
  },[id]);
  useEffect(()=>{void load();},[load]);

  const loadSuggestions=async()=>{
    if(!user||!playlist)return;
    setLoadingSuggestions(true);
    const {data,error}=await supabase.from("videos").select("*").eq("status","published").eq("visibility","public").order("published_at",{ascending:false}).limit(80);
    if(error){Alert.alert("Could not find videos",error.message);setLoadingSuggestions(false);return;}
    const existing=new Set(videos.map(video=>video.id));
    const available=((data||[]) as VideoRow[]).filter(video=>!existing.has(video.id));
    const hydrated=await hydrateVideos(available);
    setSuggested(hydrated);setLoadingSuggestions(false);
  };

  const add=async(video:VideoRow)=>{
    if(!user||!playlist)return;
    const {error}=await supabase.from("playlist_items").upsert({playlist_id:playlist.id,video_id:video.id,position:videos.length},{onConflict:"playlist_id,video_id"});
    if(error){Alert.alert("Video not added",error.message);return;}
    setVideos(old=>[...old,video]);setSuggested(old=>old.filter(row=>row.id!==video.id));
  };
  const remove=async(video:VideoRow)=>{
    if(!playlist)return;
    const {error}=await supabase.from("playlist_items").delete().eq("playlist_id",playlist.id).eq("video_id",video.id);
    if(error)Alert.alert("Video not removed",error.message);else setVideos(old=>old.filter(row=>row.id!==video.id));
  };
  const savePlaylist=async()=>{
    if(!user||!playlist||!title.trim())return;
    setSaving(true);
    const {data,error}=await supabase.from("playlists").update({title:title.trim(),description:description.trim(),visibility,updated_at:new Date().toISOString()}).eq("id",playlist.id).eq("owner_id",user.id).select("*").single();
    setSaving(false);
    if(error)Alert.alert("Playlist not updated",error.message);else{setPlaylist(data as PlaylistRow);setEditMode(false);Alert.alert("Playlist updated","Your collection details have been saved.");}
  };
  const deletePlaylist=()=>{
    if(!user||!playlist)return;
    Alert.alert("Delete playlist?", "This removes playlist references, not the original videos.",[
      {text:"Cancel",style:"cancel"},
      {text:"Delete",style:"destructive",onPress:()=>void (async()=>{
        const {error}=await supabase.from("playlists").delete().eq("id",playlist.id).eq("owner_id",user.id);
        if(error)Alert.alert("Playlist not deleted",error.message);else router.replace("/library");
      })()}
    ]);
  };

  const visibleSuggestions=suggested.filter(video=>!search.trim()||video.title.toLowerCase().includes(search.trim().toLowerCase())||video.description.toLowerCase().includes(search.trim().toLowerCase()));
  return <AppScreen style={{paddingTop:0}}>
    <View style={styles.topbar}><Pressable style={styles.topIcon} onPress={()=>router.back()}><Ionicons name="arrow-back" size={20} color={theme.text}/></Pressable><Brand/><Pressable style={styles.topIcon} onPress={()=>setEditMode(old=>!old)}><Ionicons name={editMode?"close":"settings-outline"} size={18} color={theme.mint}/></Pressable></View>
    {loading?<View style={styles.loading}><ActivityIndicator color={theme.mint}/></View>:!playlist?<View style={styles.loading}><Text style={styles.notFound}>Playlist not found.</Text></View>:
      <FlatList data={videos} numColumns={2} keyExtractor={item=>item.id} columnWrapperStyle={styles.videoRow} contentContainerStyle={styles.list} renderItem={({item})=><View style={styles.videoItem}><VideoCard video={item}/><Pressable style={styles.removeItem} onPress={()=>void remove(item)}><Ionicons name="remove-circle-outline" size={15} color={theme.coral}/><Text style={styles.removeText}>Remove</Text></Pressable></View>}
        ListHeaderComponent={<View>
          <View style={styles.hero}><View style={styles.heroOrb}/><Eyebrow>OMNITUBE COLLECTION</Eyebrow><Text style={styles.title}>{playlist.title}</Text><Text style={styles.description}>{playlist.description||"A personal collection of videos."}</Text><View style={styles.meta}><Ionicons name={playlist.visibility==="private"?"lock-closed-outline":playlist.visibility==="unlisted"?"link-outline":"globe-outline"} size={13} color={theme.muted}/><Text style={styles.metaText}>{playlist.visibility} · {videos.length} videos</Text></View><View style={styles.heroActions}><ActionButton title={showAdd?"Done adding":"Add videos"} icon={showAdd?"checkmark":"add"} onPress={()=>{const next=!showAdd;setShowAdd(next);if(next&&suggested.length===0)void loadSuggestions();}}/><Pressable style={styles.deletePlaylist} onPress={deletePlaylist}><Ionicons name="trash-outline" size={17} color={theme.coral}/><Text style={styles.deletePlaylistText}>Delete playlist</Text></Pressable></View></View>
          {editMode&&<Surface style={styles.editCard}><Text style={styles.editHeading}>Playlist settings</Text><Text style={styles.label}>TITLE</Text><TextInput value={title} onChangeText={setTitle} maxLength={120} style={styles.input} placeholderTextColor={theme.subtle}/><Text style={styles.label}>DESCRIPTION</Text><TextInput value={description} onChangeText={setDescription} maxLength={1000} multiline style={[styles.input,{minHeight:70,textAlignVertical:"top",paddingTop:11}]} placeholder="Describe this collection" placeholderTextColor={theme.subtle}/><Text style={styles.label}>VISIBILITY</Text><View style={styles.visRow}>{(["private","unlisted","public"] as const).map(value=><Pressable key={value} onPress={()=>setVisibility(value)} style={[styles.visChip,visibility===value&&styles.visChipActive]}><Text style={[styles.visText,visibility===value&&styles.visTextActive]}>{value}</Text></Pressable>)}</View><ActionButton title="Save playlist settings" icon="checkmark-circle-outline" busy={saving} disabled={!title.trim()} onPress={()=>void savePlaylist()}/></Surface>}
          {showAdd&&<Surface style={styles.addCard}><SectionTitle title="Add from OmniTube" detail="Select published public videos for this collection."/><View style={styles.search}><Ionicons name="search" size={17} color={theme.subtle}/><TextInput value={search} onChangeText={setSearch} style={styles.searchInput} placeholder="Search available videos…" placeholderTextColor={theme.subtle}/></View>{loadingSuggestions?<ActivityIndicator color={theme.mint} style={{marginVertical:15}}/>:visibleSuggestions.slice(0,16).map(video=><View key={video.id} style={styles.suggestRow}><View style={{flex:1,minWidth:0}}><Text style={styles.suggestTitle} numberOfLines={2}>{video.title}</Text><Text style={styles.suggestCreator} numberOfLines={1}>{video.creator?.display_name||"Creator"}</Text></View><Pressable onPress={()=>void add(video)} style={styles.addButton}><Ionicons name="add" size={18} color="#071712"/></Pressable></View>)}{!loadingSuggestions&&!visibleSuggestions.length?<Text style={styles.noSuggest}>No videos available for that search.</Text>:null}</Surface>}
          <SectionTitle title="Videos in this playlist" detail="Tap a video to watch. Remove items without deleting originals."/>
        </View>}
        ListEmptyComponent={<View style={styles.empty}><Ionicons name="albums-outline" size={27} color={theme.violet}/><Text style={styles.emptyTitle}>A fresh collection.</Text><Text style={styles.emptyText}>Add public videos from OmniTube to start filling this playlist.</Text><ActionButton title="Add videos" icon="add" onPress={()=>{setShowAdd(true);if(!suggested.length)void loadSuggestions();}}/></View>}
        ListFooterComponent={<View style={{height:25}}/>}
      />}
  </AppScreen>;
}
const styles=StyleSheet.create({
  topbar:{paddingHorizontal:15,paddingTop:13,paddingBottom:12,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  topIcon:{width:35,height:35,borderRadius:11,borderWidth:1,borderColor:theme.line,alignItems:"center",justifyContent:"center"},
  loading:{flex:1,alignItems:"center",justifyContent:"center"},
  notFound:{color:theme.text,fontSize:14,fontWeight:"800"},
  list:{paddingHorizontal:15,paddingBottom:22},
  hero:{position:"relative",overflow:"hidden",backgroundColor:"#16182A",borderRadius:18,borderWidth:1,borderColor:"#A99AFF2A",padding:18},
  heroOrb:{position:"absolute",right:-45,top:-65,width:180,height:180,borderRadius:100,backgroundColor:"#A99AFF19"},
  title:{color:theme.text,fontSize:27,fontWeight:"900",letterSpacing:-.8,marginTop:7},
  description:{color:"#B7BED0",fontSize:11,lineHeight:18,marginTop:8},
  meta:{flexDirection:"row",alignItems:"center",gap:5,marginTop:11},
  metaText:{fontSize:9,color:theme.muted,textTransform:"capitalize"},
  heroActions:{flexDirection:"row",alignItems:"center",gap:12,marginTop:15,flexWrap:"wrap"},
  deletePlaylist:{flexDirection:"row",alignItems:"center",gap:5,paddingHorizontal:8,paddingVertical:10},
  deletePlaylistText:{color:theme.coral,fontSize:9,fontWeight:"800"},
  editCard:{marginTop:12,gap:10},
  editHeading:{fontSize:14,color:theme.text,fontWeight:"900"},
  label:{fontSize:9,color:theme.muted,fontWeight:"900",letterSpacing:1},
  input:{minHeight:44,borderWidth:1,borderColor:theme.line,borderRadius:10,backgroundColor:theme.bg,paddingHorizontal:11,color:theme.text,fontSize:11},
  visRow:{flexDirection:"row",gap:7},
  visChip:{flex:1,alignItems:"center",borderWidth:1,borderColor:theme.line,borderRadius:9,paddingVertical:9,backgroundColor:theme.panel2},
  visChipActive:{borderColor:theme.mint,backgroundColor:"#63EAC812"},
  visText:{fontSize:9,color:theme.muted,textTransform:"capitalize",fontWeight:"800"},
  visTextActive:{color:theme.mint},
  addCard:{marginTop:12},
  search:{height:40,flexDirection:"row",alignItems:"center",gap:7,paddingHorizontal:10,borderWidth:1,borderColor:theme.line,borderRadius:10,backgroundColor:theme.bg},
  searchInput:{flex:1,color:theme.text,fontSize:10},
  suggestRow:{flexDirection:"row",alignItems:"center",gap:10,borderBottomWidth:1,borderBottomColor:theme.line,paddingVertical:11},
  suggestTitle:{color:theme.text,fontSize:10,fontWeight:"800"},
  suggestCreator:{color:theme.subtle,fontSize:8,marginTop:4},
  addButton:{width:32,height:32,borderRadius:10,alignItems:"center",justifyContent:"center",backgroundColor:theme.mint},
  noSuggest:{fontSize:10,color:theme.muted,textAlign:"center",padding:15},
  videoRow:{gap:12,alignItems:"flex-start"},
  videoItem:{flex:1,minWidth:0,marginBottom:9},
  removeItem:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:5,paddingVertical:7,borderWidth:1,borderColor:"#FF8A9D22",borderRadius:8},
  removeText:{fontSize:8,fontWeight:"900",color:theme.coral},
  empty:{alignItems:"center",padding:22,gap:9},
  emptyTitle:{color:theme.text,fontSize:14,fontWeight:"900"},
  emptyText:{color:theme.muted,fontSize:10,lineHeight:16,textAlign:"center",maxWidth:260},
});