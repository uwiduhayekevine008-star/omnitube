create or replace function omnitube_private.notify_live_stream_followers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'live'
     and new.visibility = 'public'
     and (
       tg_op = 'INSERT'
       or (tg_op = 'UPDATE' and old.status is distinct from new.status)
     ) then
    insert into public.notifications(recipient_id, actor_id, kind, entity_type, entity_id, body)
    select f.follower_id, new.creator_id, 'live', 'stream', new.id,
      left('started a live broadcast: ' || new.title, 500)
    from public.follows f
    where f.creator_id = new.creator_id
      and f.follower_id <> new.creator_id;
  end if;
  return new;
end;
$$;
revoke all on function omnitube_private.notify_live_stream_followers() from public, anon, authenticated;
drop trigger if exists omnitube_notify_live_stream_followers on public.live_streams;
create trigger omnitube_notify_live_stream_followers
after insert or update of status on public.live_streams
for each row execute function omnitube_private.notify_live_stream_followers();