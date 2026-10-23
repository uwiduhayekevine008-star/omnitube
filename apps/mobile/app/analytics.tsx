import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";
import { router } from "expo-router";
import { AppScreen, Avatar, Brand, EmptyState, Eyebrow, SectionTitle, Surface, ui } from "../src/components/ui";
import { useAuth } from "../src/lib/AuthContext";
import { formatCount, timeAgo } from "../src/lib/media";
import { supabase } from "../src/lib/supabase";
import type { VideoRow } from "../src/lib/types";
import { theme } from "../src/theme";

type Period = 7 | 28;
type DailyPoint = { date: string; label: string; views: number; watchSeconds: number };
function MetricCard({ icon, label, value, detail, tint }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; detail: string; tint: string }) {
  return <Surface style={styles.metric}><View style={[styles.metricIcon,{backgroundColor:tint+"17"}]}><Ionicons name={icon} size={17} color={tint}/></View><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricDetail}>{detail}</Text></Surface>;
}
export default function AnalyticsScreen() {
  const { user, profile } = useAuth();
  const { width: viewportWidth } = useWindowDimensions();
  const [period,setPeriod]=useState<Period>(7);
  const [videos,setVideos]=useState<VideoRow[]>([]);
  const [events,setEvents]=useState<{video_id:string;created_at:string;watch_seconds:number}[]>([]);
  const [followers,setFollowers]=useState(0);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState("");
  const chartWidth=Math.max(260,viewportWidth-74);

  const load=useCallback(async(refresh=false)=>{
    if(!user?.id){setVideos([]);setEvents([]);setFollowers(0);setLoading(false);return;}
    if(refresh)setRefreshing(true);else setLoading(true);
    const cutoff=new Date(Date.now()-period*86400000);
    const [videoResult,followersResult]=await Promise.all([
      supabase.from("videos").select("id,creator_id,title,description,video_path,thumbnail_path,duration_seconds,visibility,kind,status,category,tags,allow_comments,views_count,published_at,created_at,updated_at").eq("creator_id",user.id).eq("status","published").order("views_count",{ascending:false}).limit(100),
      supabase.from("follows").select("follower_id",{count:"exact",head:true}).eq("creator_id",user.id),
    ]);
    if(videoResult.error){setError(videoResult.error.message);setLoading(false);setRefreshing(false);return;}
    const rows=(videoResult.data||[]) as unknown as VideoRow[];
    setVideos(rows);
    setFollowers(followersResult.count||0);
    if(rows.length){
      const result=await supabase.from("video_views").select("video_id,created_at,watch_seconds").in("video_id",rows.map(row=>row.id)).gte("created_at",cutoff.toISOString()).order("created_at",{ascending:true}).limit(5000);
      if(result.error)setError(result.error.message);
      else {setEvents((result.data||[]) as {video_id:string;created_at:string;watch_seconds:number}[]);setError("");}
    }else{setEvents([]);setError("");}
    setLoading(false);setRefreshing(false);
  },[user?.id,period]);

  useEffect(()=>{void load();},[load]);

  const daily=useMemo<DailyPoint[]>(()=>{
    const points:DailyPoint[]=[];
    const now=new Date();
    for(let i=period-1;i>=0;i--){
      const date=new Date(now);
      date.setDate(now.getDate()-i);
      const key=date.toISOString().slice(0,10);
      points.push({date:key,label:period===7?new Intl.DateTimeFormat(undefined,{weekday:"short"}).format(date):String(date.getDate()),views:0,watchSeconds:0});
    }
    const index=new Map(points.map((point)=>[point.date,point]));
    events.forEach((event)=>{const point=index.get(event.created_at.slice(0,10));if(point){point.views+=1;point.watchSeconds+=Number(event.watch_seconds||0);}});
    return points;
  },[events,period]);
  const totalViews=videos.reduce((sum,row)=>sum+Number(row.views_count||0),0);
  const recentViews=events.length;
  const watchSeconds=events.reduce((sum,event)=>sum+Number(event.watch_seconds||0),0);
  const shortCount=videos.filter(row=>row.kind==="short").length;
  const widthPerBar=chartWidth/daily.length;
  const maxViews=Math.max(1,...daily.map(point=>point.views));
  const topVideos=videos.slice(0,5);

  if(!user)return <AppScreen><View style={styles.center}><Brand/><EmptyState icon="bar-chart-outline" title="Your creator analytics." detail="Sign in to see your channel performance, audience activity and top content." action={<Pressable style={styles.openButton} onPress={()=>router.push("/(tabs)/profile")}><Text style={styles.openButtonText}>Sign in</Text></Pressable>}/></View></AppScreen>;

  return <AppScreen style={{paddingTop:0}}>
    <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl tintColor={theme.mint} colors={[theme.mint]} refreshing={refreshing} onRefresh={()=>void load(true)}/>}>
      <View style={styles.header}><Pressable onPress={()=>router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={theme.text}/></Pressable><Brand/><Pressable onPress={()=>router.push("/settings")} style={styles.back}><Ionicons name="settings-outline" size={18} color={theme.text}/></Pressable></View>
      <View style={styles.hero}><View style={styles.heroHead}><View style={styles.heroCopy}><Eyebrow>CREATOR STUDIO</Eyebrow><Text style={styles.heading}>Know your momentum.</Text><Text style={styles.subtitle}>Analytics for {profile?.display_name||"your channel"}. Real events from your content and audience.</Text></View><Avatar profile={profile} size={50}/></View><View style={styles.periodRow}>{([7,28] as Period[]).map(value=><Pressable key={value} style={[styles.periodChip,period===value&&styles.periodSelected]} onPress={()=>setPeriod(value)}><Text style={[styles.periodText,period===value&&styles.periodSelectedText]}>{value} days</Text></Pressable>)}</View></View>
      {loading?<View style={styles.loading}><ActivityIndicator size="large" color={theme.mint}/><Text style={styles.loadingText}>Calculating your channel activity…</Text></View>:error?<View style={styles.errorBox}><Ionicons name="alert-circle-outline" size={18} color={theme.coral}/><Text style={styles.errorText}>{error}</Text><Pressable onPress={()=>void load(true)}><Text style={styles.retry}>Retry</Text></Pressable></View>:<>
        <View style={styles.metricGrid}>
          <MetricCard icon="eye-outline" label="Lifetime views" value={formatCount(totalViews)} detail="Published channel videos" tint={theme.mint}/>
          <MetricCard icon="trending-up-outline" label={period+"-day views"} value={formatCount(recentViews)} detail="Signed-in viewing sessions" tint={theme.violet}/>
          <MetricCard icon="people-outline" label="Followers" value={formatCount(followers)} detail="People following your channel" tint={theme.blue}/>
          <MetricCard icon="flash-outline" label="Shorts" value={formatCount(shortCount)} detail="Published short-form videos" tint={theme.coral}/>
        </View>

        <SectionTitle title="Audience activity" detail={"Daily recorded viewing sessions · last "+period+" days"}/>
        <Surface style={styles.chartCard}>
          <View style={styles.chartLegend}><View style={styles.legendMark}/><Text style={styles.legendText}>Views / plays</Text><Text style={styles.chartTotal}>{formatCount(recentViews)}</Text></View>
          <Svg width="100%" height={140} viewBox={"0 0 "+chartWidth+" 140"}>
            {[0,1,2,3].map(i=><Line key={i} x1="0" x2={chartWidth} y1={15+i*30} y2={15+i*30} stroke={theme.line} strokeWidth="1"/>)}
            {daily.map((point,i)=>{const barHeight=point.views===0?2:Math.max(3,(point.views/maxViews)*88);const x=i*widthPerBar+widthPerBar*0.22;return <Rect key={point.date} x={x} y={105-barHeight} width={Math.max(3,widthPerBar*0.56)} height={barHeight} rx="3" fill={theme.mint} opacity={point.views===0?0.19:0.88}/>;})}
            {daily.map((point,i)=>((period===7)||i%4===0||i===daily.length-1)?<SvgText key={point.date+"-label"} x={i*widthPerBar+widthPerBar/2} y="129" fontSize="9" fill={theme.muted} textAnchor="middle">{point.label}</SvgText>:null)}
          </Svg>
          <View style={styles.chartNote}><Ionicons name="information-circle-outline" size={14} color={theme.subtle}/><Text style={styles.chartNoteText}>Counts reflect recorded account sessions. Anonymous views and watch-time analytics need the production media analytics pipeline.</Text></View>
        </Surface>

        <SectionTitle title="Top content" detail="Ranked by lifetime views." action={<Pressable onPress={()=>router.push("/library?mode=videos")}><Text style={styles.seeAll}>MANAGE</Text></Pressable>}/>
        {topVideos.length? <Surface style={styles.topContent}>{topVideos.map((video,index)=><View key={video.id}><Pressable style={styles.topRow} onPress={()=>router.push({pathname:"/watch/[id]",params:{id:video.id}})}><View style={styles.rank}><Text style={styles.rankText}>{String(index+1).padStart(2,"0")}</Text></View><View style={styles.topCopy}><Text style={styles.topTitle} numberOfLines={2}>{video.title}</Text><Text style={styles.topDetail}>{video.kind==="short"?"Short":"Video"} · {video.visibility} · {timeAgo(video.published_at||video.created_at)}</Text></View><View style={styles.topMetric}><Text style={styles.topViews}>{formatCount(video.views_count)}</Text><Text style={styles.topViewsLabel}>VIEWS</Text></View><Ionicons name="chevron-forward" size={15} color={theme.subtle}/></Pressable>{index<topVideos.length-1&&<View style={ui.separator}/>}</View>)}</Surface>
          :<EmptyState icon="bar-chart-outline" title="Your first insight is waiting." detail="Publish a video to start building your channel analytics." action={<ActionButton title="Publish content" icon="cloud-upload-outline" onPress={()=>router.push("/(tabs)/create")}/>}/>}

        <SectionTitle title="Creator health" detail="A quick view of your channel mix."/>
        <Surface style={styles.healthCard}>
          <View style={styles.healthHeader}><Ionicons name="layers-outline" size={18} color={theme.violet}/><Text style={styles.healthTitle}>Content portfolio</Text></View>
          <View style={styles.mixBar}><View style={[styles.mixShort,{width:(videos.length?shortCount/videos.length*100:0)+"%"}]}/><View style={[styles.mixLong,{width:(videos.length?(videos.length-shortCount)/videos.length*100:0)+"%"}]}/></View>
          <View style={styles.mixLegend}><View style={styles.mixItem}><View style={[styles.legendSquare,{backgroundColor:theme.violet}]}/><Text style={styles.mixText}>{shortCount} Shorts</Text></View><View style={styles.mixItem}><View style={[styles.legendSquare,{backgroundColor:theme.mint}]}/><Text style={styles.mixText}>{videos.length-shortCount} videos</Text></View><Text style={styles.chartTotal}>{videos.length} total</Text></View>
          <View style={ui.separator}/>
          <View style={styles.watchSummary}><View><Text style={styles.watchLabel}>Recorded watch seconds</Text><Text style={styles.watchValue}>{formatCount(watchSeconds)} sec</Text></View><View><Text style={styles.watchLabel}>Average per session</Text><Text style={styles.watchValue}>{recentViews?Math.round(watchSeconds/recentViews):0} sec</Text></View></View>
        </Surface>
      </>}
      <View style={styles.footer}><Text style={styles.footerText}>OMNITUBE CREATOR ANALYTICS · PRIVATE TO YOUR ACCOUNT</Text></View>
    </ScrollView>
  </AppScreen>;
}
const styles=StyleSheet.create({
  page:{paddingHorizontal:15,paddingBottom:32},
  header:{paddingTop:12,paddingBottom:18,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  back:{width:36,height:36,borderRadius:11,borderColor:theme.line,borderWidth:1,alignItems:"center",justifyContent:"center"},
  hero:{padding:17,borderRadius:18,borderWidth:1,borderColor:"#A99AFF2A",backgroundColor:"#151827"},
  heroHead:{flexDirection:"row",alignItems:"flex-start",gap:12},
  heroCopy:{flex:1},
  heading:{color:theme.text,fontSize:26,fontWeight:"900",letterSpacing:-1,marginTop:7},
  subtitle:{color:theme.muted,fontSize:10,lineHeight:16,marginTop:7},
  periodRow:{flexDirection:"row",gap:7,marginTop:17},
  periodChip:{paddingHorizontal:13,paddingVertical:8,borderRadius:9,borderWidth:1,borderColor:theme.line,backgroundColor:theme.panel},
  periodSelected:{backgroundColor:theme.mint,borderColor:theme.mint},
  periodText:{color:theme.muted,fontSize:10,fontWeight:"800"},
  periodSelectedText:{color:"#071712"},
  loading:{minHeight:230,alignItems:"center",justifyContent:"center",gap:12},
  loadingText:{color:theme.muted,fontSize:11},
  errorBox:{marginTop:18,flexDirection:"row",alignItems:"center",gap:9,padding:12,borderWidth:1,borderColor:"#FF8A9D39",borderRadius:12},
  errorText:{flex:1,color:"#FFB9C2",fontSize:10},retry:{color:theme.mint,fontSize:10,fontWeight:"900"},
  metricGrid:{flexDirection:"row",flexWrap:"wrap",gap:8,marginTop:13},
  metric:{flexGrow:1,flexBasis:"47%",minWidth:136,padding:13},
  metricIcon:{width:32,height:32,borderRadius:10,alignItems:"center",justifyContent:"center"},
  metricLabel:{color:theme.muted,fontSize:9,fontWeight:"700",marginTop:11},
  metricValue:{color:theme.text,fontSize:23,fontWeight:"900",letterSpacing:-0.7,marginTop:5},
  metricDetail:{color:theme.subtle,fontSize:8,lineHeight:13,marginTop:5},
  chartCard:{padding:13},
  chartLegend:{flexDirection:"row",alignItems:"center",gap:7},
  legendMark:{width:7,height:7,borderRadius:3,backgroundColor:theme.mint},
  legendText:{color:theme.muted,fontSize:10,flex:1},
  chartTotal:{color:theme.text,fontSize:12,fontWeight:"900"},
  chartNote:{flexDirection:"row",alignItems:"flex-start",gap:6,borderTopColor:theme.line,borderTopWidth:1,paddingTop:10},
  chartNoteText:{color:theme.subtle,fontSize:9,lineHeight:14,flex:1},
  seeAll:{fontSize:8,color:theme.mint,fontWeight:"900",letterSpacing:1},
  topContent:{paddingVertical:2,paddingHorizontal:12},
  topRow:{minHeight:68,flexDirection:"row",alignItems:"center",gap:9},
  rank:{width:29,height:29,borderRadius:9,backgroundColor:theme.panel2,alignItems:"center",justifyContent:"center"},
  rankText:{color:theme.violet,fontSize:10,fontWeight:"900"},
  topCopy:{flex:1},
  topTitle:{color:theme.text,fontSize:10,lineHeight:15,fontWeight:"800"},
  topDetail:{color:theme.subtle,fontSize:8,marginTop:4},
  topMetric:{alignItems:"flex-end"},
  topViews:{color:theme.text,fontSize:12,fontWeight:"900"},
  topViewsLabel:{color:theme.subtle,fontSize:7,fontWeight:"800",letterSpacing:0.8,marginTop:3},
  healthCard:{gap:12},
  healthHeader:{flexDirection:"row",alignItems:"center",gap:8},
  healthTitle:{color:theme.text,fontSize:12,fontWeight:"900"},
  mixBar:{height:8,borderRadius:5,backgroundColor:theme.panel3,overflow:"hidden",flexDirection:"row"},
  mixShort:{height:8,backgroundColor:theme.violet},
  mixLong:{height:8,backgroundColor:theme.mint},
  mixLegend:{flexDirection:"row",alignItems:"center",gap:12},
  mixItem:{flexDirection:"row",alignItems:"center",gap:6},
  legendSquare:{width:7,height:7,borderRadius:2},
  mixText:{color:theme.muted,fontSize:9},
  watchSummary:{flexDirection:"row",justifyContent:"space-between",gap:10},
  watchLabel:{color:theme.muted,fontSize:9},
  watchValue:{color:theme.text,fontSize:16,fontWeight:"900",marginTop:6},
  openButton:{marginTop:10,backgroundColor:theme.mint,paddingHorizontal:14,paddingVertical:10,borderRadius:10},
  openButtonText:{color:"#071712",fontWeight:"900",fontSize:11},
  center:{flex:1},
  footer:{alignItems:"center",paddingTop:26},
  footerText:{color:theme.subtle,fontSize:7,fontWeight:"800",letterSpacing:1},
});