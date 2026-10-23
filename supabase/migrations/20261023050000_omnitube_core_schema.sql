create schema if not exists omnitube_private;
revoke all on schema omnitube_private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text, display_name text not null default 'Creator' check (char_length(display_name) between 1 and 80),
  avatar_url text, bio text not null default '' check (char_length(bio) <= 500), website text,
  is_verified boolean not null default false, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username_ci_uq on public.profiles(lower(username)) where username is not null;

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 180), description text not null default '' check (char_length(description) <= 5000),
  video_path text not null, thumbnail_path text, duration_seconds numeric(10,2) check (duration_seconds is null or duration_seconds >= 0),
  visibility text not null default 'public' check (visibility in ('public','unlisted','private')),
  kind text not null default 'video' check (kind in ('video','short')),
  status text not null default 'processing' check (status in ('draft','processing','published','failed')),
  category text not null default 'Other' check (char_length(category) <= 60), tags text[] not null default '{}',
  allow_comments boolean not null default true, views_count bigint not null default 0 check (views_count >= 0),
  published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint videos_path_nonempty check (char_length(video_path) > 2)
);
create index if not exists videos_public_feed_idx on public.videos(published_at desc,id) where status='published' and visibility='public';
create index if not exists videos_creator_idx on public.videos(creator_id,created_at desc);
create index if not exists videos_kind_feed_idx on public.videos(kind,published_at desc) where status='published' and visibility='public';
create index if not exists videos_search_idx on public.videos using gin(to_tsvector('english',title || ' ' || description));

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000), media_urls text[] not null default '{}',
  visibility text not null default 'public' check (visibility in ('public','private')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists posts_feed_idx on public.posts(created_at desc);

create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(follower_id,creator_id), check(follower_id<>creator_id)
);
create index if not exists follows_creator_idx on public.follows(creator_id,created_at desc);

