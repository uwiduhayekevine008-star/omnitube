import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownUp, Bell, BookmarkPlus, Camera, Check, ChevronDown, CircleHelp, Clapperboard,
  Compass, Film, Flame, Heart, Home, Library, LogIn, LogOut, Menu, MessageCircle,
  Mic, MonitorPlay, MoreHorizontal, Play, Plus, Radio, Repeat2, Search, Send, Settings,
  ShieldAlert, Sparkles, ThumbsUp, TrendingUp, Upload, Users, Video as VideoIcon, Volume2, X
} from "lucide-react";
import { Room, RoomEvent, Track } from "livekit-client";
import * as tus from "tus-js-client";
import { isSupabaseConfigured, storagePublicUrl, supabase, supabaseUrl, formatCount, timeAgo } from "./lib/supabase";

type Section = "home" | "trending" | "shorts" | "live" | "subscriptions" | "posts" | "library" | "notifications" | "studio";
type Profile = { id: string; username: string | null; display_name: string; avatar_url: string | null; bio: string; is_verified: boolean };
type VideoRow = {
  id: string; creator_id: string; title: string; description: string; video_path: string;
  thumbnail_path: string | null; duration_seconds: number | null; visibility: string; kind: "video" | "short";
  status: string; category: string; views_count: number; published_at: string | null; created_at: string; allow_comments?: boolean;
  video_reactions?: { count: number }[]; comments?: { count: number }[]; creator?: Profile;
};
type PostRow = { id: string; creator_id: string; body: string; media_urls: string[]; visibility: string; created_at: string; creator?: Profile; likes?: number };
type StreamRow = { id: string; creator_id: string; title: string; description: string; status: string; visibility: string; room_name: string; starts_at: string; creator?: Profile };
type StreamMessage = { id: string; stream_id: string; user_id: string; body: string; created_at: string; author?: Profile | null };
type Notice = { id: string; title: string; detail?: string; kind?: "success" | "error" | "info" };

const WEB_FEED_PAGE_SIZE = 36;

const NAV: { id: Section; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Discover", icon: Home },
  { id: "trending", label: "Trending", icon: Flame },
  { id: "shorts", label: "Omni Shorts", icon: Clapperboard },
  { id: "live", label: "Live now", icon: Radio },
  { id: "subscriptions", label: "Following", icon: Users },
  { id: "posts", label: "Community", icon: MessageCircle },
  { id: "library", label: "Your library", icon: Library }
];

const titleFor: Record<Section, string> = {
  home: "Discover", trending: "Trending", shorts: "Omni Shorts", live: "Live now",
  subscriptions: "Following", posts: "Community", library: "Your library",
  notifications: "Notifications", studio: "Creator studio"
};

function initials(profile?: Profile | null) {
  return (profile?.display_name || "Creator").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
function avatarStyle(profile?: Profile | null) {
  return profile?.avatar_url ? { backgroundImage: "url(" + profile.avatar_url + ")" } : undefined;
}
function useSignedThumbnail(path: string | null | undefined) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    if (!path) { setUrl(""); return () => { active = false; }; }
    void supabase.storage.from("omnitube-thumbnails").createSignedUrl(path, 3600)
      .then(({ data, error }) => { if (active) setUrl(error ? "" : data.signedUrl); });
    return () => { active = false; };
  }, [path]);
  return url;
}
function ThumbnailPreview({ path }: { path: string | null }) {
  const url = useSignedThumbnail(path);
  return <div className="studio-video-thumb" style={url ? { backgroundImage: "url(" + url + ")" } : undefined}><VideoIcon size={18} /></div>;
}
function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
}

function Avatar({ profile, size = "md" }: { profile?: Profile | null; size?: "sm" | "md" | "lg" }) {
  return <span className={"avatar avatar-" + size} style={avatarStyle(profile)} aria-label={profile?.display_name || "Creator"}>
    {!profile?.avatar_url && initials(profile)}
  </span>;
}

