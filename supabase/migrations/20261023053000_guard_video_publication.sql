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
  if (tg_op = 'INSERT' and new.status = 'published')
     or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    if v_role in ('service_role', 'postgres', 'supabase_admin') then
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
  end if;
  return new;
end;
$$;
revoke all on function omnitube_private.enforce_video_publication() from public, anon, authenticated;
drop trigger if exists omnitube_video_publication_guard on public.videos;
create trigger omnitube_video_publication_guard
before insert or update of status on public.videos
for each row execute function omnitube_private.enforce_video_publication();