create extension if not exists pg_net with schema extensions;

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique
    check (expo_push_token like 'ExponentPushToken[%]' or expo_push_token like 'ExpoPushToken[%]'),
  platform text not null check (platform in ('ios','android','web')),
  device_name text not null default '' check (char_length(device_name) <= 160),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);
create index if not exists device_push_tokens_user_idx on public.device_push_tokens(user_id,last_seen_at desc);

alter table public.device_push_tokens enable row level security;
drop policy if exists push_tokens_select_self on public.device_push_tokens;
create policy push_tokens_select_self on public.device_push_tokens for select to authenticated
using (user_id=(select auth.uid()));
drop policy if exists push_tokens_insert_self on public.device_push_tokens;
create policy push_tokens_insert_self on public.device_push_tokens for insert to authenticated
with check (user_id=(select auth.uid()));
drop policy if exists push_tokens_update_self on public.device_push_tokens;
create policy push_tokens_update_self on public.device_push_tokens for update to authenticated
using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists push_tokens_delete_self on public.device_push_tokens;
create policy push_tokens_delete_self on public.device_push_tokens for delete to authenticated
using (user_id=(select auth.uid()));
grant select, insert, update, delete on public.device_push_tokens to authenticated;

create or replace function omnitube_private.dispatch_expo_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_row record;
  push_title text;
  push_data jsonb;
begin
  push_title := case new.kind
    when 'follow' then 'Someone followed your channel'
    when 'reaction' then 'Someone reacted to your video'
    when 'comment' then 'New comment on your content'
    when 'repost' then 'Your video was reposted'
    when 'live' then 'A creator you follow is live'
    when 'mention' then 'You were mentioned on OmniTube'
    else 'OmniTube update'
  end;
  push_data := jsonb_build_object(
    'notificationId', new.id,
    'entityType', new.entity_type,
    'entityId', new.entity_id,
    'kind', new.kind
  );

  for token_row in
    select expo_push_token from public.device_push_tokens where user_id=new.recipient_id
  loop
    begin
      perform net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        headers := jsonb_build_object('Content-Type','application/json','Accept','application/json'),
        body := jsonb_build_object(
          'to', token_row.expo_push_token,
          'title', push_title,
          'body', left(new.body, 180),
          'sound', 'default',
          'priority', 'high',
          'channelId', 'omnitube-activity',
          'data', push_data
        ),
        timeout_milliseconds := 2500
      );
    exception when others then
      raise warning 'OmniTube push dispatch failed for notification %', new.id;
    end;
  end loop;
  return new;
end;
$$;
revoke all on function omnitube_private.dispatch_expo_push() from public,anon,authenticated;
drop trigger if exists omnitube_dispatch_expo_push on public.notifications;
create trigger omnitube_dispatch_expo_push
after insert on public.notifications
for each row execute function omnitube_private.dispatch_expo_push();

comment on table public.device_push_tokens is 'Device-owned Expo push tokens for opt-in OmniTube activity alerts; token delivery is asynchronous through Expo Push Service.';
comment on function omnitube_private.dispatch_expo_push() is 'Dispatches a minimal activity notification to each registered Expo token without blocking the database transaction.';