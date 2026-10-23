drop policy if exists video_views_delete_self on public.video_views;
create policy video_views_delete_self on public.video_views
for delete to authenticated using (viewer_id = (select auth.uid()));