function EmptyState({ icon: Icon, title, detail, action }: { icon: typeof VideoIcon; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={25} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

function AuthDialog({ onClose, notify }: { onClose: () => void; notify: (title: string, detail?: string, kind?: Notice["kind"]) => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  useEscape(onClose);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleaned = email.trim().toLowerCase();
    if (!cleaned || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
      notify("Enter a valid email address.", undefined, "error"); return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: cleaned,
      options: { emailRedirectTo: window.location.origin }
    });
    setBusy(false);
    if (error) notify("Sign-in could not start", error.message, "error");
    else { notify("Check your inbox", "A secure sign-in link is on its way.", "success"); onClose(); }
  };
  return <Modal onClose={onClose} className="auth-modal">
    <div className="auth-art"><div className="brand-mark large"><span>O</span></div><p className="eyebrow">YOUR CREATOR UNIVERSE</p><h2>Make room for<br /><span>what moves you.</span></h2><div className="orbit orbit-one" /><div className="orbit orbit-two" /></div>
    <div className="auth-content"><button className="icon-btn close-modal" onClick={onClose} aria-label="Close"><X /></button><p className="eyebrow">WELCOME TO OMNITUBE</p><h2>Your account.<br />Your whole world.</h2><p className="muted">Sign in with a magic link. No password to remember.</p>
      <form onSubmit={submit} className="stack-form"><label htmlFor="auth-email">Email address</label><input id="auth-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /><button className="btn btn-primary full" type="submit" disabled={busy}>{busy ? <><span className="spinner" /> Sending link…</> : <>Email me a sign-in link <Send size={16} /></>}</button></form>
      <p className="fine-print">By continuing, you agree to use OmniTube respectfully and follow the community guidelines.</p>
    </div>
  </Modal>;
}

function Modal({ children, onClose, className = "" }: { children: ReactNode; onClose: () => void; className?: string }) {
  useEscape(onClose);
  return <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={"modal-panel " + className} role="dialog" aria-modal="true">{children}</section>
  </div>;
}

function VideoCard({ video, onPlay, onLike, onSave, onRepost, user, following, onFollow, onReport }: {
  video: VideoRow; onPlay: () => void; onLike: () => void; onSave: () => void; onRepost: () => void;
  user: boolean; following: boolean; onFollow: () => void; onReport: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const thumbnail = useSignedThumbnail(video.thumbnail_path);
  return <article className={"video-card " + (video.kind === "short" ? "short-card" : "")}>
    <button className="thumbnail-button" onClick={onPlay} aria-label={"Play " + video.title}>
      <div className="video-thumbnail" style={thumbnail ? { backgroundImage: "url(" + thumbnail + ")" } : undefined}>
        {!thumbnail && <div className="thumbnail-orb"><VideoIcon size={28} /></div>}
        <span className="play-overlay"><Play size={24} fill="currentColor" /></span>
        {video.kind === "short" && <span className="format-badge"><Clapperboard size={12} /> SHORT</span>}
        <span className="duration">{video.duration_seconds ? Math.floor(video.duration_seconds / 60) + ":" + String(Math.floor(video.duration_seconds % 60)).padStart(2, "0") : (video.kind === "short" ? "SHORT" : "VIDEO")}</span>
      </div>
    </button>
    <div className="video-meta">
      <button className="avatar-button" onClick={onFollow} title={following ? "Following creator" : "Follow creator"}><Avatar profile={video.creator} /></button>
      <div className="video-copy">
        <button className="video-title" onClick={onPlay}>{video.title}</button>
        <button className="creator-line" onClick={onFollow}>{video.creator?.display_name || "Creator"} {video.creator?.is_verified && <span className="verified">✓</span>}</button>
        <p className="video-stats">{formatCount(video.views_count)} views <span>·</span> {timeAgo(video.published_at || video.created_at)}</p>
      </div>
      <div className="card-menu-wrap"><button className="icon-btn tiny" aria-label="More video actions" onClick={() => setMenu((v) => !v)}><MoreHorizontal size={20} /></button>
        {menu && <div className="action-menu">
          <button onClick={() => { onSave(); setMenu(false); }}><BookmarkPlus size={16} /> Save to Watch later</button>
          <button onClick={() => { onLike(); setMenu(false); }}><ThumbsUp size={16} /> Like video</button>
          <button onClick={() => { onRepost(); setMenu(false); }}><Repeat2 size={16} /> Repost</button>
          <button onClick={() => { navigator.clipboard?.writeText(window.location.origin + "/watch/" + video.id); setMenu(false); }}><Send size={16} /> Copy link</button>
          <button onClick={() => { onReport(); setMenu(false); }}><ShieldAlert size={16} /> Report video</button>
        </div>}
      </div>
    </div>
  </article>;
}

function VideoPlayer({ video, profile, onClose, notify, userId }: {
  video: VideoRow; profile: Profile | null; onClose: () => void;
  notify: (title: string, detail?: string, kind?: Notice["kind"]) => void; userId: string | null;
}) {
  const [src, setSrc] = useState("");
  const [loadError, setLoadError] = useState("");
  const [comments, setComments] = useState<any[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [watchSecond, setWatchSecond] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [likes, setLikes] = useState(Number(video.video_reactions?.[0]?.count || 0));
  const lastSaved = useRef(0);
  useEffect(() => {
    let active = true;
    void supabase.functions.invoke("resolve-playback", { body: { videoId: video.id } }).then(({ data, error }) => {
      if (!active) return;
      if (error || !data?.signedUrl) setLoadError(error?.message || data?.error || "Playback could not be authorized.");
      else setSrc(data.signedUrl as string);
    });
    void (async () => {
      const { data } = await supabase.from("comments").select("id,body,user_id,created_at").eq("video_id", video.id).order("created_at", { ascending: false }).limit(60);
      if (!active || !data) return;
      const ids = Array.from(new Set(data.map((item: any) => item.user_id)));
      const profileResult = ids.length ? await supabase.from("profiles").select("id,username,display_name,avatar_url,bio,is_verified").in("id", ids) : { data: [] };
      const map = new Map((profileResult.data || []).map((person: any) => [person.id, person]));
      if (active) setComments(data.map((item: any) => ({ ...item, creator: map.get(item.user_id) })));
    })();
    if (userId) {
      void supabase.from("video_reactions").select("reaction").eq("video_id", video.id).eq("user_id", userId).maybeSingle()
        .then(({ data }) => { if (active) setIsLiked(data?.reaction === "like" || data?.reaction === "heart"); });
    }
    return () => { active = false; };
  }, [video.id, userId]);
  const saveWatch = useCallback(async (seconds: number) => {
    if (!userId || seconds < 1 || seconds - lastSaved.current < 10) return;
    lastSaved.current = seconds;
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("video_views").upsert({
      video_id: video.id, viewer_id: userId, view_date: today, watch_seconds: seconds,
      source: video.kind === "short" ? "shorts" : "feed"
    }, { onConflict: "video_id,viewer_id,view_date" });
  }, [userId, video.id, video.kind]);
  const addComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!userId) { notify("Sign in to comment."); return; }
    const body = commentBody.trim();
    if (!body || commentBusy) return;
    setCommentBusy(true);
    const { data, error } = await supabase.from("comments").insert({ video_id: video.id, user_id: userId, body }).select("id,body,user_id,created_at").single();
    setCommentBusy(false);
    if (error) notify("Comment was not posted", error.message, "error");
    else { setComments((old) => [{ ...data, creator: profile }, ...old]); setCommentBody(""); }
  };
  const toggleLike = async () => {
    if (!userId) { notify("Sign in to like videos."); return; }
    if (isLiked) {
      const { error } = await supabase.from("video_reactions").delete().eq("video_id", video.id).eq("user_id", userId);
      if (error) notify("Could not remove reaction", error.message, "error");
      else { setIsLiked(false); setLikes((n) => Math.max(0, n - 1)); }
    } else {
      const { error } = await supabase.from("video_reactions").upsert({ video_id: video.id, user_id: userId, reaction: "like" });
      if (error) notify("Could not react", error.message, "error");
      else { setIsLiked(true); setLikes((n) => n + 1); }
    }
  };
  useEscape(onClose);
  return <Modal onClose={onClose} className="player-modal">
    <div className="player-top"><div className="mini-brand"><span className="brand-mark"><span>O</span></span><span>Now playing</span></div><button className="icon-btn" onClick={onClose} aria-label="Close player"><X /></button></div>
    <div className="player-layout">
      <div className="player-main">
        <div className="player-frame">
          {src ? <video src={src} controls autoPlay playsInline onTimeUpdate={(event) => { const sec = Math.floor(event.currentTarget.currentTime); setWatchSecond(sec); void saveWatch(sec); }} onEnded={() => void saveWatch(watchSecond)} /> :
            <div className="player-loading">{loadError ? <><ShieldAlert size={28} /><strong>Playback unavailable</strong><p>{loadError}</p></> : <><span className="spinner" /><p>Preparing secure playback…</p></>}</div>}
        </div>
        <h2 className="player-title">{video.title}</h2>
        <div className="player-info-row"><div className="creator-identity"><Avatar profile={video.creator} /><div><strong>{video.creator?.display_name || "Creator"}</strong><small>{formatCount(video.views_count)} views · {timeAgo(video.published_at || video.created_at)}</small></div></div>
          <button className={"btn " + (isLiked ? "btn-liked" : "btn-quiet")} onClick={() => void toggleLike()}><ThumbsUp size={16} /> {formatCount(likes)} <span className="btn-separator" /> Like</button>
        </div>
        {video.description && <div className="description-box">{video.description}</div>}
      </div>
      <aside className="comment-panel"><div className="comment-heading"><h3>Conversation</h3><span>{comments.length}</span></div>
        <form className="comment-form" onSubmit={addComment}><Avatar profile={profile} size="sm" /><input value={commentBody} onChange={(event) => setCommentBody(event.target.value)} maxLength={3000} placeholder={userId ? "Add a thoughtful comment…" : "Sign in to join in"} aria-label="Write a comment" /><button className="icon-btn" type="submit" disabled={commentBusy || !commentBody.trim()} aria-label="Send comment"><Send size={17} /></button></form>
        <div className="comment-list">{comments.map((comment) => <div className="comment" key={comment.id}><Avatar profile={comment.creator} size="sm" /><div><div className="comment-byline"><strong>{comment.creator?.display_name || "Creator"}</strong><span>{timeAgo(comment.created_at)}</span></div><p>{comment.body}</p></div></div>)}
          {comments.length === 0 && <div className="comments-empty"><MessageCircle size={20} /><p>No comments yet. Start a good conversation.</p></div>}
        </div>
      </aside>
    </div>
  </Modal>;
}

function UploadDialog({ userId, notify, onClose, onPublished }: {
  userId: string; notify: (title: string, detail?: string, kind?: Notice["kind"]) => void;
  onClose: () => void; onPublished: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"video" | "short">("video");
  const [visibility, setVisibility] = useState("public");
  const [category, setCategory] = useState("Other");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEscape(() => { if (!busy) onClose(); });
  const projectRef = useMemo(() => { try { return new URL(supabaseUrl).hostname.split(".")[0]; } catch { return ""; } }, []);
  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !title.trim()) { notify("Choose a video and give it a title.", undefined, "error"); return; }
    const allowed = ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"];
    if (!allowed.includes(file.type)) { notify("Use MP4, WebM, MOV, or MKV video.", "This file’s browser MIME type is not supported.", "error"); return; }
    if (file.size > 2 * 1024 * 1024 * 1024) { notify("Video exceeds the 2 GB upload limit.", undefined, "error"); return; }
    if (kind === "short" && file.size === 0) { notify("This file is empty.", undefined, "error"); return; }
    setBusy(true); setProgress(0); setPhase("Preparing upload");
    const id = crypto.randomUUID();
    const ext = (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "mp4";
    const path = userId + "/" + id + "." + ext;
    const objectUrl = URL.createObjectURL(file);
    const duration = await new Promise<number | null>((resolve) => {
      const el = document.createElement("video");
      el.preload = "metadata"; el.onloadedmetadata = () => { URL.revokeObjectURL(objectUrl); resolve(Number.isFinite(el.duration) ? el.duration : null); };
      el.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
      el.src = objectUrl;
    });
    const { error: insertError } = await supabase.from("videos").insert({
      id, creator_id: userId, title: title.trim(), description: description.trim(), video_path: path,
      visibility, kind, status: "draft", category, duration_seconds: duration
    });
    if (insertError) { setBusy(false); notify("Could not prepare video record", insertError.message, "error"); return; }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Your sign-in expired. Sign in again before uploading.");
      const endpoint = "https://" + projectRef + ".storage.supabase.co/storage/v1/upload/resumable";
      setPhase("Uploading original video");
      await new Promise<void>((resolve, reject) => {
        const task = new tus.Upload(file, {
          endpoint, retryDelays: [0, 3000, 5000, 10000, 20000],
          headers: { authorization: "Bearer " + session.access_token, "x-upsert": "false" },
          uploadDataDuringCreation: true, removeFingerprintOnSuccess: true, chunkSize: 6 * 1024 * 1024,
          metadata: { bucketName: "omnitube-videos", objectName: path, contentType: file.type, cacheControl: "3600" },
          onError: reject,
          onProgress: (sent, total) => setProgress(Math.round((sent / total) * 100)),
          onSuccess: () => resolve()
        });
        void task.findPreviousUploads().then((previous) => { if (previous.length) task.resumeFromPreviousUpload(previous[0]); task.start(); }).catch(reject);
      });
      if (image) {
        setPhase("Uploading thumbnail");
        if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(image.type) || image.size > 15 * 1024 * 1024) throw new Error("Thumbnail must be JPEG, PNG, WebP or AVIF and no larger than 15 MB.");
        const imagePath = userId + "/" + id + "-" + image.name.replace(/[^a-zA-Z0-9._-]/g, "").slice(-80);
        const { error: imageError } = await supabase.storage.from("omnitube-thumbnails").upload(imagePath, image, { upsert: false, contentType: image.type });
        if (imageError) throw imageError;
        const { error: updateError } = await supabase.from("videos").update({ thumbnail_path: imagePath }).eq("id", id).eq("creator_id", userId);
        if (updateError) throw updateError;
      }
      setPhase("Checking upload and publishing");
      const { data, error } = await supabase.functions.invoke("publish-video", { body: { videoId: id } });
      if (error || !data?.success) throw new Error(error?.message || data?.error || "The publishing service could not validate this upload.");
      setPhase("Published");
      notify("Your video is live", "It is now available in OmniTube discovery.", "success");
      onPublished(); onClose();
    } catch (error) {
      await supabase.from("videos").update({ status: "failed" }).eq("id", id).eq("creator_id", userId);
      notify("Upload did not finish", error instanceof Error ? error.message : "An unexpected upload error occurred.", "error");
    } finally { setBusy(false); setPhase(""); }
  };
  return <Modal onClose={() => { if (!busy) onClose(); }} className="upload-modal">
    <div className="modal-heading"><div><p className="eyebrow">CREATOR STUDIO</p><h2>Put something in motion.</h2><p className="muted">Upload directly to your private media bucket, then publish after server-side validation.</p></div><button className="icon-btn" onClick={onClose} disabled={busy}><X /></button></div>
    <form className="upload-form" onSubmit={upload}>
      <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska" hidden onChange={(event) => setFile(event.target.files?.[0] || null)} />
      <button type="button" className={"dropzone " + (file ? "dropzone-selected" : "")} onClick={() => fileRef.current?.click()} disabled={busy}>
        <span className="dropzone-icon"><Upload size={24} /></span><strong>{file ? file.name : "Choose a video file"}</strong><span>{file ? (file.size / (1024 * 1024)).toFixed(1) + " MB selected" : "MP4, WebM, MOV or MKV · up to 2 GB"}</span>
      </button>
      <div className="form-grid"><div className="form-field wide"><label htmlFor="video-title">Title</label><input id="video-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} minLength={1} required placeholder="Give your video a title" /></div>
      <div className="form-field wide"><label htmlFor="video-description">Description</label><textarea id="video-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={3} placeholder="What should people know before they watch?" /></div>
      <div className="form-field"><label htmlFor="video-kind">Format</label><select id="video-kind" value={kind} onChange={(event) => setKind(event.target.value as "video" | "short")}><option value="video">Long-form video</option><option value="short">Short-form video</option></select></div>
      <div className="form-field"><label htmlFor="video-category">Category</label><select id="video-category" value={category} onChange={(event) => setCategory(event.target.value)}>{["Other","Education","Gaming","Music","Technology","Lifestyle","Science","Sports","News","Comedy","Film"].map((item) => <option key={item}>{item}</option>)}</select></div>
      <div className="form-field"><label htmlFor="video-visibility">Audience</label><select id="video-visibility" value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="public">Public — discoverable</option><option value="unlisted">Unlisted — link access</option><option value="private">Private — only you</option></select></div>
      <div className="form-field"><label htmlFor="video-thumbnail">Custom thumbnail (optional)</label><input id="video-thumbnail" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => setImage(event.target.files?.[0] || null)} /></div>
      </div>
      {busy && <div className="upload-progress"><div className="progress-copy"><span>{phase || "Uploading"}</span><strong>{progress}%</strong></div><div className="progress-track"><span style={{ width: progress + "%" }} /></div><small>Keep this tab open until the secure publish check completes.</small></div>}
      <div className="modal-footer"><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || !file || !title.trim()}>{busy ? <><span className="spinner" /> {phase || "Publishing"}</> : <><Upload size={16} /> Upload & publish</>}</button></div>
    </form>
  </Modal>;
}

