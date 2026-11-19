-- =====================================================================
-- Migration 10: videos in the daily site log
--  Site log media can now be a photo or a video (stored the same way).
-- Run once in Supabase → SQL Editor, after migration 09. Safe to run again.
-- =====================================================================
alter table public.site_log_photos add column if not exists kind text not null default 'image';
do $$ begin
  alter table public.site_log_photos add constraint site_log_photos_kind check (kind in ('image','video'));
exception when duplicate_object then null; end $$;
