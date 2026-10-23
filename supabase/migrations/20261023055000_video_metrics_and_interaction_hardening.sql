create or replace function omnitube_private.enforce_video_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
  v_uid uuid;
  v_meta jsonb;
  v_mime text;
  v_size bigint;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
  if tg_op = 'INSERT' then
    if v_role = 'authenticated' then
      new.views_count := 0;
      new.published_at := null;
    end if;
    if new.status = 'published' and v_role not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception 'New videos must be uploaded before they can be published' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'published' then
      if v_role in ('service_role', 'postgres', 'supabase_admin') then
        new.published_at := now();
        return new;
      end if;
      v_uid := auth.uid();
      if v_role <> 'authenticated' or v_uid is null or v_uid <> new.creator_id then
        raise exception 'Only the content owner may publish this video' using errcode = '42501';
      end if;
      if new.video_path not like new.creator_id::text || '/%' or position('..' in new.video_path) > 0 then
        raise exception 'Video object path must be scoped to the owner' using errcode = '42501';
      end if;
      select o.metadata into v_meta from storage.objects o
        where o.bucket_id = 'omnitube-videos' and o.name = new.video_path limit 1;
      if not found then
        raise exception 'The original video must be uploaded before publishing' using errcode = '23514';
      end if;
      v_mime := coalesce(v_meta ->> 'mimetype', '');
      v_size := case when coalesce(v_meta ->> 'size', '') ~ '^[0-9]+$'
                     then (v_meta ->> 'size')::bigint else 0 end;
      if v_mime not in ('video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska')
         or v_size < 1 or v_size > 2147483648 then
        raise exception 'The uploaded object has an unsupported media type or size' using errcode = '23514';
      end if;
      new.published_at := now();
    else
      new.published_at := null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function omnitube_private.enforce_video_publication() from public, anon, authenticated;
drop trigger if exists omnitube_video_publication_guard on public.videos;
create trigger omnitube_video_publication_guard before insert or update of status on public.videos
for each row execute function omnitube_private.enforce_video_publication();

revoke insert, update on public.videos from authenticated;
grant insert (id, creator_id, title, description, video_path, thumbnail_path, duration_seconds, visibility, kind, status, category, tags, allow_comments)
on public.videos to authenticated;
grant update (title, description, thumbnail_path, duration_seconds, visibility, kind, status, category, tags, allow_comments, updated_at)
on public.videos to authenticated;

drop policy if exists post_reactions_insert_self on public.post_reactions;
create policy post_reactions_insert_self on public.post_reactions for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.posts p where p.id = post_id and (p.visibility = 'public' or p.creator_id = (select auth.uid()))
  )
);
drop policy if exists reposts_insert_self on public.reposts;
create policy reposts_insert_self on public.reposts for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.videos v where v.id = video_id and v.status = 'published' and v.visibility in ('public','unlisted')
  )
);
drop policy if exists comments_delete_self on public.comments;
create policy comments_delete_self on public.comments for delete to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from public.videos v where v.id = video_id and v.creator_id = (select auth.uid()))
  or exists (select 1 from public.posts p where p.id = post_id and p.creator_id = (select auth.uid()))
);