function EditVideoDialog({ video, userId, onClose, onUpdated, notify }: {
  video: VideoRow; userId: string; onClose: () => void; onUpdated: () => void;
  notify: (title: string, detail?: string, kind?: Notice["kind"]) => void;
}) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description || "");
  const [visibility, setVisibility] = useState(video.visibility);
  const [kind, setKind] = useState<"video" | "short">(video.kind);
  const [category, setCategory] = useState(video.category || "Other");
  const [allowComments, setAllowComments] = useState(video.allow_comments !== false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const { error } = await supabase.from("videos").update({
      title: title.trim(), description: description.trim(), visibility, kind, category,
      allow_comments: allowComments, updated_at: new Date().toISOString()
    }).eq("id", video.id).eq("creator_id", userId).select("id").single();
    setBusy(false);
    if (error) notify("Video changes were not saved", error.message, "error");
    else { notify("Video details updated.", undefined, "success"); onUpdated(); onClose(); }
  };
  return <Modal onClose={() => { if (!busy) onClose(); }} className="upload-modal">
    <div className="modal-heading"><div><p className="eyebrow">CREATOR STUDIO / LIBRARY</p><h2>Edit video details.</h2><p className="muted">Update your title, description, visibility and viewer options without re-uploading the media.</p></div><button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close editor"><X /></button></div>
    <form className="upload-form" onSubmit={(event) => void submit(event)}>
      <div className="form-grid">
        <div className="form-field wide"><label htmlFor="edit-video-title">Title</label><input id="edit-video-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} required /></div>
        <div className="form-field wide"><label htmlFor="edit-video-description">Description</label><textarea id="edit-video-description" rows={4} maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
        <div className="form-field"><label htmlFor="edit-video-visibility">Audience</label><select id="edit-video-visibility" value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="public">Public — discoverable</option><option value="unlisted">Unlisted — link access</option><option value="private">Private — only you</option></select></div>
        <div className="form-field"><label htmlFor="edit-video-kind">Format</label><select id="edit-video-kind" value={kind} onChange={(event) => setKind(event.target.value as "video" | "short")}><option value="video">Long-form video</option><option value="short">Short-form video</option></select></div>
        <div className="form-field"><label htmlFor="edit-video-category">Category</label><select id="edit-video-category" value={category} onChange={(event) => setCategory(event.target.value)}>{["Other","Education","Gaming","Music","Technology","Lifestyle","Science","Sports","News","Comedy","Film"].map((item) => <option key={item}>{item}</option>)}</select></div>
        <div className="form-field"><label htmlFor="edit-comments">Viewer interaction</label><select id="edit-comments" value={allowComments ? "on" : "off"} onChange={(event) => setAllowComments(event.target.value === "on")}><option value="on">Comments enabled</option><option value="off">Comments disabled</option></select></div>
      </div>
      <div className="modal-footer"><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>{busy ? "Saving…" : <><Check size={16} /> Save changes</>}</button></div>
    </form>
  </Modal>;
}

function LiveRoomPane({ stream, token, serverUrl, broadcaster, userId, profile, onClose, notify }: {
  stream: StreamRow; token: string; serverUrl: string; broadcaster: boolean; userId: string; profile: Profile | null;
  onClose: () => void; notify: (title: string, detail?: string, kind?: Notice["kind"]) => void;
}) {
  const roomRef = useRef<Room | null>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(broadcaster);
  const [cameraOn, setCameraOn] = useState(broadcaster);
  const [busy, setBusy] = useState(true);
  const [chatMessages, setChatMessages] = useState<StreamMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  useEffect(() => {
    let chatActive = true;
    const loadChat = async () => {
      const { data, error } = await supabase.from("stream_messages")
        .select("id,stream_id,user_id,body,created_at")
        .eq("stream_id", stream.id).order("created_at", { ascending: false }).limit(100);
      if (!chatActive || error || !data) return;
      const rows = [...data].reverse() as StreamMessage[];
      const ids = Array.from(new Set(rows.map((row) => row.user_id)));
      const people = ids.length
        ? await supabase.from("profiles").select("id,username,display_name,avatar_url,bio,is_verified").in("id", ids)
        : { data: [] as Profile[] };
      const profiles = new Map((people.data || []).map((person) => [person.id, person]));
      if (chatActive) setChatMessages(rows.map((row) => ({ ...row, author: profiles.get(row.user_id) || null })));
    };
    void loadChat();
    const chatChannel = supabase.channel("omnitube-live-chat-" + stream.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "stream_messages", filter: "stream_id=eq." + stream.id }, async (event) => {
        const row = event.new as StreamMessage;
        const { data: author } = await supabase.from("profiles")
          .select("id,username,display_name,avatar_url,bio,is_verified").eq("id", row.user_id).maybeSingle();
        if (chatActive) setChatMessages((old) => old.some((item) => item.id === row.id)
          ? old : [...old, { ...row, author: author as Profile | null }].slice(-100));
      }).subscribe();
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const mount = (track: Track) => {
      const element = track.attach();
      element.classList.add(element instanceof HTMLVideoElement ? "room-video" : "room-audio");
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      mediaRef.current?.appendChild(element);
    };
    const unmount = (track: Track) => track.detach().forEach((element) => element.remove());
    room.on(RoomEvent.TrackSubscribed, mount);
    room.on(RoomEvent.TrackUnsubscribed, unmount);
    void room.connect(serverUrl, token).then(async () => {
      if (broadcaster) {
        await room.localParticipant.enableCameraAndMicrophone();
        room.localParticipant.trackPublications.forEach((publication) => { if (publication.track) mount(publication.track); });
      }
      setConnected(true);
    }).catch((error: unknown) => notify("Could not connect to live media", error instanceof Error ? error.message : String(error), "error"))
      .finally(() => setBusy(false));
    return () => {
      chatActive = false;
      void supabase.removeChannel(chatChannel);
      room.removeAllListeners();
      void room.disconnect();
    };
  }, [serverUrl, token, broadcaster, notify, stream.id]);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages.length]);
  const sendChatMessage = async (event: FormEvent) => {
    event.preventDefault();
    const body = chatInput.trim();
    if (!body || chatSending || !userId) return;
    setChatSending(true);
    const { data, error } = await supabase.from("stream_messages")
      .insert({ stream_id: stream.id, user_id: userId, body })
      .select("id,stream_id,user_id,body,created_at").single();
    setChatSending(false);
    if (error) notify("Message not sent", error.message, "error");
    else if (data) {
      setChatMessages((old) => old.some((item) => item.id === data.id)
        ? old : [...old, { ...data, author: profile }].slice(-100));
      setChatInput("");
    }
  };
  const leave = async () => {
    await roomRef.current?.disconnect();
    onClose();
  };
  return <Modal onClose={() => void leave()} className="live-room-modal">
    <div className="live-room-top"><div className="live-status"><span className={connected ? "live-dot" : "live-dot muted-dot"} />{connected ? "CONNECTED TO LIVE" : "CONNECTING"}<span className="live-viewer-title">{stream.title}</span></div><button className="icon-btn" onClick={() => void leave()} aria-label="Leave stream"><X /></button></div>
    <div className="live-stage">
      <div className="live-video-stage" ref={mediaRef}>{busy && <div className="room-placeholder"><span className="spinner" /><p>Connecting securely to LiveKit…</p></div>}{!busy && !connected && <div className="room-placeholder"><Radio size={30} /><p>Could not connect. Check the live provider and stream configuration.</p></div>}</div>
      <aside className="live-side-panel">
        <div className="live-chat-heading"><Radio size={17} /><strong>Live chat</strong><span>{chatMessages.length}</span></div>
        <div className="live-chat-messages" aria-live="polite">
          {chatMessages.map((message) => <article className="live-chat-message" key={message.id}>
            <Avatar profile={message.author || (message.user_id === userId ? profile : null)} size="sm" />
            <div><div className="live-chat-byline"><strong>{message.author?.display_name || (message.user_id === userId ? profile?.display_name : null) || "Creator"}</strong><small>{timeAgo(message.created_at)}</small></div><p>{message.body}</p></div>
          </article>)}
          {chatMessages.length === 0 && <div className="live-chat-empty"><MessageCircle size={19} /><p>The room is open. Start the conversation.</p></div>}
          <div ref={chatEndRef} />
        </div>
        <form className="live-chat-compose" onSubmit={(event) => void sendChatMessage(event)}>
          <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} maxLength={1000} placeholder={stream.status === "live" ? "Message the live room…" : "Chat is unavailable"} aria-label="Live chat message" />
          <button className="icon-btn" type="submit" disabled={chatSending || !chatInput.trim() || stream.status !== "live"} aria-label="Send live chat message"><Send size={15} /></button>
        </form>
        <div className="live-room-tools">{broadcaster && <><button className={"btn " + (micOn ? "btn-quiet" : "btn-danger")} onClick={async () => { const next = !micOn; await roomRef.current?.localParticipant.setMicrophoneEnabled(next); setMicOn(next); }}><Mic size={16} /> {micOn ? "Mute mic" : "Unmute mic"}</button><button className={"btn " + (cameraOn ? "btn-quiet" : "btn-danger")} onClick={async () => { const next = !cameraOn; await roomRef.current?.localParticipant.setCameraEnabled(next); setCameraOn(next); }}><Camera size={16} /> {cameraOn ? "Camera off" : "Camera on"}</button></>}
        <button className="btn btn-danger full" onClick={() => void leave()}>{broadcaster ? "End broadcast" : "Leave stream"}</button></div></aside>
    </div>
  </Modal>;
}

