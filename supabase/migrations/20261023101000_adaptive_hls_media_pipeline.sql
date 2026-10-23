begin;

alter table public.videos
  add column if not exists playback_manifest_path text,
  add column if not exists media_status text not null default 'pending';

alter table public.videos
  drop constraint if exists videos_media_status_check;
alter table public.videos
  add constraint videos_media_status_check
  check (media_status in ('pending','queued','processing','ready','failed'));

create index if not exists videos_media_status_idx
  on public.videos(media_status, created_at desc)
  where status = 'published';

create table if not exists public.media_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references public.videos(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','processing','succeeded','failed')),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text not null default '' check (char_length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_processing_jobs_claim_idx
  on public.media_processing_jobs(status, available_at, created_at)
  where status in ('pending','processing');

alter table public.media_processing_jobs enable row level security;
revoke all on table public.media_processing_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.media_processing_jobs to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'omnitube-renditions',
  'omnitube-renditions',
  false,
  52428800,
  array['application/vnd.apple.mpegurl','application/x-mpegURL','video/mp2t']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Every successful publish queues an idempotent, server-owned transcode job.
create or replace function omnitube_private.enqueue_video_media_processing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.media_processing_jobs(video_id, status, attempts, available_at, locked_at, locked_by, last_error, updated_at)
    values(new.id, 'pending', 0, now(), null, null, '', now())
    on conflict (video_id) do update
      set status = 'pending',
          attempts = 0,
          available_at = now(),
          locked_at = null,
          locked_by = null,
          last_error = '',
          updated_at = now();

    update public.videos
      set media_status = 'queued',
          playback_manifest_path = null
      where id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function omnitube_private.enqueue_video_media_processing() from public, anon, authenticated;
drop trigger if exists omnitube_enqueue_video_media_processing on public.videos;
create trigger omnitube_enqueue_video_media_processing
after insert or update of status on public.videos
for each row execute function omnitube_private.enqueue_video_media_processing();

-- Backfill published rows created before the pipeline was deployed.
insert into public.media_processing_jobs(video_id, status, available_at)
select id, 'pending', now()
from public.videos
where status = 'published'
on conflict (video_id) do nothing;

update public.videos
set media_status = 'queued'
where status = 'published' and media_status = 'pending';

comment on column public.videos.media_status is
  'Server-reported source processing state. Public clients cannot write this column.';
comment on column public.videos.playback_manifest_path is
  'Private-storage master HLS manifest path; media is served by the owner/visibility-checking playback proxy.';
comment on table public.media_processing_jobs is
  'Service-role-only durable queue for FFmpeg adaptive HLS transcoding. Configure and run services/media-worker to consume jobs.';

commit;
