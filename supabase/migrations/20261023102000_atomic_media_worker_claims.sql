begin;

-- Atomically claim one queued, still-published video, update its processing
-- state, and lease the queue row in the same transaction. Concurrent workers
-- skip claimed jobs rather than double-transcoding the same source.
create or replace function public.claim_media_processing_job(
  p_worker_id text,
  p_lease_ms integer default 900000
)
returns table(id uuid, video_id uuid, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_claimed record;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') not in ('service_role', 'postgres', 'supabase_admin')
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Only the media worker service role can claim processing jobs'
      using errcode = '42501';
  end if;
  if p_worker_id is null or char_length(p_worker_id) < 1 or char_length(p_worker_id) > 160 then
    raise exception 'A valid worker identity is required' using errcode = '22023';
  end if;
  if p_lease_ms is null or p_lease_ms < 30000 or p_lease_ms > 3600000 then
    raise exception 'Worker lease must be between 30 seconds and one hour' using errcode = '22023';
  end if;

  select j.id as job_id, j.video_id as target_video_id
    into v_job
  from public.media_processing_jobs j
  join public.videos v on v.id = j.video_id
  where j.status = 'pending'
    and j.available_at <= now()
    and v.status = 'published'
    and v.media_status = 'queued'
  order by j.available_at asc, j.created_at asc
  for update of j skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.media_processing_jobs j
    set status = 'processing',
        attempts = least(j.attempts + 1, 20),
        locked_at = now(),
        locked_by = p_worker_id,
        updated_at = now()
    where j.id = v_job.job_id
      and j.status = 'pending'
    returning j.id as claimed_id, j.video_id as claimed_video_id, j.attempts as claimed_attempts
      into v_claimed;

  if not found then
    return;
  end if;

  update public.videos v
    set media_status = 'processing',
        updated_at = now()
    where v.id = v_claimed.claimed_video_id
      and v.status = 'published'
      and v.media_status = 'queued';

  if not found then
    update public.media_processing_jobs j
      set status = 'pending', locked_at = null, locked_by = null, available_at = now(), updated_at = now()
      where j.id = v_claimed.claimed_id
        and j.status = 'processing'
        and j.locked_by = p_worker_id;
    return;
  end if;

  return query select v_claimed.claimed_id, v_claimed.claimed_video_id, v_claimed.claimed_attempts;
end;
$$;
revoke all on function public.claim_media_processing_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_media_processing_job(text, integer) to service_role;

create or replace function public.recover_expired_media_processing_jobs(
  p_lease_ms integer default 900000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') not in ('service_role', 'postgres', 'supabase_admin')
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Only the media worker service role can recover processing jobs'
      using errcode = '42501';
  end if;
  if p_lease_ms is null or p_lease_ms < 30000 or p_lease_ms > 3600000 then
    raise exception 'Worker lease must be between 30 seconds and one hour' using errcode = '22023';
  end if;

  with expired as (
    update public.media_processing_jobs j
      set status = 'pending',
          locked_at = null,
          locked_by = null,
          available_at = now(),
          last_error = 'Worker lease expired; the job was safely re-queued.',
          updated_at = now()
    where j.status = 'processing'
      and j.locked_at < now() - make_interval(secs => p_lease_ms::double precision / 1000)
    returning j.video_id
  ), changed_videos as (
    update public.videos v
      set media_status = 'queued',
          updated_at = now()
    where v.id in (select e.video_id from expired e)
      and v.status = 'published'
      and v.media_status = 'processing'
    returning v.id
  )
  select count(*)::integer into v_count from expired;
  return coalesce(v_count, 0);
end;
$$;
revoke all on function public.recover_expired_media_processing_jobs(integer) from public, anon, authenticated;
grant execute on function public.recover_expired_media_processing_jobs(integer) to service_role;

comment on function public.claim_media_processing_job(text, integer) is
  'Atomically leases one queued media job, increments its attempt count, and marks the published video as processing. Service role only.';
comment on function public.recover_expired_media_processing_jobs(integer) is
  'Requeues expired worker leases and restores published videos to queued media status. Service role only.';


create or replace function public.complete_media_processing_job(
  p_job_id uuid,
  p_worker_id text,
  p_manifest_path text,
  p_duration_seconds numeric,
  p_thumbnail_path text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_video record;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') not in ('service_role', 'postgres', 'supabase_admin')
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Only the media worker service role can complete processing jobs'
      using errcode = '42501';
  end if;
  if p_worker_id is null or char_length(p_worker_id) < 1 or char_length(p_worker_id) > 160 then
    raise exception 'A valid worker identity is required' using errcode = '22023';
  end if;
  if p_duration_seconds is null or p_duration_seconds <= 0 or p_duration_seconds > 21600 then
    raise exception 'Transcoded duration is outside the allowed range' using errcode = '22023';
  end if;
  if p_job_id is null or p_manifest_path is null or position('..' in p_manifest_path) > 0 then
    raise exception 'A valid job ID and manifest path are required' using errcode = '22023';
  end if;

  select j.id, j.video_id
    into v_job
  from public.media_processing_jobs j
  where j.id = p_job_id
    and j.status = 'processing'
    and j.locked_by = p_worker_id
  for update;
  if not found then
    return false;
  end if;

  select v.id, v.creator_id, v.status, v.media_status
    into v_video
  from public.videos v
  where v.id = v_job.video_id
  for update;
  if not found or v_video.status <> 'published' or v_video.media_status <> 'processing' then
    return false;
  end if;

  if p_manifest_path <> v_video.creator_id::text || '/' || v_video.id::text || '/' || p_job_id::text || '/master.m3u8' then
    raise exception 'Manifest path does not match the owner, video, and active job'
      using errcode = '42501';
  end if;
  if p_thumbnail_path is not null
     and (p_thumbnail_path not like v_video.creator_id::text || '/%'
          or position('..' in p_thumbnail_path) > 0) then
    raise exception 'Generated thumbnail path does not belong to the video owner'
      using errcode = '42501';
  end if;

  update public.videos
    set playback_manifest_path = p_manifest_path,
        media_status = 'ready',
        duration_seconds = p_duration_seconds,
        thumbnail_path = coalesce(p_thumbnail_path, thumbnail_path),
        updated_at = now()
    where id = v_video.id
      and status = 'published'
      and media_status = 'processing';

  if not found then
    return false;
  end if;

  update public.media_processing_jobs
    set status = 'succeeded',
        locked_at = null,
        locked_by = null,
        last_error = '',
        updated_at = now()
    where id = v_job.id
      and status = 'processing'
      and locked_by = p_worker_id;

  if not found then
    raise exception 'The media processing lease was lost during completion'
      using errcode = '40001';
  end if;

  return true;
end;
$$;
revoke all on function public.complete_media_processing_job(uuid, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.complete_media_processing_job(uuid, text, text, numeric, text) to service_role;
comment on function public.complete_media_processing_job(uuid, text, text, numeric, text) is
  'Atomically activates private HLS output and completes only the current worker lease. Service role only.';

commit;
