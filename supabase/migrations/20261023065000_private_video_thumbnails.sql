insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('omnitube-thumbnails','omnitube-thumbnails',false,15728640,array['image/jpeg','image/png','image/webp','image/avif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists omnitube_thumbnails_read_visible on storage.objects;
create policy omnitube_thumbnails_read_visible on storage.objects
for select to anon,authenticated using (
  bucket_id='omnitube-thumbnails' and exists (
    select 1 from public.videos v where v.thumbnail_path=name
    and ((v.status='published' and v.visibility in ('public','unlisted')) or v.creator_id=(select auth.uid()))
  )
);

drop policy if exists omnitube_thumbnails_insert_owner_folder on storage.objects;
create policy omnitube_thumbnails_insert_owner_folder on storage.objects
for insert to authenticated with check (
  bucket_id='omnitube-thumbnails' and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists omnitube_thumbnails_update_owner_folder on storage.objects;
create policy omnitube_thumbnails_update_owner_folder on storage.objects
for update to authenticated using (
  bucket_id='omnitube-thumbnails' and (storage.foldername(name))[1]=(select auth.uid())::text
) with check (
  bucket_id='omnitube-thumbnails' and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists omnitube_thumbnails_delete_owner_folder on storage.objects;
create policy omnitube_thumbnails_delete_owner_folder on storage.objects
for delete to authenticated using (
  bucket_id='omnitube-thumbnails' and (storage.foldername(name))[1]=(select auth.uid())::text
);