create table if not exists public.video_reactions (
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null default 'like' check(reaction in ('like','dislike','heart')),
  created_at timestamptz not null default now(), primary key(video_id,user_id)
);
create table if not exists public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null default 'like' check(reaction in ('like','love')),
  created_at timestamptz not null default now(), primary key(post_id,user_id)
);
create table if not exists public.reposts (
  id uuid primary key default gen_random_uuid(), video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, caption text not null default '' check(char_length(caption)<=500),
  created_at timestamptz not null default now(), unique(video_id,user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(), video_id uuid references public.videos(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade, parent_comment_id uuid references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, body text not null check(char_length(body) between 1 and 3000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint comments_exactly_one_target check ((video_id is not null)::int + (post_id is not null)::int = 1)
);
create index if not exists comments_video_idx on public.comments(video_id,created_at desc) where video_id is not null;
create index if not exists comments_post_idx on public.comments(post_id,created_at desc) where post_id is not null;

create table if not exists public.video_views (
  id uuid primary key default gen_random_uuid(), video_id uuid not null references public.videos(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade, watch_seconds integer not null default 0 check(watch_seconds>=0),
  view_date date not null default current_date, source text not null default 'feed' check(source in ('feed','shorts','search','channel','embed','direct')),
  created_at timestamptz not null default now(), unique(video_id,viewer_id,view_date)
);
create index if not exists video_views_creator_stats_idx on public.video_views(video_id,created_at desc);

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(char_length(title) between 1 and 120), description text not null default '' check(char_length(description)<=1000),
  visibility text not null default 'private' check(visibility in ('public','unlisted','private')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.playlist_items (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade, position integer not null default 0 check(position>=0),
  added_at timestamptz not null default now(), primary key(playlist_id,video_id)
);

create table if not exists public.live_streams (
  id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(char_length(title) between 1 and 180), description text not null default '' check(char_length(description)<=3000),
  status text not null default 'scheduled' check(status in ('scheduled','live','ended','cancelled')),
  visibility text not null default 'public' check(visibility in ('public','unlisted','private')), provider text not null default 'livekit',
  room_name text not null unique, playback_url text, chat_enabled boolean not null default true,
  starts_at timestamptz not null default now(), ended_at timestamptz, replay_video_id uuid references public.videos(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists live_streams_schedule_idx on public.live_streams(starts_at asc) where status='scheduled';
create index if not exists live_streams_live_idx on public.live_streams(created_at desc) where status='live';

create table if not exists public.stream_messages (
  id uuid primary key default gen_random_uuid(), stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, body text not null check(char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists stream_messages_timeline_idx on public.stream_messages(stream_id,created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, kind text not null check(kind in ('follow','reaction','comment','repost','live','system','mention')),
  entity_type text check(entity_type in ('video','post','comment','stream','profile')), entity_id uuid,
  body text not null check(char_length(body)<=500), read_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id,created_at desc);
create index if not exists notifications_unread_idx on public.notifications(recipient_id) where read_at is null;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(), reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check(target_type in ('video','post','comment','profile','stream')), target_id uuid not null,
  reason text not null check(reason in ('spam','harassment','hate','violence','sexual_content','copyright','misinformation','other')),
  details text not null default '' check(char_length(details)<=2000),
  status text not null default 'open' check(status in ('open','reviewing','resolved','dismissed')), created_at timestamptz not null default now()
);
create index if not exists reports_queue_idx on public.reports(status,created_at asc);

create table if not exists public.channel_memberships (
  id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade, tier text not null default 'supporter' check(char_length(tier) between 1 and 80),
  status text not null default 'pending' check(status in ('pending','active','cancelled','expired')),
  provider text, provider_subscription_id text, started_at timestamptz, current_period_end timestamptz,
  created_at timestamptz not null default now(), unique(creator_id,member_id), check(creator_id<>member_id)
);

create or replace function omnitube_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,display_name,avatar_url)
  values(new.id,left(coalesce(nullif(new.raw_user_meta_data->>'full_name',''),nullif(new.raw_user_meta_data->>'name',''),nullif(split_part(coalesce(new.email,''),'@',1),''),'Creator'),80),nullif(new.raw_user_meta_data->>'avatar_url',''))
  on conflict(id) do nothing;
  return new;
end;
$$;
revoke all on function omnitube_private.handle_new_user() from public,anon,authenticated;
drop trigger if exists omnitube_auth_user_created on auth.users;
create trigger omnitube_auth_user_created after insert on auth.users for each row execute function omnitube_private.handle_new_user();

create or replace function omnitube_private.increment_video_views()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.videos set views_count=views_count+1 where id=new.video_id;
  return new;
end;
$$;
revoke all on function omnitube_private.increment_video_views() from public,anon,authenticated;
drop trigger if exists omnitube_video_view_count on public.video_views;
create trigger omnitube_video_view_count after insert on public.video_views for each row execute function omnitube_private.increment_video_views();

alter table public.profiles enable row level security;
alter table public.videos enable row level security;
alter table public.posts enable row level security;
alter table public.follows enable row level security;
alter table public.video_reactions enable row level security;
alter table public.post_reactions enable row level security;
alter table public.reposts enable row level security;
alter table public.comments enable row level security;
alter table public.video_views enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;
alter table public.live_streams enable row level security;
alter table public.stream_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.channel_memberships enable row level security;

drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles for select to anon,authenticated using(true);
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated with check(id=(select auth.uid()));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));

drop policy if exists videos_read_published_or_owner on public.videos;
create policy videos_read_published_or_owner on public.videos for select to anon,authenticated using((status='published' and visibility in ('public','unlisted')) or creator_id=(select auth.uid()));
drop policy if exists videos_insert_owner on public.videos;
create policy videos_insert_owner on public.videos for insert to authenticated with check(creator_id=(select auth.uid()) and status in ('draft','processing'));
drop policy if exists videos_update_owner on public.videos;
create policy videos_update_owner on public.videos for update to authenticated using(creator_id=(select auth.uid())) with check(creator_id=(select auth.uid()));
drop policy if exists videos_delete_owner on public.videos;
create policy videos_delete_owner on public.videos for delete to authenticated using(creator_id=(select auth.uid()));

drop policy if exists posts_read_public_or_owner on public.posts;
create policy posts_read_public_or_owner on public.posts for select to anon,authenticated using(visibility='public' or creator_id=(select auth.uid()));
drop policy if exists posts_insert_owner on public.posts;
create policy posts_insert_owner on public.posts for insert to authenticated with check(creator_id=(select auth.uid()));
drop policy if exists posts_update_owner on public.posts;
create policy posts_update_owner on public.posts for update to authenticated using(creator_id=(select auth.uid())) with check(creator_id=(select auth.uid()));
drop policy if exists posts_delete_owner on public.posts;
create policy posts_delete_owner on public.posts for delete to authenticated using(creator_id=(select auth.uid()));

drop policy if exists follows_read_all on public.follows;
create policy follows_read_all on public.follows for select to anon,authenticated using(true);
drop policy if exists follows_insert_self on public.follows;
create policy follows_insert_self on public.follows for insert to authenticated with check(follower_id=(select auth.uid()) and follower_id<>creator_id);
drop policy if exists follows_delete_self on public.follows;
create policy follows_delete_self on public.follows for delete to authenticated using(follower_id=(select auth.uid()));

drop policy if exists video_reactions_read_all on public.video_reactions;
create policy video_reactions_read_all on public.video_reactions for select to anon,authenticated using(exists(select 1 from public.videos v where v.id=video_id and ((v.status='published' and v.visibility in ('public','unlisted')) or v.creator_id=(select auth.uid()))));
drop policy if exists video_reactions_insert_self on public.video_reactions;
create policy video_reactions_insert_self on public.video_reactions for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.videos v where v.id=video_id and v.status='published' and v.visibility in ('public','unlisted')));
drop policy if exists video_reactions_update_self on public.video_reactions;
create policy video_reactions_update_self on public.video_reactions for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists video_reactions_delete_self on public.video_reactions;
create policy video_reactions_delete_self on public.video_reactions for delete to authenticated using(user_id=(select auth.uid()));

drop policy if exists post_reactions_read_all on public.post_reactions;
create policy post_reactions_read_all on public.post_reactions for select to anon,authenticated using(exists(select 1 from public.posts p where p.id=post_id and (p.visibility='public' or p.creator_id=(select auth.uid()))));
drop policy if exists post_reactions_insert_self on public.post_reactions;
create policy post_reactions_insert_self on public.post_reactions for insert to authenticated with check(user_id=(select auth.uid()));
drop policy if exists post_reactions_update_self on public.post_reactions;
create policy post_reactions_update_self on public.post_reactions for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists post_reactions_delete_self on public.post_reactions;
create policy post_reactions_delete_self on public.post_reactions for delete to authenticated using(user_id=(select auth.uid()));

drop policy if exists reposts_read_all on public.reposts;
create policy reposts_read_all on public.reposts for select to anon,authenticated using(exists(select 1 from public.videos v where v.id=video_id and ((v.status='published' and v.visibility in ('public','unlisted')) or v.creator_id=(select auth.uid()))));
drop policy if exists reposts_insert_self on public.reposts;
create policy reposts_insert_self on public.reposts for insert to authenticated with check(user_id=(select auth.uid()));
drop policy if exists reposts_delete_self on public.reposts;
create policy reposts_delete_self on public.reposts for delete to authenticated using(user_id=(select auth.uid()));

drop policy if exists comments_read_public_target_or_owner on public.comments;
create policy comments_read_public_target_or_owner on public.comments for select to anon,authenticated using(user_id=(select auth.uid()) or (video_id is not null and exists(select 1 from public.videos v where v.id=video_id and v.status='published' and v.visibility in ('public','unlisted'))) or (post_id is not null and exists(select 1 from public.posts p where p.id=post_id and p.visibility='public')));
drop policy if exists comments_insert_self on public.comments;
create policy comments_insert_self on public.comments for insert to authenticated with check(user_id=(select auth.uid()) and ((video_id is not null and exists(select 1 from public.videos v where v.id=video_id and v.status='published' and v.allow_comments=true and v.visibility in ('public','unlisted'))) or (post_id is not null and exists(select 1 from public.posts p where p.id=post_id and p.visibility='public'))));
drop policy if exists comments_update_self on public.comments;
create policy comments_update_self on public.comments for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists comments_delete_self on public.comments;
create policy comments_delete_self on public.comments for delete to authenticated using(user_id=(select auth.uid()) or exists(select 1 from public.videos v where v.id=video_id and v.creator_id=(select auth.uid())));

drop policy if exists views_read_owner_or_video_creator on public.video_views;
create policy views_read_owner_or_video_creator on public.video_views for select to authenticated using(viewer_id=(select auth.uid()) or exists(select 1 from public.videos v where v.id=video_id and v.creator_id=(select auth.uid())));
drop policy if exists views_insert_self on public.video_views;
create policy views_insert_self on public.video_views for insert to authenticated with check(viewer_id=(select auth.uid()) and exists(select 1 from public.videos v where v.id=video_id and v.status='published' and v.visibility in ('public','unlisted')));
drop policy if exists views_update_self on public.video_views;
create policy views_update_self on public.video_views for update to authenticated using(viewer_id=(select auth.uid())) with check(viewer_id=(select auth.uid()));

drop policy if exists playlists_read_visible on public.playlists;
create policy playlists_read_visible on public.playlists for select to anon,authenticated using(visibility in ('public','unlisted') or owner_id=(select auth.uid()));
drop policy if exists playlists_insert_owner on public.playlists;
create policy playlists_insert_owner on public.playlists for insert to authenticated with check(owner_id=(select auth.uid()));
drop policy if exists playlists_update_owner on public.playlists;
create policy playlists_update_owner on public.playlists for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
drop policy if exists playlists_delete_owner on public.playlists;
create policy playlists_delete_owner on public.playlists for delete to authenticated using(owner_id=(select auth.uid()));
drop policy if exists playlist_items_read_visible on public.playlist_items;
create policy playlist_items_read_visible on public.playlist_items for select to anon,authenticated using(exists(select 1 from public.playlists p where p.id=playlist_id and (p.visibility in ('public','unlisted') or p.owner_id=(select auth.uid()))) and exists(select 1 from public.videos v where v.id=video_id and ((v.status='published' and v.visibility in ('public','unlisted')) or v.creator_id=(select auth.uid()))));
drop policy if exists playlist_items_manage_owner on public.playlist_items;
create policy playlist_items_manage_owner on public.playlist_items for all to authenticated using(exists(select 1 from public.playlists p where p.id=playlist_id and p.owner_id=(select auth.uid()))) with check(exists(select 1 from public.playlists p where p.id=playlist_id and p.owner_id=(select auth.uid())));

drop policy if exists live_streams_read_public_or_owner on public.live_streams;
create policy live_streams_read_public_or_owner on public.live_streams for select to anon,authenticated using((visibility in ('public','unlisted') and status in ('scheduled','live','ended')) or creator_id=(select auth.uid()));
drop policy if exists live_streams_insert_owner on public.live_streams;
create policy live_streams_insert_owner on public.live_streams for insert to authenticated with check(creator_id=(select auth.uid()));
drop policy if exists live_streams_update_owner on public.live_streams;
create policy live_streams_update_owner on public.live_streams for update to authenticated using(creator_id=(select auth.uid())) with check(creator_id=(select auth.uid()));
drop policy if exists live_streams_delete_owner on public.live_streams;
create policy live_streams_delete_owner on public.live_streams for delete to authenticated using(creator_id=(select auth.uid()));

drop policy if exists stream_messages_read_visible on public.stream_messages;
create policy stream_messages_read_visible on public.stream_messages for select to authenticated using(exists(select 1 from public.live_streams s where s.id=stream_id and s.chat_enabled and s.status='live' and s.visibility in ('public','unlisted')));
drop policy if exists stream_messages_insert_self on public.stream_messages;
create policy stream_messages_insert_self on public.stream_messages for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.live_streams s where s.id=stream_id and s.chat_enabled and s.status='live' and s.visibility in ('public','unlisted')));

drop policy if exists notifications_read_self on public.notifications;
create policy notifications_read_self on public.notifications for select to authenticated using(recipient_id=(select auth.uid()));
drop policy if exists notifications_update_self on public.notifications;
create policy notifications_update_self on public.notifications for update to authenticated using(recipient_id=(select auth.uid())) with check(recipient_id=(select auth.uid()));
drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self on public.reports for insert to authenticated with check(reporter_id=(select auth.uid()));
drop policy if exists reports_read_self on public.reports;
create policy reports_read_self on public.reports for select to authenticated using(reporter_id=(select auth.uid()));
drop policy if exists memberships_read_parties on public.channel_memberships;
create policy memberships_read_parties on public.channel_memberships for select to authenticated using(creator_id=(select auth.uid()) or member_id=(select auth.uid()));

grant usage on schema public to anon,authenticated;
grant select on public.profiles,public.videos,public.posts,public.follows,public.video_reactions,public.post_reactions,public.reposts,public.comments,public.playlists,public.playlist_items,public.live_streams to anon,authenticated;
grant select,insert,update,delete on public.profiles to authenticated;
grant select,insert,update,delete on public.videos,public.posts,public.follows,public.video_reactions,public.post_reactions,public.reposts,public.comments,public.video_views,public.playlists,public.playlist_items,public.live_streams,public.stream_messages,public.notifications,public.reports,public.channel_memberships to authenticated;
grant select on public.video_views to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('omnitube-videos','omnitube-videos',false,2147483648,array['video/mp4','video/webm','video/quicktime','video/x-matroska']),
('omnitube-assets','omnitube-assets',true,15728640,array['image/jpeg','image/png','image/webp','image/avif','image/gif'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists omnitube_video_read_published_or_owner on storage.objects;
create policy omnitube_video_read_published_or_owner on storage.objects for select to anon,authenticated using(bucket_id='omnitube-videos' and exists(select 1 from public.videos v where v.video_path=name and ((v.status='published' and v.visibility in ('public','unlisted')) or v.creator_id=(select auth.uid()))));
drop policy if exists omnitube_video_insert_owner_folder on storage.objects;
create policy omnitube_video_insert_owner_folder on storage.objects for insert to authenticated with check(bucket_id='omnitube-videos' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists omnitube_video_update_owner_folder on storage.objects;
create policy omnitube_video_update_owner_folder on storage.objects for update to authenticated using(bucket_id='omnitube-videos' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='omnitube-videos' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists omnitube_video_delete_owner_folder on storage.objects;
create policy omnitube_video_delete_owner_folder on storage.objects for delete to authenticated using(bucket_id='omnitube-videos' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists omnitube_assets_public_read on storage.objects;
create policy omnitube_assets_public_read on storage.objects for select to anon,authenticated using(bucket_id='omnitube-assets');
drop policy if exists omnitube_assets_insert_owner_folder on storage.objects;
create policy omnitube_assets_insert_owner_folder on storage.objects for insert to authenticated with check(bucket_id='omnitube-assets' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists omnitube_assets_update_owner_folder on storage.objects;
create policy omnitube_assets_update_owner_folder on storage.objects for update to authenticated using(bucket_id='omnitube-assets' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='omnitube-assets' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists omnitube_assets_delete_owner_folder on storage.objects;
create policy omnitube_assets_delete_owner_folder on storage.objects for delete to authenticated using(bucket_id='omnitube-assets' and (storage.foldername(name))[1]=(select auth.uid())::text);