function ReportDialog({ targetType, targetId, userId, onClose, notify }: {
  targetType: "video" | "post"; targetId: string; userId: string; onClose: () => void;
  notify: (title: string, detail?: string, kind?: Notice["kind"]) => void;
}) {
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.from("reports").insert({
      reporter_id: userId, target_type: targetType, target_id: targetId,
      reason, details: details.trim()
    });
    setBusy(false);
    if (error) notify("Report could not be submitted", error.message, "error");
    else { notify("Report received", "Thank you. Your report has been recorded for review.", "success"); onClose(); }
  };
  return <Modal onClose={onClose} className="report-modal">
    <div className="modal-heading"><div><p className="eyebrow">COMMUNITY SAFETY</p><h2>Report this {targetType === "video" ? "video" : "post"}.</h2><p className="muted">Tell us what looks wrong. Reports are private and tied to your account.</p></div><button className="icon-btn" onClick={onClose} aria-label="Close report form"><X /></button></div>
    <form className="stack-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="report-reason">Reason for report</label>
      <select id="report-reason" value={reason} onChange={(event) => setReason(event.target.value)} required>
        <option value="spam">Spam or scams</option><option value="harassment">Harassment or bullying</option><option value="hate">Hateful or abusive content</option><option value="violence">Violence or dangerous acts</option><option value="sexual_content">Sexual content</option><option value="copyright">Copyright concern</option><option value="misinformation">Misleading or harmful misinformation</option><option value="other">Something else</option>
      </select>
      <label htmlFor="report-details">Details (optional)</label>
      <textarea id="report-details" rows={4} maxLength={2000} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Add context that would help a reviewer understand the concern." />
      <div className="modal-footer"><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="btn btn-danger" disabled={busy}><ShieldAlert size={15} /> {busy ? "Submitting…" : "Submit report"}</button></div>
    </form>
  </Modal>;
}

function PostComposer({ userId, onCreated, notify }: { userId: string; onCreated: () => void; notify: (title: string, detail?: string, kind?: Notice["kind"]) => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!body.trim() || busy) return;
    setBusy(true);
    const { error } = await supabase.from("posts").insert({ creator_id: userId, body: body.trim(), visibility: "public" });
    setBusy(false);
    if (error) notify("Post not published", error.message, "error");
    else { setBody(""); onCreated(); notify("Post shared with your community.", undefined, "success"); }
  };
  return <form onSubmit={submit} className="post-composer"><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={5000} rows={3} placeholder="What’s on your mind? Share a thought, an update, or a behind-the-scenes moment." /><div className="composer-bottom"><span>{body.length}/5000 · Public post</span><button className="btn btn-primary" type="submit" disabled={busy || !body.trim()}>{busy ? "Publishing…" : <><Send size={15} /> Publish post</>}</button></div></form>;
}

function CommunityCard({ post, onLike, onReport, userId }: { post: PostRow; onLike: () => void; onReport: () => void; userId: string | null }) {
  return <article className="community-card"><div className="post-head"><Avatar profile={post.creator} /><div><strong>{post.creator?.display_name || "Creator"}</strong><small>{timeAgo(post.created_at)} · Community post</small></div><button className="icon-btn tiny" aria-label="Post actions"><MoreHorizontal size={20} /></button></div><p className="post-body">{post.body}</p>{post.media_urls?.length > 0 && <div className="post-media">{post.media_urls.map((url) => <img key={url} src={url} alt="Post attachment" loading="lazy" />)}</div>}<div className="post-actions"><button onClick={onLike} disabled={!userId} className="post-action"><Heart size={17} /> Like <span>{formatCount(post.likes || 0)}</span></button><span className="post-action passive"><MessageCircle size={17} /> Conversation</span><button className="post-action" onClick={onReport}><ShieldAlert size={15} /> Report</button><button className="post-action" onClick={() => navigator.clipboard?.writeText(window.location.origin + "/community/" + post.id)}><Send size={16} /> Share</button></div></article>;
}

