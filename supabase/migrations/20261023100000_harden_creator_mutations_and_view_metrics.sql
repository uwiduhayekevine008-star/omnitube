begin;

-- Exposed profile records remain readable, but identity and verification state are
-- server-managed. The auth.users trigger is the only normal profile creation path.
revoke insert, update, delete on table public.profiles from authenticated;
grant update (username, display_name, avatar_url, bio, website, updated_at)
  on table public.profiles to authenticated;

create or replace function omnitube_private.guard_profile_privileged_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
begin
  if v_role in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.is_verified is distinct from old.is_verified
     or new.created_at is distinct from old.created_at then
    raise exception 'Profile identity, verification, and creation time are managed by OmniTube'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function omnitube_private.guard_profile_privileged_fields() from public, anon, authenticated;
drop trigger if exists omnitube_guard_profile_privileged_fields on public.profiles;
create trigger omnitube_guard_profile_privileged_fields
before update on public.profiles
for each row execute function omnitube_private.guard_profile_privileged_fields();

-- Prevent users from changing ownership, original object keys, or counters after
-- a video is created. A custom thumbnail must exist in the private thumbnail
-- bucket, be stored under the creator's own folder, and have safe metadata.
create or replace function omnitube_private.guard_video_privileged_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
  v_uid uuid;
  v_meta jsonb;
  v_mime text;
  v_size bigint;
begin
  if v_role in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  v_uid := auth.uid();
  if v_role <> 'authenticated' or v_uid is null then
    raise exception 'A signed-in owner is required to create or update video metadata'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.creator_id is distinct from v_uid then
      raise exception 'Video owner must match the signed-in user' using errcode = '42501';
    end if;
    if new.video_path not like v_uid::text || '/%' or position('..' in new.video_path) > 0 then
      raise exception 'Original media must be stored in the owner''s folder' using errcode = '42501';
    end if;
    if new.views_count <> 0 or new.published_at is not null then
      raise exception 'View counts and publication timestamps are server-managed' using errcode = '42501';
    end if;
  else
    if new.id is distinct from old.id
       or new.creator_id is distinct from old.creator_id
       or new.video_path is distinct from old.video_path
       or new.views_count is distinct from old.views_count
       or new.created_at is distinct from old.created_at then
      raise exception 'Video identity, original media path, creation time, and counters are immutable'
        using errcode = '42501';
    end if;
  end if;

  if new.thumbnail_path is not null then
    -- Only validate a newly assigned thumbnail; legacy thumbnails must not block title edits.
    if tg_op = 'UPDATE' then
      if new.thumbnail_path is not distinct from old.thumbnail_path then
        return new;
      end if;
    end if;

    if new.thumbnail_path not like new.creator_id::text || '/%'
       or position('..' in new.thumbnail_path) > 0 then
      raise exception 'Thumbnail must be stored in the owner''s folder' using errcode = '42501';
    end if;

    select o.metadata into v_meta
      from storage.objects o
      where o.bucket_id = 'omnitube-thumbnails'
        and o.name = new.thumbnail_path
      limit 1;
    if not found then
      raise exception 'Thumbnail upload must complete before it can be attached'
        using errcode = '23514';
    end if;

    v_mime := coalesce(v_meta ->> 'mimetype', '');
    v_size := case
      when coalesce(v_meta ->> 'size', '') ~ '^[0-9]+$' then (v_meta ->> 'size')::bigint
      else 0
    end;
    if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
       or v_size < 1 or v_size > 15728640 then
      raise exception 'Thumbnail type or size is not allowed' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function omnitube_private.guard_video_privileged_fields() from public, anon, authenticated;
drop trigger if exists omnitube_guard_video_privileged_fields on public.videos;
create trigger omnitube_guard_video_privileged_fields
before insert or update on public.videos
for each row execute function omnitube_private.guard_video_privileged_fields();

-- Narrow table privileges to each workflow. RLS continues to enforce ownership;
-- SQL column grants also prevent object IDs and actor IDs being reassigned.
revoke insert, update, delete on table public.posts from authenticated;
grant insert (creator_id, body, media_urls, visibility) on table public.posts to authenticated;
grant update (body, media_urls, visibility) on table public.posts to authenticated;
grant delete on table public.posts to authenticated;

