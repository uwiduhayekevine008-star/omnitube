create or replace function omnitube_private.notify_follow()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.follower_id <> new.creator_id then
    insert into public.notifications(recipient_id,actor_id,kind,entity_type,entity_id,body)
    values(new.creator_id,new.follower_id,'follow','profile',new.follower_id,'started following your channel');
  end if;
  return new;
end;
$$;

create or replace function omnitube_private.notify_video_reaction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_creator uuid;
begin
  select creator_id into v_creator from public.videos where id=new.video_id;
  if v_creator is not null and v_creator <> new.user_id then
    insert into public.notifications(recipient_id,actor_id,kind,entity_type,entity_id,body)
    values(v_creator,new.user_id,'reaction','video',new.video_id,'reacted to your video');
  end if;
  return new;
end;
$$;

create or replace function omnitube_private.notify_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_creator uuid; v_entity uuid; v_type text;
begin
  if new.video_id is not null then
    select creator_id into v_creator from public.videos where id=new.video_id;
    v_entity:=new.video_id; v_type:='video';
  else
    select creator_id into v_creator from public.posts where id=new.post_id;
    v_entity:=new.post_id; v_type:='post';
  end if;
  if v_creator is not null and v_creator <> new.user_id then
    insert into public.notifications(recipient_id,actor_id,kind,entity_type,entity_id,body)
    values(v_creator,new.user_id,'comment',v_type,v_entity,'commented on your content');
  end if;
  return new;
end;
$$;

create or replace function omnitube_private.notify_repost()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_creator uuid;
begin
  select creator_id into v_creator from public.videos where id=new.video_id;
  if v_creator is not null and v_creator <> new.user_id then
    insert into public.notifications(recipient_id,actor_id,kind,entity_type,entity_id,body)
    values(v_creator,new.user_id,'repost','video',new.video_id,'reposted your video');
  end if;
  return new;
end;
$$;

revoke all on function omnitube_private.notify_follow() from public,anon,authenticated;
revoke all on function omnitube_private.notify_video_reaction() from public,anon,authenticated;
revoke all on function omnitube_private.notify_comment() from public,anon,authenticated;
revoke all on function omnitube_private.notify_repost() from public,anon,authenticated;

drop trigger if exists omnitube_notify_follow on public.follows;
create trigger omnitube_notify_follow after insert on public.follows for each row execute function omnitube_private.notify_follow();
drop trigger if exists omnitube_notify_video_reaction on public.video_reactions;
create trigger omnitube_notify_video_reaction after insert on public.video_reactions for each row execute function omnitube_private.notify_video_reaction();
drop trigger if exists omnitube_notify_comment on public.comments;
create trigger omnitube_notify_comment after insert on public.comments for each row execute function omnitube_private.notify_comment();
drop trigger if exists omnitube_notify_repost on public.reposts;
create trigger omnitube_notify_repost after insert on public.reposts for each row execute function omnitube_private.notify_repost();