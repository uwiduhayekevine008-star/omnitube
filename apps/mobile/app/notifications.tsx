import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { AppScreen, Avatar, Brand, EmptyState, Eyebrow } from "../src/components/ui";
import { useAuth } from "../src/lib/AuthContext";
import { timeAgo } from "../src/lib/media";
import { supabase } from "../src/lib/supabase";
import { theme } from "../src/theme";

type NotificationRow = {
  id: string; recipient_id: string; actor_id: string | null; kind: string;
  entity_type: string | null; entity_id: string | null; body: string;
  read_at: string | null; created_at: string;
};

const notificationIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  follow: "person-add-outline", reaction: "heart-outline", comment: "chatbubble-ellipses-outline",
  repost: "repeat-outline", live: "radio-outline", mention: "at-outline", system: "sparkles-outline",
};
const iconFor = (kind: string): keyof typeof Ionicons.glyphMap => notificationIcons[kind] || "notifications-outline";

export default function NotificationsScreen() {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [actors, setActors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async (refresh = false) => {
    if (!user?.id) { setItems([]); setLoading(false); return; }
    if (refresh) setRefreshing(true); else setLoading(true);
    const { data, error } = await supabase.from("notifications").select("*").eq("recipient_id", user.id).order("created_at", { ascending: false }).limit(80);
    if (error) Alert.alert("Notifications unavailable", error.message);
    else {
      const rows = (data || []) as NotificationRow[];
      setItems(rows);
      const ids = Array.from(new Set(rows.map((row) => row.actor_id).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: people } = await supabase.from("profiles").select("id,display_name").in("id", ids);
        const map: Record<string,string> = {};
        (people || []).forEach((person) => { map[person.id] = person.display_name; });
        setActors(map);
      }
    }
    setLoading(false); setRefreshing(false);
  }, [user?.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!user?.id) return;
    const channel=supabase.channel("mobile-notices-"+user.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"notifications",filter:"recipient_id=eq."+user.id},(event)=>{
      setItems(old=>[event.new as NotificationRow,...old.filter(row=>row.id!==(event.new as NotificationRow).id)].slice(0,80));
    }).subscribe();
    return ()=>{void supabase.removeChannel(channel);};
  },[user?.id]);

  const open = async (item: NotificationRow) => {
    if (!user) return;
    if (!item.read_at) {
      const now = new Date().toISOString();
      const { error } = await supabase.from("notifications").update({read_at:now}).eq("id",item.id).eq("recipient_id",user.id);
      if (!error) setItems(old=>old.map(row=>row.id===item.id?{...row,read_at:now}:row));
    }
    if (!item.entity_id) return;
    if (item.entity_type === "video") router.push({pathname:"/watch/[id]",params:{id:item.entity_id}});
    else if (item.entity_type === "post") router.push({pathname:"/community/[id]",params:{id:item.entity_id}});
    else if (item.entity_type === "stream") router.push({pathname:"/live/[id]",params:{id:item.entity_id,role:"viewer"}});
    else if (item.entity_type === "profile") router.push({pathname:"/creator/[id]",params:{id:item.entity_id}});
  };
  const markAllRead = async () => {
    if(!user)return;
    const now=new Date().toISOString();
    const {error}=await supabase.from("notifications").update({read_at:now}).eq("recipient_id",user.id).is("read_at",null);
    if(error) Alert.alert("Could not mark all as read",error.message);
    else setItems(old=>old.map(row=>row.read_at?row:{...row,read_at:now}));
  };
  const unread = items.filter(item=>!item.read_at).length;

  return <AppScreen style={{paddingTop:0}}>
    <View style={styles.header}><Pressable onPress={()=>router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={theme.text}/></Pressable><Brand/><Pressable onPress={()=>void load(true)} style={styles.back}><Ionicons name="refresh" size={18} color={theme.text}/></Pressable></View>
    <FlatList data={items} keyExtractor={item=>item.id} contentContainerStyle={styles.list}
      refreshControl={<RefreshControl tintColor={theme.mint} colors={[theme.mint]} refreshing={refreshing} onRefresh={()=>void load(true)}/>}
      renderItem={({item})=><Pressable onPress={()=>void open(item)} style={[styles.notification,!item.read_at&&styles.notificationUnread]}>
        <View style={styles.icon}><Ionicons name={iconFor(item.kind)} size={20} color={item.kind==="reaction"?theme.coral:item.kind==="live"?theme.coral:theme.violet}/></View>
        <View style={styles.copy}><Text style={styles.body}>{item.body}</Text><Text style={styles.detail}>{item.actor_id?actors[item.actor_id]||"A creator":item.kind==="system"?"OmniTube":"Activity"} · {timeAgo(item.created_at)}</Text></View>
        {!item.read_at?<View style={styles.unreadDot}/>:null}
      </Pressable>}
      ListHeaderComponent={<View style={styles.listHeading}><Eyebrow>YOUR ACTIVITY</Eyebrow><View style={styles.headingRow}><View style={{flex:1}}><Text style={styles.title}>Notifications</Text><Text style={styles.subtitle}>{unread?unread+" unread update(s)":"You're all caught up."}</Text></View>{unread>0&&<Pressable onPress={()=>void markAllRead()}><Text style={styles.markAll}>MARK ALL READ</Text></Pressable>}</View></View>}
      ListEmptyComponent={!loading?<EmptyState icon="notifications-outline" title="All quiet for now." detail="Follows, reactions, comments and live activity will appear here."/>:<ActivityIndicator color={theme.mint} style={{marginTop:35}}/>}
    />
  </AppScreen>;
}
const styles=StyleSheet.create({
  header:{paddingHorizontal:15,paddingTop:13,paddingBottom:13,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  back:{width:35,height:35,borderRadius:11,borderWidth:1,borderColor:theme.line,alignItems:"center",justifyContent:"center"},
  list:{paddingHorizontal:15,paddingBottom:25},
  listHeading:{paddingTop:14,paddingBottom:22},
  headingRow:{flexDirection:"row",alignItems:"center",gap:12,marginTop:6},
  title:{fontSize:28,fontWeight:"900",letterSpacing:-.9,color:theme.text},
  subtitle:{fontSize:10,color:theme.muted,marginTop:5},
  markAll:{color:theme.mint,fontSize:8,letterSpacing:.8,fontWeight:"900"},
  notification:{flexDirection:"row",alignItems:"center",gap:11,padding:12,marginBottom:7,borderRadius:13,borderWidth:1,borderColor:"transparent"},
  notificationUnread:{backgroundColor:"#63EAC808",borderColor:"#63EAC81A"},
  icon:{width:39,height:39,borderRadius:12,backgroundColor:theme.panel2,borderWidth:1,borderColor:theme.line,alignItems:"center",justifyContent:"center"},
  copy:{flex:1},
  body:{fontSize:11,lineHeight:17,fontWeight:"700",color:theme.text},
  detail:{fontSize:9,color:theme.subtle,marginTop:5},
  unreadDot:{width:6,height:6,borderRadius:4,backgroundColor:theme.mint},
});