revoke insert, update on table public.follows from authenticated;
grant insert (follower_id, creator_id) on table public.follows to authenticated;
grant delete on table public.follows to authenticated;

revoke insert, update on table public.video_reactions from authenticated;
grant insert (video_id, user_id, reaction) on table public.video_reactions to authenticated;
grant delete on table public.video_reactions to authenticated;

revoke insert, update on table public.post_reactions from authenticated;
grant insert (post_id, user_id, reaction) on table public.post_reactions to authenticated;
grant delete on table public.post_reactions to authenticated;

revoke insert, update on table public.reposts from authenticated;
grant insert (video_id, user_id, caption) on table public.reposts to authenticated;
grant delete on table public.reposts to authenticated;

-- Playlist ordering is editable, but clients cannot reassign item identities or
-- forge add timestamps using leftover table-level INSERT/UPDATE grants.
revoke insert, update on table public.playlist_items from authenticated;
grant insert (playlist_id, video_id, position) on table public.playlist_items to authenticated;
grant update (position) on table public.playlist_items to authenticated;

revoke insert, update, delete on table public.comments from authenticated;
grant insert (video_id, post_id, parent_comment_id, user_id, body) on table public.comments to authenticated;
grant delete on table public.comments to authenticated;

-- Report triage status must never be set by the reporting user. Otherwise a
-- caller could create a pre-resolved report and bypass the moderation queue.
revoke insert, update, delete on table public.reports from authenticated;
grant insert (reporter_id, target_type, target_id, reason, details)
  on table public.reports to authenticated;


-- A recipient can only acknowledge a notification; notification content and
-- routing metadata are authored by trusted database triggers.
revoke insert, update, delete on table public.notifications from authenticated;
grant update (read_at) on table public.notifications to authenticated;

-- The creator can manage room content and lifecycle, but not transfer ownership
-- or mutate provider/room identifiers after the server has issued room tokens.
revoke insert, update, delete on table public.live_streams from authenticated;
grant insert (id, creator_id, title, description, status, visibility, provider, room_name, chat_enabled, starts_at)
  on table public.live_streams to authenticated;
grant update (title, description, status, visibility, chat_enabled, starts_at, ended_at, updated_at)
  on table public.live_streams to authenticated;
grant delete on table public.live_streams to authenticated;

-- Watch metrics are written through one bounded, authenticated API rather than
-- letting a client forge the viewer, view date, or arbitrary watch duration.
revoke insert, update, delete on table public.video_views from authenticated;

create or replace function public.record_video_watch(
  p_video_id uuid,
  p_watch_seconds integer,
  p_source text default 'feed'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_seconds integer := greatest(0, least(coalesce(p_watch_seconds, 0), 43200));
  v_source text := coalesce(p_source, 'feed');
begin
  if v_uid is null then
    raise exception 'Sign-in is required to record watch activity' using errcode = '42501';
  end if;
  if p_video_id is null then
    raise exception 'A video ID is required' using errcode = '22023';
  end if;
  if v_source not in ('feed', 'shorts', 'search', 'channel', 'embed', 'direct') then
    raise exception 'Unsupported watch source' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.videos v
    where v.id = p_video_id
      and (
        (v.status = 'published' and v.visibility in ('public', 'unlisted'))
        or v.creator_id = v_uid
      )
  ) then
    raise exception 'Video is not available for watch tracking' using errcode = '42501';
  end if;

  insert into public.video_views as existing_view (video_id, viewer_id, view_date, watch_seconds, source)
  values (p_video_id, v_uid, current_date, v_seconds, v_source)
  on conflict (video_id, viewer_id, view_date)
  do update set
    watch_seconds = greatest(existing_view.watch_seconds, excluded.watch_seconds),
    source = excluded.source;
end;
$$;
revoke all on function public.record_video_watch(uuid, integer, text) from public, anon;
grant execute on function public.record_video_watch(uuid, integer, text) to authenticated;
comment on function public.record_video_watch(uuid, integer, text)
  is 'Records one authenticated viewer/video/day watch row; server owns the viewer and date and clamps watch duration to 12 hours.';

commit;