function App() {
  const [section, setSection] = useState<Section>("home");
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreVideos, setHasMoreVideos] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [liveSetup, setLiveSetup] = useState(false);
  const [liveTitle, setLiveTitle] = useState("");
  const [liveDescription, setLiveDescription] = useState("");
  const [selectedVideo, setSelectedVideo] = useState<VideoRow | null>(null);
  const [routeVideoId, setRouteVideoId] = useState<string | null>(() => window.location.pathname.match(/^\/watch\/([0-9a-f-]{36})$/i)?.[1] || null);
  const [routePostId] = useState<string | null>(() => window.location.pathname.match(/^\/community\/([0-9a-f-]{36})$/i)?.[1] || new URLSearchParams(window.location.search).get("post"));
  const [reportTarget, setReportTarget] = useState<{ type: "video" | "post"; id: string } | null>(null);
  const [room, setRoom] = useState<{ stream: StreamRow; token: string; broadcaster: boolean } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [libraryVideos, setLibraryVideos] = useState<VideoRow[]>([]);
  const [myVideos, setMyVideos] = useState<VideoRow[]>([]);
  const [studioLoading, setStudioLoading] = useState(false);
  const [editingVideo, setEditingVideo] = useState<VideoRow | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const livekitUrl = (import.meta.env.VITE_LIVEKIT_URL as string | undefined) || "";
  const videosRequestId = useRef(0);
  const loadingMoreRef = useRef(false);

  const notify = useCallback((title: string, detail?: string, kind: Notice["kind"] = "info") => {
    setNotice({ id: crypto.randomUUID(), title, detail, kind });
    window.setTimeout(() => setNotice((current) => current?.title === title ? null : current), 5200);
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => { if (mounted) setUser(data.session?.user || null); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setUser(session?.user || null);
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const syncWatchLocation = () => {
      const nextId = window.location.pathname.match(/^\\/watch\\/([0-9a-f-]{36})$/i)?.[1] || null;
      setRouteVideoId(nextId);
      setSelectedVideo((current) => current?.id === nextId ? current : null);
    };
    window.addEventListener("popstate", syncWatchLocation);
    return () => window.removeEventListener("popstate", syncWatchLocation);
  }, []);

  useEffect(() => {
    let active = true;
    if (!user) { setProfile(null); setFollowingIds([]); return () => { active = false; }; }
    void supabase.from("profiles").select("id,username,display_name,avatar_url,bio,is_verified").eq("id", user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) notify("Could not load your creator profile", error.message, "error");
        else setProfile(data as Profile | null);
      });
    void supabase.from("follows").select("creator_id").eq("follower_id", user.id)
      .then(({ data }) => { if (active) setFollowingIds((data || []).map((row: any) => row.creator_id)); });
    return () => { active = false; };
  }, [user?.id, user, notify]);

  useEffect(() => {
    if (!user?.id) { setNotifications([]); return; }
    let active = true;
    void (async () => {
      const { data, error } = await supabase.from("notifications")
        .select("id,kind,body,entity_type,entity_id,read_at,created_at,recipient_id")
        .eq("recipient_id", user.id).order("created_at", { ascending: false }).limit(80);
      if (!active) return;
      if (error) { notify("Could not load notifications", error.message, "error"); return; }
      setNotifications((previous) => {
        const byId = new Map();
        for (const item of [...(data || []), ...previous]) byId.set(item.id, item);
        return Array.from(byId.values())
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 80);
      });
    })();
    const channel = supabase.channel("omnitube-notifications-" + user.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "recipient_id=eq." + user.id }, (event) => {
        const incoming = event.new as any;
        setNotifications((previous) => [incoming, ...previous.filter((item) => item.id !== incoming.id)].slice(0, 80));
        notify("New activity", incoming.body || "You have a new notification.", "info");
      }).subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [user?.id, notify]);

  useEffect(() => {
    if (!isSupabaseConfigured || !routeVideoId) return;
    let active = true;
    void (async () => {
      const { data, error } = await supabase.from("videos")
        .select("id,creator_id,title,description,video_path,thumbnail_path,duration_seconds,visibility,kind,status,category,views_count,published_at,created_at,allow_comments,video_reactions(count),comments(count)")
        .eq("id", routeVideoId).maybeSingle();
      if (!active) return;
      if (error || !data) {
        notify("Video link unavailable", "This video may be private, removed, or not published.", "error");
        return;
      }
      const { data: author } = await supabase.from("profiles")
        .select("id,username,display_name,avatar_url,bio,is_verified")
        .eq("id", data.creator_id).maybeSingle();
      if (active) setSelectedVideo({ ...(data as unknown as VideoRow), creator: author as Profile | null || undefined });
    })();
    return () => { active = false; };
  }, [routeVideoId, user?.id, notify]);

  useEffect(() => {
    if (routePostId) setSection("posts");
  }, [routePostId]);

  const loadVideos = useCallback(async () => {
    const requestId = ++videosRequestId.current;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setHasMoreVideos(false);
    if (!isSupabaseConfigured) { setVideos([]); setLoading(false); return; }
    setLoading(true);
    let request = supabase.from("videos").select("id,creator_id,title,description,video_path,thumbnail_path,duration_seconds,visibility,kind,status,category,views_count,published_at,created_at,video_reactions(count),comments(count)")
      .eq("status", "published").eq("visibility", "public");
    if (section === "shorts") request = request.eq("kind", "short") as typeof request;
    if (section === "subscriptions") {
      if (!user?.id || followingIds.length === 0) {
        if (requestId === videosRequestId.current) { setVideos([]); setLoading(false); }
        return;
      }
      request = request.in("creator_id", followingIds) as typeof request;
    }
    if (appliedQuery.trim()) {
      const safe = appliedQuery.trim().replace(/[,%()]/g, " ").replace(/\\s+/g, " ").slice(0, 100);
      if (safe) request = request.or("title.ilike.%" + safe + "%,description.ilike.%" + safe + "%") as typeof request;
    }
    if (section === "trending") request = request.order("views_count", { ascending: false }).order("published_at", { ascending: false }) as typeof request;
    else request = request.order("published_at", { ascending: false }) as typeof request;
    const { data, error } = await request.range(0, WEB_FEED_PAGE_SIZE);
    if (requestId !== videosRequestId.current) return;
    if (error) {
      setVideos([]);
      notify("Could not load videos", error.message, "error");
      setLoading(false);
      return;
    }
    const fetchedRows = (data || []) as unknown as VideoRow[];
    const hasMore = fetchedRows.length > WEB_FEED_PAGE_SIZE;
    const rows = fetchedRows.slice(0, WEB_FEED_PAGE_SIZE);
    const ids = Array.from(new Set(rows.map((row) => row.creator_id)));
    const prof = ids.length ? await supabase.from("profiles").select("id,username,display_name,avatar_url,bio,is_verified").in("id", ids) : { data: [] as any[] };
    if (requestId !== videosRequestId.current) return;
    const profileMap = new Map((prof.data || []).map((person: any) => [person.id, person]));
    setVideos(rows.map((row) => ({ ...row, creator: profileMap.get(row.creator_id) })));
    setHasMoreVideos(hasMore);
    setLoading(false);
  }, [section, appliedQuery, user?.id, followingIds, notify]);

  const loadMoreVideos = useCallback(async () => {
    if (loadingMoreRef.current || loading || !hasMoreVideos || section === "library" ||
        !["home", "trending", "shorts", "subscriptions"].includes(section)) return;
    const requestId = videosRequestId.current;
    const offset = videos.length;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    let request = supabase.from("videos").select("id,creator_id,title,description,video_path,thumbnail_path,duration_seconds,visibility,kind,status,category,views_count,published_at,created_at,video_reactions(count),comments(count)")
      .eq("status", "published").eq("visibility", "public");
    if (section === "shorts") request = request.eq("kind", "short") as typeof request;
    if (section === "subscriptions") request = request.in("creator_id", followingIds) as typeof request;
    if (appliedQuery.trim()) {
      const safe = appliedQuery.trim().replace(/[,%()]/g, " ").replace(/\\s+/g, " ").slice(0, 100);
      if (safe) request = request.or("title.ilike.%" + safe + "%,description.ilike.%" + safe + "%") as typeof request;
    }
    if (section === "trending") request = request.order("views_count", { ascending: false }).order("published_at", { ascending: false }) as typeof request;
    else request = request.order("published_at", { ascending: false }) as typeof request;
    const { data, error } = await request.range(offset, offset + WEB_FEED_PAGE_SIZE);
    if (requestId !== videosRequestId.current) return;
    if (error) {
      notify("Could not load more videos", error.message, "error");
      loadingMoreRef.current = false;
      setLoadingMore(false);
      return;
    }
    const fetchedRows = (data || []) as unknown as VideoRow[];
    const hasMore = fetchedRows.length > WEB_FEED_PAGE_SIZE;
    const rows = fetchedRows.slice(0, WEB_FEED_PAGE_SIZE);
    const ids = Array.from(new Set(rows.map((row) => row.creator_id)));
    const prof = ids.length ? await supabase.from("profiles").select("id,username,display_name,avatar_url,bio,is_verified").in("id", ids) : { data: [] as any[] };
    if (requestId !== videosRequestId.current) return;
    const profileMap = new Map((prof.data || []).map((person: any) => [person.id, person]));
    setVideos((current) => {
      const existingIds = new Set(current.map((row) => row.id));
      return [...current, ...rows.filter((row) => !existingIds.has(row.id)).map((row) => ({ ...row, creator: profileMap.get(row.creator_id) }))];
    });
    setHasMoreVideos(hasMore);
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [section, appliedQuery, followingIds, videos.length, hasMoreVideos, loading, notify]);

  useEffect(() => { void loadVideos(); }, [loadVideos]);

  const loadStudioVideos = useCallback(async () => {
    if (section !== "studio" || !user?.id) {
      if (!user?.id) setMyVideos([]);
      return;
    }
    setStudioLoading(true);
    const { data, error } = await supabase.from("videos")
      .select("id,creator_id,title,description,video_path,thumbnail_path,duration_seconds,visibility,kind,status,category,views_count,published_at,created_at,allow_comments")
      .eq("creator_id", user.id).order("created_at", { ascending: false }).limit(100);
    if (error) {
      notify("Could not load your uploads", error.message, "error");
      setMyVideos([]);
    } else {
      setMyVideos(((data || []) as unknown as VideoRow[]).map((video) => ({ ...video, creator: profile || undefined })));
    }
    setStudioLoading(false);
  }, [section, user?.id, profile, notify]);

  const loadPosts = useCallback(async () => {
    if (section !== "posts") return;
    const { data, error } = await supabase.from("posts").select("id,creator_id,body,media_urls,visibility,created_at").eq("visibility", "public").order("created_at", { ascending: false }).limit(40);
    if (error) { notify("Could not load community posts", error.message, "error"); return; }
    let rows = (data || []) as unknown as PostRow[];
    if (routePostId && !rows.some((row) => row.id === routePostId)) {
      const target = await supabase.from("posts").select("id,creator_id,body,media_urls,visibility,created_at").eq("id", routePostId).eq("visibility", "public").maybeSingle();
      if (target.data) rows = [target.data as unknown as PostRow, ...rows];
    }
    const ids = Array.from(new Set(rows.map((row) => row.creator_id)));
    const [prof, reactions] = await Promise.all([
      ids.length ? supabase.from("profiles").select("id,username,display_name,avatar_url,bio,is_verified").in("id", ids) : Promise.resolve({ data: [] as any[] }),
      supabase.from("post_reactions").select("post_id")
    ]);
    const profileMap = new Map((prof.data || []).map((person: any) => [person.id, person]));
    const counts = new Map<string, number>();
    (reactions.data || []).forEach((reaction: any) => counts.set(reaction.post_id, (counts.get(reaction.post_id) || 0) + 1));
    setPosts(rows.map((row) => ({ ...row, creator: profileMap.get(row.creator_id), likes: counts.get(row.id) || 0 })));
  }, [section, notify, routePostId]);

  const loadStreams = useCallback(async () => {
    if (section !== "live") return;
    const { data, error } = await supabase.from("live_streams").select("id,creator_id,title,description,status,visibility,room_name,starts_at").in("status", ["live", "scheduled"]).eq("visibility", "public").order("starts_at", { ascending: true }).limit(40);
    if (error) { notify("Could not load live rooms", error.message, "error"); return; }
    const rows = (data || []) as unknown as StreamRow[];
    const ids = Array.from(new Set(rows.map((row) => row.creator_id)));
    const prof = ids.length ? await supabase.from("profiles").select("id,username,display_name,avatar_url,bio,is_verified").in("id", ids) : { data: [] as any[] };
    const profileMap = new Map((prof.data || []).map((person: any) => [person.id, person]));
    setStreams(rows.map((row) => ({ ...row, creator: profileMap.get(row.creator_id) })));
  }, [section, notify]);

  const loadLibrary = useCallback(async () => {
    if (section !== "library" || !user?.id) { if (!user) setLibraryVideos([]); return; }
    const { data: saved } = await supabase.from("playlists").select("id").eq("owner_id", user.id).eq("title", "Watch later").maybeSingle();
    if (!saved) { setLibraryVideos([]); return; }
    const { data } = await supabase.from("playlist_items").select("video_id").eq("playlist_id", saved.id).order("position", { ascending: true });
    const ids = (data || []).map((row: any) => row.video_id);
    if (!ids.length) { setLibraryVideos([]); return; }
    const { data: videosData } = await supabase.from("videos").select("id,creator_id,title,description,video_path,thumbnail_path,duration_seconds,visibility,kind,status,category,views_count,published_at,created_at,video_reactions(count),comments(count)").in("id", ids);
    const rows = (videosData || []) as unknown as VideoRow[];
    const userIds = Array.from(new Set(rows.map((row) => row.creator_id)));
    const prof = userIds.length ? await supabase.from("profiles").select("id,username,display_name,avatar_url,bio,is_verified").in("id", userIds) : { data: [] as any[] };
    const profileMap = new Map((prof.data || []).map((person: any) => [person.id, person]));
    setLibraryVideos(ids.map((id: string) => rows.find((row) => row.id === id)).filter(Boolean).map((row: any) => ({ ...row, creator: profileMap.get(row.creator_id) })));
  }, [section, user?.id]);

  const loadNotifications = useCallback(async () => {
    if (section !== "notifications" || !user?.id) return;
    const { data, error } = await supabase.from("notifications").select("id,kind,body,entity_type,entity_id,read_at,created_at").eq("recipient_id", user.id).order("created_at", { ascending: false }).limit(80);
    if (error) notify("Could not load notifications", error.message, "error");
    else setNotifications(data || []);
  }, [section, user?.id, notify]);

  useEffect(() => { void loadPosts(); void loadStreams(); void loadLibrary(); void loadNotifications(); void loadStudioVideos(); }, [loadPosts, loadStreams, loadLibrary, loadNotifications, loadStudioVideos]);

  const openVideo = (video: VideoRow) => {
    const nextPath = "/watch/" + video.id;
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ ...(window.history.state || {}), omnitubeWatch: true }, "", nextPath);
    }
    setRouteVideoId(video.id);
    setSelectedVideo(video);
  };
  const closeVideo = () => {
    const state = window.history.state as { omnitubeWatch?: boolean } | null;
    if (routeVideoId && state?.omnitubeWatch && window.location.pathname === "/watch/" + routeVideoId) {
      window.history.back();
      return;
    }
    if (routeVideoId) {
      window.history.replaceState({}, "", "/");
      setRouteVideoId(null);
    }
    setSelectedVideo(null);
  };
  const requestReport = (type: "video" | "post", id: string) => {
    if (!user?.id) { setAuthOpen(true); return; }
    setReportTarget({ type, id });
  };
  const deleteVideo = async (video: VideoRow) => {
    if (!user?.id || !window.confirm("Permanently delete “" + video.title + "”? This also removes its comments, reactions and playlist references.")) return;
    const { error } = await supabase.from("videos").delete().eq("id", video.id).eq("creator_id", user.id);
    if (error) { notify("Video was not deleted", error.message, "error"); return; }
    const objects = await Promise.all([
      supabase.storage.from("omnitube-videos").remove([video.video_path]),
      video.thumbnail_path ? supabase.storage.from("omnitube-thumbnails").remove([video.thumbnail_path]) : Promise.resolve({ error: null })
    ]);
    setMyVideos((all) => all.filter((item) => item.id !== video.id));
    setVideos((all) => all.filter((item) => item.id !== video.id));
    setLibraryVideos((all) => all.filter((item) => item.id !== video.id));
    if (selectedVideo?.id === video.id) setSelectedVideo(null);
    if (objects.some((result) => result.error)) {
      notify("Video record deleted", "The record is gone, but one media object could not be removed. Review storage for orphaned files.", "error");
    } else notify("Video deleted.", undefined, "success");
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) notify("Could not sign out", error.message, "error");
    else { setSelectedVideo(null); setReportTarget(null); setEditingVideo(null); notify("You have signed out.", undefined, "success"); }
  };

  const toggleFollow = async (creatorId: string) => {
    if (!user?.id) { setAuthOpen(true); return; }
    if (creatorId === user.id) { setSection("studio"); return; }
    if (followingIds.includes(creatorId)) {
      const { error } = await supabase.from("follows").delete().eq("follower_id", user.id).eq("creator_id", creatorId);
      if (error) notify("Could not unfollow", error.message, "error");
      else { setFollowingIds((ids) => ids.filter((id) => id !== creatorId)); notify("Creator unfollowed."); }
    } else {
      const { error } = await supabase.from("follows").insert({ follower_id: user.id, creator_id: creatorId });
      if (error) notify("Could not follow creator", error.message, "error");
      else { setFollowingIds((ids) => [...ids, creatorId]); notify("You're following this creator.", undefined, "success"); }
    }
  };

  const likeVideo = async (video: VideoRow) => {
    if (!user?.id) { setAuthOpen(true); return; }
    const { data: existing } = await supabase.from("video_reactions").select("reaction").eq("video_id", video.id).eq("user_id", user.id).maybeSingle();
    const result = existing
      ? await supabase.from("video_reactions").delete().eq("video_id", video.id).eq("user_id", user.id)
      : await supabase.from("video_reactions").insert({ video_id: video.id, user_id: user.id, reaction: "like" });
    if (result.error) notify("Reaction failed", result.error.message, "error");
    else {
      setVideos((all) => all.map((row) => row.id === video.id ? { ...row, video_reactions: [{ count: Math.max(0, Number(row.video_reactions?.[0]?.count || 0) + (existing ? -1 : 1)) }] } : row));
      notify(existing ? "Like removed." : "Video liked.", undefined, "success");
    }
  };

  const saveVideo = async (video: VideoRow) => {
    if (!user?.id) { setAuthOpen(true); return; }
    let { data: list, error } = await supabase.from("playlists").select("id").eq("owner_id", user.id).eq("title", "Watch later").maybeSingle();
    if (error) { notify("Could not open your library", error.message, "error"); return; }
    if (!list) {
      const created = await supabase.from("playlists").insert({ owner_id: user.id, title: "Watch later", description: "Videos saved for later.", visibility: "private" }).select("id").single();
      if (created.error) { notify("Could not create Watch later", created.error.message, "error"); return; }
      list = created.data;
    }
    const { error: itemError } = await supabase.from("playlist_items").upsert({ playlist_id: list.id, video_id: video.id, position: 0 }, { onConflict: "playlist_id,video_id" });
    if (itemError) notify("Could not save video", itemError.message, "error");
    else { notify("Saved to Watch later.", undefined, "success"); if (section === "library") void loadLibrary(); }
  };

  const repostVideo = async (video: VideoRow) => {
    if (!user?.id) { setAuthOpen(true); return; }
    const { error } = await supabase.from("reposts").upsert({ video_id: video.id, user_id: user.id }, { onConflict: "video_id,user_id" });
    if (error) notify("Could not repost video", error.message, "error");
    else notify("Reposted to your network.", undefined, "success");
  };

  const publishLive = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.id) { setAuthOpen(true); return; }
    if (!livekitUrl.startsWith("wss://") && !livekitUrl.startsWith("ws://")) {
      notify("Live streaming needs a LiveKit endpoint", "Set VITE_LIVEKIT_URL and configure LIVEKIT_API_KEY / LIVEKIT_API_SECRET in Supabase Edge Function secrets.", "error"); return;
    }
    if (!liveTitle.trim()) return;
    setUploadBusy(true);
    const id = crypto.randomUUID();
    const { data: created, error } = await supabase.from("live_streams").insert({
      id, creator_id: user.id, title: liveTitle.trim(), description: liveDescription.trim(),
      status: "live", visibility: "public", provider: "livekit", room_name: "omnitube-" + id
    }).select("id,creator_id,title,description,status,visibility,room_name,starts_at").single();
    if (error || !created) { setUploadBusy(false); notify("Could not start your stream", error?.message || "Stream record was not created.", "error"); return; }
    const { data, error: tokenError } = await supabase.functions.invoke("livekit-token", { body: { streamId: id, role: "publisher" } });
    setUploadBusy(false);
    if (tokenError || !data?.token) {
      await supabase.from("live_streams").update({ status: "cancelled", ended_at: new Date().toISOString() }).eq("id", id);
      notify("Broadcast authorization failed", tokenError?.message || data?.error || "Configure LiveKit server credentials in Supabase.", "error"); return;
    }
    setLiveSetup(false); setLiveTitle(""); setLiveDescription("");
    setRoom({ stream: { ...created, creator: profile || undefined }, token: data.token as string, broadcaster: true });
  };

  const joinLive = async (stream: StreamRow) => {
    if (!user?.id) { setAuthOpen(true); return; }
    if (!livekitUrl) { notify("Live playback isn't configured", "Set VITE_LIVEKIT_URL and the server-side LiveKit credentials.", "error"); return; }
    const { data, error } = await supabase.functions.invoke("livekit-token", { body: { streamId: stream.id, role: "viewer" } });
    if (error || !data?.token) notify("Could not join live room", error?.message || data?.error || "The live authorization service is unavailable.", "error");
    else setRoom({ stream, token: data.token as string, broadcaster: false });
  };

  const endRoom = async () => {
    if (room?.broadcaster && user?.id) {
      const { error } = await supabase.from("live_streams").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", room.stream.id).eq("creator_id", user.id);
      if (error) notify("Could not end stream record", error.message, "error");
    }
    setRoom(null);
    if (section === "live") void loadStreams();
  };

  const createPostReaction = async (post: PostRow) => {
    if (!user?.id) { setAuthOpen(true); return; }
    const { error } = await supabase.from("post_reactions").upsert({ post_id: post.id, user_id: user.id, reaction: "like" }, { onConflict: "post_id,user_id" });
    if (error) notify("Could not react to post", error.message, "error");
    else { setPosts((all) => all.map((item) => item.id === post.id ? { ...item, likes: Number(item.likes || 0) + 1 } : item)); notify("Post liked.", undefined, "success"); }
  };

  const markNotificationRead = async (id: string) => {
    if (!user?.id) return;
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("recipient_id", user.id);
    if (!error) setNotifications((items) => items.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item));
  };

  const countUnread = notifications.filter((item) => !item.read_at).length;
  const contentVideos = section === "library" ? libraryVideos : videos;
  const contentHeading = appliedQuery ? "Results for “" + appliedQuery + "”" : titleFor[section];
  const needsLoginForCurrentSection = (section === "subscriptions" || section === "library" || section === "notifications") && !user;
  const chooseSection = (next: Section) => { setSection(next); setSidebarOpen(false); setAppliedQuery(""); setQuery(""); };

  if (!isSupabaseConfigured) return <main className="configuration-screen">
    <div className="brand-lockup"><span className="brand-mark"><span>O</span></span><span>omni<span>tube</span></span></div>
    <div className="configuration-card"><div className="empty-icon"><Settings size={24} /></div><p className="eyebrow">ENVIRONMENT SETUP</p><h1>Connect your Supabase project.</h1><p>OmniTube is wired to Supabase Auth, Postgres, Storage and Edge Functions. Add your project’s public API URL and publishable key to the local environment before starting the app.</p><div className="config-code">VITE_SUPABASE_URL=https://your-project.supabase.co<br />VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…</div><p className="muted">The publishable key is designed for browser use; never use the service-role key here.</p><a className="btn btn-primary" href="https://supabase.com/dashboard/project/_/settings/api" target="_blank" rel="noreferrer">Open API settings <ExternalLinkIcon /></a></div>
  </main>;

  return <div className="app-shell">
    <aside className={"sidebar " + (sidebarOpen ? "sidebar-open" : "")}>
      <div className="brand-lockup"><button className="brand-mark" onClick={() => chooseSection("home")} aria-label="OmniTube home"><span>O</span></button><button className="brand-word" onClick={() => chooseSection("home")}>omni<span>tube</span><sup>®</sup></button><button className="icon-btn sidebar-close" onClick={() => setSidebarOpen(false)}><X /></button></div>
      <div className="sidebar-label">YOUR UNIVERSE</div>
      <nav className="primary-nav">{NAV.map(({ id, label, icon: Icon }) => <button key={id} className={"nav-item " + (section === id ? "active" : "")} onClick={() => chooseSection(id)}><Icon size={19} strokeWidth={section === id ? 2.4 : 1.8} /><span>{label}</span>{id === "live" && streams.some((stream) => stream.status === "live") && <span className="nav-live" />}</button>)}</nav>
      <div className="sidebar-divider" />
      <div className="sidebar-label">CREATE & MANAGE</div>
      <nav className="primary-nav"><button className={"nav-item " + (section === "studio" ? "active" : "")} onClick={() => { if (!user) setAuthOpen(true); else chooseSection("studio"); }}><MonitorPlay size={19} /><span>Creator studio</span></button>
      <button className={"nav-item " + (section === "notifications" ? "active" : "")} onClick={() => chooseSection("notifications")}><Bell size={19} /><span>Notifications</span>{countUnread > 0 && <span className="nav-count">{countUnread > 9 ? "9+" : countUnread}</span>}</button></nav>
      <div className="sidebar-bottom"><div className="creator-callout"><div className="creator-callout-icon"><Sparkles size={18} /></div><strong>Your next chapter starts here.</strong><p>Upload, go live, and build something worth following.</p><button className="btn btn-primary full" onClick={() => { if (!user) setAuthOpen(true); else setUploadOpen(true); }}><Plus size={15} /> Create content</button></div>
      <div className="sidebar-footer"><span>OMNITUBE BUILD 1.0</span><button className="footer-help" onClick={() => notify("OmniTube help", "For account issues, check your sign-in email and Supabase Auth settings.")}><CircleHelp size={14} /></button></div></div>
    </aside>

    <main className="main-shell">
      <header className="topbar"><div className="topbar-left"><button className="icon-btn mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu /></button><div className="breadcrumb"><span>OmniTube</span><span className="breadcrumb-slash">/</span><strong>{titleFor[section]}</strong></div></div>
        <form className="search-bar" onSubmit={(event) => { event.preventDefault(); setAppliedQuery(query.trim()); setSection("home"); }}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search videos, creators, topics…" aria-label="Search videos, creators, and topics" /><kbd>↵</kbd></form>
        <div className="topbar-actions"><button className="icon-btn topbar-bell" onClick={() => chooseSection("notifications")} title="Notifications"><Bell size={19} />{countUnread > 0 && <i />}</button>{user ? <><button className="profile-chip" onClick={() => chooseSection("studio")}><Avatar profile={profile} size="sm" /><span>{profile?.display_name || user.email?.split("@")[0] || "Creator"}</span><ChevronDown size={14} /></button><button className="icon-btn sign-out-button" onClick={() => void signOut()} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button></> : <button className="btn btn-primary sign-in" onClick={() => setAuthOpen(true)}><LogIn size={15} /> Sign in</button>}<button className="btn btn-primary top-create" onClick={() => { if (!user) setAuthOpen(true); else setUploadOpen(true); }}><Plus size={16} /> Create</button></div>
      </header>

      <div className="content-area">
        {section === "home" && !appliedQuery && <section className="hero-banner"><div className="hero-copy"><span className="hero-kicker"><span className="hero-kicker-dot" /> A NEW WAY TO WATCH & CREATE</span><h1>Your world,<br /><span>in motion.</span></h1><p>Discover remarkable videos. Make your own corner of the internet. Go live with the people who get you.</p><div className="hero-actions"><button className="btn btn-primary" onClick={() => { if (!user) setAuthOpen(true); else setUploadOpen(true); }}><Upload size={16} /> Start creating</button><button className="btn btn-glass" onClick={() => chooseSection("shorts")}><Clapperboard size={16} /> Explore shorts</button></div><div className="hero-footnote"><span><span className="live-dot" /> BUILT FOR CREATORS</span><span>VIDEO · COMMUNITY · LIVE</span></div></div><div className="hero-art" aria-hidden="true"><div className="hero-ring ring-a" /><div className="hero-ring ring-b" /><div className="hero-glass-card glass-card-one"><span className="glass-card-icon"><Play size={24} fill="currentColor" /></span><div className="glass-lines"><b /><b /><small /></div></div><div className="hero-glass-card glass-card-two"><span className="pulse-wave"><i /><i /><i /><i /><i /><i /><i /></span><div><strong>LIVE / ON AIR</strong><small>Broadcast your world</small></div><span className="hero-live-dot" /></div><div className="hero-core"><div className="hero-play"><Play size={42} fill="currentColor" /></div><span>CREATE WHAT MOVES YOU</span></div><span className="hero-orbit-dot" /></div></section>}

        <div className="section-heading"><div><p className="eyebrow">{section === "shorts" ? "VERTICAL. IMMERSIVE. YOURS." : section === "trending" ? "WHAT PEOPLE ARE WATCHING" : section === "live" ? "REAL PEOPLE, REAL TIME" : section === "posts" ? "THE COMMUNITY FEED" : section === "subscriptions" ? "FROM YOUR CREATORS" : section === "library" ? "SAVED FOR YOUR NEXT SESSION" : section === "studio" ? "YOUR CREATOR WORKSPACE" : "A FRESH POINT OF VIEW"}</p><h2>{contentHeading}</h2><p className="section-subtitle">{section === "shorts" ? "Short-form stories, with no end to what you might find." : section === "live" ? "Join a live room or start a broadcast of your own." : section === "posts" ? "Updates, ideas and behind-the-scenes moments from creators." : section === "subscriptions" ? "The latest from creators you choose to follow." : section === "library" ? "Your saved videos, ready when you are." : section === "studio" ? "Everything you need to publish and grow, together." : section === "trending" ? "Videos gaining the most views across OmniTube." : "Good things are happening across the universe."}</p></div>
          <div className="section-controls">{section !== "shorts" && section !== "posts" && section !== "live" && section !== "studio" && section !== "notifications" && <span className="live-independent"><span className="hero-kicker-dot" /> REAL CREATOR CONTENT</span>}{(section === "home" || section === "trending" || section === "shorts" || section === "subscriptions") && <button className="icon-btn" aria-label="Refresh feed" onClick={() => void loadVideos()}><ArrowDownUp size={17} /></button>}</div>
        </div>

        {section === "home" && !appliedQuery && <div className="topic-row"><button className="topic-pill active" onClick={() => setAppliedQuery("")}>For you</button><button className="topic-pill" onClick={() => { setQuery("Technology"); setAppliedQuery("Technology"); }}>Technology</button><button className="topic-pill" onClick={() => { setQuery("Music"); setAppliedQuery("Music"); }}>Music</button><button className="topic-pill" onClick={() => { setQuery("Education"); setAppliedQuery("Education"); }}>Learning</button><button className="topic-pill" onClick={() => chooseSection("trending")}><TrendingUp size={14} /> Trending</button><button className="topic-pill" onClick={() => chooseSection("shorts")}><Clapperboard size={14} /> Shorts</button></div>}

        {needsLoginForCurrentSection && <EmptyState icon={LogIn as typeof VideoIcon} title="Your space is waiting." detail="Sign in to see the creators you follow, your saved videos, and your personal notifications." action={<button className="btn btn-primary" onClick={() => setAuthOpen(true)}><LogIn size={16} /> Sign in to continue</button>} />}

        {section === "studio" && <div className="studio-grid">
          <div className="studio-welcome"><div className="studio-avatar"><Avatar profile={profile} size="lg" /></div><div><p className="eyebrow">WELCOME BACK</p><h3>{profile?.display_name || user?.email?.split("@")[0] || "Creator"}</h3><p className="muted">This is your control room. Your real video and audience data appears here as you publish.</p></div><button className="btn btn-primary" onClick={() => setUploadOpen(true)}><Upload size={16} /> Upload video</button></div>
          <div className="studio-stat"><span>Published videos</span><strong>{formatCount(myVideos.filter((item) => item.status === "published").length)}</strong><small>Your actual creator library</small></div>
          <div className="studio-stat"><span>Following</span><strong>{formatCount(followingIds.length)}</strong><small>Creators in your network</small></div>
          <div className="studio-stat"><span>Published shorts</span><strong>{formatCount(myVideos.filter((item) => item.status === "published" && item.kind === "short").length)}</strong><small>Short-form videos on your channel</small></div>
          <div className="studio-action-card"><div className="studio-action-icon"><VideoIcon /></div><h3>Publish a video</h3><p>Resumable uploads, thumbnail support, visibility controls and server-side publication validation.</p><button className="btn btn-quiet" onClick={() => setUploadOpen(true)}>Open upload studio <ChevronDown size={15} /></button></div>
          <div className="studio-action-card"><div className="studio-action-icon violet"><Radio /></div><h3>Go live</h3><p>Launch a low-latency live room with camera, microphone and subscriber viewing through LiveKit.</p><button className="btn btn-quiet" onClick={() => setLiveSetup(true)}>Configure broadcast <ChevronDown size={15} /></button></div>
          <div className="studio-action-card"><div className="studio-action-icon blue"><MessageCircle /></div><h3>Build a community</h3><p>Publish updates and conversations that live alongside your videos.</p><button className="btn btn-quiet" onClick={() => chooseSection("posts")}>Open community <ChevronDown size={15} /></button></div>
          <div className="studio-library-panel"><div className="studio-library-heading"><div><p className="eyebrow">YOUR CONTENT</p><h3>Manage your uploads</h3></div><span>{myVideos.length} {myVideos.length === 1 ? "video" : "videos"}</span></div>
            {studioLoading ? <div className="studio-library-loading"><span className="spinner" /> Loading your library…</div> : myVideos.map((item) => <article className="studio-video-row" key={item.id}>
              <ThumbnailPreview path={item.thumbnail_path} />
              <div className="studio-video-copy"><strong>{item.title}</strong><span>{item.status.toUpperCase()} · {item.visibility} · {item.kind === "short" ? "Short" : "Video"}</span><small>{formatCount(item.views_count)} views · {timeAgo(item.published_at || item.created_at)}</small></div>
              <button className="btn btn-quiet studio-video-edit" onClick={() => setEditingVideo(item)} disabled={item.status === "failed"}><Settings size={14} /> Edit</button>
              <button className="icon-btn studio-video-delete" onClick={() => void deleteVideo(item)} aria-label={"Delete " + item.title} title="Delete video"><X size={16} /></button>
            </article>)}
            {!studioLoading && myVideos.length === 0 && <div className="studio-library-empty"><VideoIcon size={22} /><p>Your creator library is empty. Upload a video to start building your channel.</p></div>}
          </div>
        </div>}

        {section === "posts" && user && <PostComposer userId={user.id} notify={notify} onCreated={() => void loadPosts()} />}
        {section === "posts" && !user && <div className="join-community"><div className="join-community-icon"><MessageCircle size={20} /></div><div><strong>Join the conversation.</strong><p>Sign in to share a post or react to creators.</p></div><button className="btn btn-primary" onClick={() => setAuthOpen(true)}>Sign in</button></div>}

        {section === "posts" && <div className="community-feed">{posts.map((post) => <CommunityCard key={post.id} post={post} userId={user?.id || null} onLike={() => void createPostReaction(post)} onReport={() => requestReport("post", post.id)} />)}{posts.length === 0 && <EmptyState icon={MessageCircle} title="Your community starts here." detail="No public posts are available yet. Create the first update and give people something to talk about." action={user ? <button className="btn btn-primary" onClick={() => document.querySelector<HTMLTextAreaElement>(".post-composer textarea")?.focus()}><Plus size={15} /> Write a post</button> : undefined} />}</div>}

        {section === "live" && <><div className="live-hero"><div className="live-hero-copy"><span className="live-pill"><span className="live-dot" /> LIVE EXPERIENCE</span><h3>Meet them <span>in real time.</span></h3><p>Live video and realtime chat, powered by an authenticated low-latency room.</p></div><button className="btn btn-primary" onClick={() => { if (!user) setAuthOpen(true); else setLiveSetup(true); }}><Radio size={16} /> Go live</button></div>
          <div className="live-list-heading"><h3>Live & scheduled</h3><span>{streams.filter((item) => item.status === "live").length} live</span></div>
          <div className="stream-grid">{streams.map((stream) => <article className="stream-card" key={stream.id}><button className="stream-art" onClick={() => stream.status === "live" ? void joinLive(stream) : notify("Stream is scheduled", "This stream is not broadcasting yet.")}><div className="stream-art-orb"><Radio size={28} /></div><span className={stream.status === "live" ? "stream-status is-live" : "stream-status"}>{stream.status === "live" ? "● LIVE NOW" : "SCHEDULED"}</span><span className="stream-play"><Play fill="currentColor" size={19} /></span></button><div className="stream-card-info"><Avatar profile={stream.creator} /><div><strong>{stream.title}</strong><small>{stream.creator?.display_name || "Creator"} · {stream.status === "live" ? "On air" : new Date(stream.starts_at).toLocaleString()}</small><p>{stream.description || "Join the room to watch and take part."}</p></div></div>{stream.status === "live" && <button className="btn btn-primary full" onClick={() => void joinLive(stream)}><Play size={15} /> Join live room</button>}</article>)}</div>
          {streams.length === 0 && <EmptyState icon={Radio} title="No one is live right now." detail="Live rooms will appear here when a creator starts broadcasting. You can be the first one on air." action={<button className="btn btn-primary" onClick={() => { if (!user) setAuthOpen(true); else setLiveSetup(true); }}><Radio size={16} /> Start a broadcast</button>} />}
        </>}

        {section === "notifications" && (user ? <div className="notification-list">{notifications.map((item) => <button key={item.id} className={"notification-item " + (!item.read_at ? "unread" : "")} onClick={() => void markNotificationRead(item.id)}><span className="notification-icon"><Bell size={17} /></span><span className="notification-text"><strong>{item.body}</strong><small>{timeAgo(item.created_at)} · {item.kind}</small></span>{!item.read_at && <i />}</button>)}{notifications.length === 0 && <EmptyState icon={Bell} title="All quiet for now." detail="Follow creators and take part in the community to build your notification feed." />}</div> : <EmptyState icon={LogIn as typeof VideoIcon} title="Sign in for your notifications." detail="Your notifications are private to your account." action={<button className="btn btn-primary" onClick={() => setAuthOpen(true)}>Sign in</button>} />)}

        {(section === "home" || section === "trending" || section === "shorts" || section === "subscriptions" || section === "library") && !needsLoginForCurrentSection && <>{section === "shorts" && <div className="shorts-intro"><Clapperboard size={17} /><span>Quick stories from creators. Tap any short to watch in the full player.</span></div>}
          {loading ? <div className="loading-grid">{Array.from({ length: section === "shorts" ? 6 : 8 }, (_, i) => <div className="video-skeleton" key={i}><div /><span /><small /></div>)}</div> :
            contentVideos.length > 0 ? <><div className={"video-grid " + (section === "shorts" ? "shorts-grid" : "")}>{contentVideos.map((video) => <VideoCard key={video.id} video={video} onPlay={() => openVideo(video)} onLike={() => void likeVideo(video)} onSave={() => void saveVideo(video)} onRepost={() => void repostVideo(video)} user={Boolean(user)} following={followingIds.includes(video.creator_id)} onFollow={() => void toggleFollow(video.creator_id)} onReport={() => requestReport("video", video.id)} />)}</div>{section !== "library" && hasMoreVideos && <div className="feed-pagination"><button className="btn btn-quiet" onClick={() => void loadMoreVideos()} disabled={loadingMore || loading}>{loadingMore ? <><span className="spinner" /> Loading more…</> : <>Load more videos <ArrowDownUp size={15} /></>}</button><span>{contentVideos.length} videos loaded</span></div>}</> :
              <EmptyState icon={section === "shorts" ? Clapperboard : section === "library" ? Library : section === "subscriptions" ? Users : section === "trending" ? TrendingUp : Search} title={section === "library" ? "Your Watch later list is empty." : section === "subscriptions" ? "Your following feed is ready for its first creator." : appliedQuery ? "No videos match this search." : section === "shorts" ? "No shorts published yet." : section === "trending" ? "Nothing trending just yet." : "A universe ready to be discovered."} detail={section === "library" ? "Save videos from the action menu to keep them close." : section === "subscriptions" ? "Find creators and follow them to make this space yours." : appliedQuery ? "Try another title, topic, or creator keyword." : section === "shorts" ? "Shorts from real creators will appear here when published." : "Publish the first video to begin filling your real discovery feed."} action={section !== "library" && section !== "subscriptions" ? <button className="btn btn-primary" onClick={() => { if (!user) setAuthOpen(true); else setUploadOpen(true); }}><Upload size={15} /> Upload first video</button> : undefined} />}
        </>}

        <footer className="main-footer"><div className="footer-brand"><span className="brand-mark"><span>O</span></span><span>omni<span>tube</span></span></div><span>A creator-first universe.</span><div className="footer-links"><a href="https://supabase.com/docs" target="_blank" rel="noreferrer">Infrastructure</a><a href="https://livekit.io/" target="_blank" rel="noreferrer">Live media</a><button onClick={() => notify("Community safety", "Report suspicious or harmful content with the report controls as moderation is rolled out.")}>Community safety</button></div></footer>
      </div>
    </main>

    {sidebarOpen && <button className="mobile-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}
    {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} notify={notify} />}
    {reportTarget && user?.id && <ReportDialog targetType={reportTarget.type} targetId={reportTarget.id} userId={user.id} onClose={() => setReportTarget(null)} notify={notify} />}
    {editingVideo && user?.id && <EditVideoDialog video={editingVideo} userId={user.id} onClose={() => setEditingVideo(null)} onUpdated={() => { void loadStudioVideos(); void loadVideos(); }} notify={notify} />}
    {uploadOpen && user?.id && <UploadDialog userId={user.id} notify={notify} onClose={() => setUploadOpen(false)} onPublished={() => { void loadVideos(); if (section === "studio") void loadStudioVideos(); }} />}
    {selectedVideo && <VideoPlayer key={selectedVideo.id} video={selectedVideo} profile={profile} onClose={closeVideo} notify={notify} userId={user?.id || null} />}
    {liveSetup && <Modal onClose={() => { if (!uploadBusy) setLiveSetup(false); }} className="live-setup-modal"><div className="modal-heading"><div><p className="eyebrow">ON-AIR STUDIO</p><h2>Start a live broadcast.</h2><p className="muted">An authorized LiveKit room will be created for your creator identity.</p></div><button className="icon-btn" onClick={() => setLiveSetup(false)}><X /></button></div><form className="stack-form" onSubmit={(event) => void publishLive(event)}><label htmlFor="stream-title">Stream title</label><input id="stream-title" value={liveTitle} onChange={(event) => setLiveTitle(event.target.value)} required maxLength={180} placeholder="What are we getting into today?" /><label htmlFor="stream-description">Description</label><textarea id="stream-description" value={liveDescription} onChange={(event) => setLiveDescription(event.target.value)} rows={3} maxLength={3000} placeholder="Tell viewers what this live session is about." /><div className="provider-info"><Radio size={17} /><div><strong>LiveKit realtime media</strong><span>Requires VITE_LIVEKIT_URL and server-only LIVEKIT_API_KEY / LIVEKIT_API_SECRET in Supabase Edge Function secrets.</span></div></div><div className="modal-footer"><button type="button" className="btn btn-quiet" onClick={() => setLiveSetup(false)} disabled={uploadBusy}>Cancel</button><button type="submit" className="btn btn-primary" disabled={uploadBusy || !liveTitle.trim()}>{uploadBusy ? <><span className="spinner" /> Starting…</> : <><Radio size={16} /> Start broadcast</>}</button></div></form></Modal>}
    {room && livekitUrl && <LiveRoomPane key={room.stream.id} stream={room.stream} token={room.token} serverUrl={livekitUrl} broadcaster={room.broadcaster} userId={user?.id || ""} profile={profile} onClose={() => void endRoom()} notify={notify} />}
    {notice && <div className={"toast toast-" + (notice.kind || "info")} role="status"><span className="toast-icon">{notice.kind === "success" ? <Check size={17} /> : notice.kind === "error" ? <ShieldAlert size={17} /> : <Sparkles size={17} />}</span><div><strong>{notice.title}</strong>{notice.detail && <p>{notice.detail}</p>}</div><button className="icon-btn tiny" onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={16} /></button></div>}
  </div>;
}

function ExternalLinkIcon() { return <span aria-hidden="true">↗</span>; }

export default App;
