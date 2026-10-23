
drop policy if exists playlist_items_manage_owner on public.playlist_items;
drop policy if exists playlist_items_insert_owner on public.playlist_items;
drop policy if exists playlist_items_update_owner on public.playlist_items;
drop policy if exists playlist_items_delete_owner on public.playlist_items;

create policy playlist_items_insert_owner on public.playlist_items
for insert to authenticated with check (
  exists (select 1 from public.playlists p where p.id=playlist_id and p.owner_id=(select auth.uid()))
);

create policy playlist_items_update_owner on public.playlist_items
for update to authenticated using (
  exists (select 1 from public.playlists p where p.id=playlist_id and p.owner_id=(select auth.uid()))
) with check (
  exists (select 1 from public.playlists p where p.id=playlist_id and p.owner_id=(select auth.uid()))
);

create policy playlist_items_delete_owner on public.playlist_items
for delete to authenticated using (
  exists (select 1 from public.playlists p where p.id=playlist_id and p.owner_id=(select auth.uid()))
);
