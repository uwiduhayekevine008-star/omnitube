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

commit;
