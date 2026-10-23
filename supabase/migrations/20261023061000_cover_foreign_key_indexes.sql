
create index if not exists channel_memberships_member_idx on public.channel_memberships(member_id);
create index if not exists comments_user_idx on public.comments(user_id, created_at desc);
create index if not exists live_streams_creator_idx on public.live_streams(creator_id, created_at desc);
create index if not exists live_streams_replay_video_idx on public.live_streams(replay_video_id) where replay_video_id is not null;
create index if not exists notifications_actor_idx on public.notifications(actor_id, created_at desc) where actor_id is not null;
create index if not exists playlist_items_video_idx on public.playlist_items(video_id);
create index if not exists post_reactions_user_idx on public.post_reactions(user_id, created_at desc);
create index if not exists reports_reporter_idx on public.reports(reporter_id, created_at desc);
create index if not exists stream_messages_user_idx on public.stream_messages(user_id, created_at desc);
create index if not exists video_views_viewer_idx on public.video_views(viewer_id, created_at desc);
