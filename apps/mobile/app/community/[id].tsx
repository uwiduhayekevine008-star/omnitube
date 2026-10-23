import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppScreen, Avatar, Brand, Eyebrow, Surface } from "../../src/components/ui";
import { useAuth } from "../../src/lib/AuthContext";
import { formatCount, timeAgo } from "../../src/lib/media";
import { supabase } from "../../src/lib/supabase";
import type { CommentRow, PostRow, Profile } from "../../src/lib/types";
import { theme } from "../../src/theme";

export default function CommunityPostScreen(){
  const {id}=useLocalSearchParams<{id:string}>();
  const {user,profile}=useAuth();
  const [post,setPost]=useState<PostRow|null>(null);
  const [comments,setComments]=useState<CommentRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [body,setBody]=useState("");
  const [sending,setSending]=useState(false);
  const [liked,setLiked]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);
    const {data,error}=await supabase.from("posts").select("*").eq("id",id).eq("visibility","public").maybeSingle();
    if(error||!data){setPost(null);setLoading(false);if(error)Alert.alert("Post unavailable",error.message);return;}
    const row=data as PostRow;
    const {data:author}=await supabase.from("profiles").select("*").eq("id",row.creator_id).maybeSingle();
    setPost({...row,creator:author as Profile|null});
    const {data:commentRows,error:commentError}=await supabase.from("comments").select("*").eq("post_id",id).order("created_at",{ascending:false}).limit(100);
    if(!commentError&&commentRows){
      const entries=commentRows as CommentRow[];
      const ids=Array.from(new Set(entries.map(item=>item.user_id)));
      const {data:people}=ids.length?await supabase.from("profiles").select("*").in("id",ids):{data:[] as Profile[]};
      const map=new Map((people||[]).map(person=>[person.id,person as Profile]));
      setComments(entries.map(item=>({...item,author:map.get(item.user_id)||null})));
    }
    if(user){
      const {data:reaction}=await supabase.from("post_reactions").select("reaction").eq("post_id",id).eq("user_id",user.id).maybeSingle();
      setLiked(Boolean(reaction));
    }
    setLoading(false);
  },[id,user?.id]);
  useEffect(()=>{void load();},[load]);

  const toggleLike=async()=>{
    if(!post)return;
    if(!user){Alert.alert("Sign in to react","Join the community to like posts.");return;}
    const old=liked;setLiked(!old);
    const result=old?await supabase.from("post_reactions").delete().eq("post_id",post.id).eq("user_id",user.id)
      :await supabase.from("post_reactions").upsert({post_id:post.id,user_id:user.id,reaction:"like"});
    if(result.error){setLiked(old);Alert.alert("Reaction not saved",result.error.message);}
  };
  const sendComment=async()=>{
    const text=body.trim();if(!text||sending||!post)return;
    if(!user){Alert.alert("Sign in to comment","Your community activity follows your account.");return;}
    setSending(true);
    const {data,error}=await supabase.from("comments").insert({post_id:post.id,user_id:user.id,body:text}).select("*").single();
    setSending(false);
    if(error)Alert.alert("Comment not posted",error.message);
    else{setComments(old=>[{...(data as CommentRow),author:profile},...old]);setBody("");}
  };
  const report=async()=>{
    if(!user||!post){Alert.alert("Sign in to report","Reports are private.");return;}
    Alert.alert("Report this post","Choose a reason.",[
      {text:"Spam",onPress:()=>void submitReport("spam")},
      {text:"Harassment",onPress:()=>void submitReport("harassment")},
      {text:"Hate or abuse",onPress:()=>void submitReport("hate")},
      {text:"Other",onPress:()=>void submitReport("other")},
      {text:"Cancel",style:"cancel"}
    ]);
  };
  const submitReport=async(reason:string)=>{
    if(!user||!post)return;
    const {error}=await supabase.from("reports").insert({reporter_id:user.id,target_type:"post",target_id:post.id,reason});
    Alert.alert(error?"Report failed":"Report received",error?.message||"The concern has been saved for moderation review.");
  };

  return <AppScreen style={{paddingTop:0}}>
    <View style={styles.header}><Pressable style={styles.headerIcon} onPress={()=>router.back()}><Ionicons name="arrow-back" size={20} color={theme.text}/></Pressable><Brand/><Pressable style={styles.headerIcon} onPress={()=>void report()}><Ionicons name="shield-outline" size={19} color={theme.muted}/></Pressable></View>
    {loading?<View style={styles.loading}><ActivityIndicator color={theme.mint}/></View>:!post?<View style={styles.empty}><Eyebrow>COMMUNITY</Eyebrow><Text style={styles.emptyTitle}>Post unavailable.</Text><Text style={styles.emptyDetail}>It may have been removed or is not public.</Text></View>:
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Surface style={styles.post}>
          <Pressable style={styles.authorRow} onPress={()=>router.push({pathname:"/creator/[id]",params:{id:post.creator_id}})}><Avatar profile={post.creator} size={46}/><View style={{flex:1}}><Text style={styles.author}>{post.creator?.display_name||"Creator"} {post.creator?.is_verified?"✓":""}</Text><Text style={styles.date}>{timeAgo(post.created_at)} · Community post</Text></View><Pressable onPress={()=>void report()} hitSlop={8}><Ionicons name="ellipsis-horizontal" size={21} color={theme.muted}/></Pressable></Pressable>
          <Text style={styles.postBody}>{post.body}</Text>
          <View style={styles.postActions}>
            <Pressable onPress={()=>void toggleLike()} style={[styles.action,liked&&styles.actionLiked]}><Ionicons name={liked?"heart":"heart-outline"} size={18} color={liked?theme.coral:theme.text}/><Text style={styles.actionText}>{liked?"Liked":"Like"}</Text></Pressable>
            <Pressable style={styles.action} onPress={()=>void Share.share({message:post.body+"\nhttps://omnitube.app/community/"+post.id})}><Ionicons name="arrow-redo-outline" size={18} color={theme.text}/><Text style={styles.actionText}>Share</Text></Pressable>
          </View>
        </Surface>
        <View style={styles.commentSection}>
          <View style={styles.heading}><Text style={styles.commentsTitle}>Conversation</Text><Text style={styles.commentsCount}>{comments.length}</Text></View>
          <View style={styles.composer}><Avatar profile={profile} size={32}/><TextInput value={body} onChangeText={setBody} multiline maxLength={3000} style={styles.input} placeholder={user?"Add a thoughtful comment…":"Sign in to join the conversation"} placeholderTextColor={theme.subtle}/><Pressable onPress={()=>void sendComment()} disabled={!body.trim()||sending}><Ionicons name="send" size={19} color={body.trim()?theme.mint:theme.subtle}/></Pressable></View>
          {comments.map(comment=><View key={comment.id} style={styles.comment}><Avatar profile={comment.author} size={32}/><View style={{flex:1}}><View style={styles.commentByline}><Text style={styles.commentAuthor}>{comment.author?.display_name||"Creator"}</Text><Text style={styles.date}>{timeAgo(comment.created_at)}</Text></View><Text style={styles.commentBody}>{comment.body}</Text>{user?.id===comment.user_id&&<Pressable onPress={()=>Alert.alert("Delete this comment?","This cannot be undone.",[{text:"Cancel",style:"cancel"},{text:"Delete",style:"destructive",onPress:()=>void deleteComment(comment.id)}])} style={styles.commentDelete}><Text style={styles.deleteText}>Delete</Text></Pressable>}</View></View>)}
          {comments.length===0?<Text style={styles.noComments}>No comments yet. Be the first to add something meaningful.</Text>:null}
        </View>
      </ScrollView>}
  </AppScreen>;

  async function deleteComment(commentId:string){
    if(!user)return;
    const {error}=await supabase.from("comments").delete().eq("id",commentId).eq("user_id",user.id);
    if(error)Alert.alert("Comment not deleted",error.message);
    else setComments(old=>old.filter(row=>row.id!==commentId));
  }
}
const styles=StyleSheet.create({
  header:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingTop:12,paddingHorizontal:15,paddingBottom:13},
  headerIcon:{width:35,height:35,borderRadius:11,borderWidth:1,borderColor:theme.line,alignItems:"center",justifyContent:"center"},
  page:{paddingHorizontal:15,paddingBottom:30},
  post:{padding:16},
  authorRow:{flexDirection:"row",alignItems:"center",gap:10},
  author:{color:theme.text,fontSize:12,fontWeight:"900"},
  date:{color:theme.subtle,fontSize:9,marginTop:4},
  postBody:{color:"#E7E9F4",fontSize:14,lineHeight:23,marginTop:19},
  postActions:{flexDirection:"row",gap:9,borderTopColor:theme.line,borderTopWidth:1,marginTop:17,paddingTop:12},
  action:{minHeight:36,paddingHorizontal:13,borderWidth:1,borderColor:theme.line,borderRadius:10,flexDirection:"row",alignItems:"center",gap:7},
  actionLiked:{borderColor:"#FF8A9D45",backgroundColor:"#FF8A9D0E"},
  actionText:{color:theme.text,fontSize:10,fontWeight:"800"},
  commentSection:{marginTop:23},
  heading:{flexDirection:"row",alignItems:"center",gap:8,marginBottom:14},
  commentsTitle:{color:theme.text,fontSize:16,fontWeight:"900"},
  commentsCount:{color:theme.muted,fontSize:10,backgroundColor:theme.panel2,borderRadius:6,paddingHorizontal:7,paddingVertical:4},
  composer:{flexDirection:"row",alignItems:"center",gap:9,padding:10,borderRadius:13,borderWidth:1,borderColor:theme.line,backgroundColor:theme.panel},
  input:{flex:1,minHeight:38,maxHeight:110,color:theme.text,fontSize:11,textAlignVertical:"center"},
  comment:{flexDirection:"row",alignItems:"flex-start",gap:9,marginTop:16},
  commentByline:{flexDirection:"row",gap:8,alignItems:"center"},
  commentAuthor:{color:theme.text,fontSize:10,fontWeight:"900"},
  commentBody:{color:"#D5DAE9",fontSize:11,lineHeight:18,marginTop:5},
  commentDelete:{alignSelf:"flex-start",marginTop:7},
  deleteText:{color:theme.coral,fontSize:8,fontWeight:"900"},
  noComments:{color:theme.muted,fontSize:11,textAlign:"center",paddingVertical:30},
  loading:{flex:1,alignItems:"center",justifyContent:"center"},
  empty:{flex:1,alignItems:"center",justifyContent:"center",padding:25},
  emptyTitle:{color:theme.text,fontSize:18,fontWeight:"900",marginTop:10},
  emptyDetail:{color:theme.muted,fontSize:11,textAlign:"center",marginTop:7},
});