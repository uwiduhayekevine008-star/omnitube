create or replace function omnitube_private.enforce_video_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_role text;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
  if (tg_op = 'INSERT' and new.status = 'published')
     or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    if v_role not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception 'Video publication state can only be changed by the trusted publishing service'
        using errcode = '42501';
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