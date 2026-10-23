drop policy if exists video_reactions_read_all on public.video_reactions;
create policy video_reactions_read_all on public.video_reactions for select to anon, authenticated using (
  exists (select 1 from public.videos v where v.id = video_id and
    ((v.status='published' and v.visibility in ('public','unlisted')) or v.creator_id=(select auth.uid())))
);
drop policy if exists video_reactions_insert_self on public.video_reactions;
create policy video_reactions_insert_self on public.video_reactions for insert to authenticated with check (
  user_id=(select auth.uid()) and exists (select 1 from public.videos v where v.id=video_id
    and v.status='published' and v.visibility in ('public','unlisted'))
);
drop policy if exists post_reactions_read_all on public.post_reactions;
create policy post_reactions_read_all on public.post_reactions for select to anon, authenticated using (
  exists (select 1 from public.posts p where p.id=post_id and (p.visibility='public' or p.creator_id=(select auth.uid())))
);
drop policy if exists reposts_read_all on public.reposts;
create policy reposts_read_all on public.reposts for select to anon, authenticated using (
  exists (select 1 from public.videos v where v.id=video_id and
    ((v.status='published' and v.visibility in ('public','unlisted')) or v.creator_id=(select auth.uid())))
);
drop policy if exists playlist_items_read_visible on public.playlist_items;
create policy playlist_items_read_visible on public.playlist_items for select to anon, authenticated using (
  exists (select 1 from public.playlists p where p.id=playlist_id and (p.owner_id=(select auth.uid()) or p.visibility in ('public','unlisted')))
  and exists (select 1 from public.videos v where v.id=video_id and
    ((v.status='published' and v.visibility in ('public','unlisted')) or v.creator_id=(select auth.uid())))
);