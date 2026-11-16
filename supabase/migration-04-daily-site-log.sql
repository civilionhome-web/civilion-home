-- =====================================================================
-- Migration 04: daily site log with photos
--  One entry per day (or more): weather, workers on site, work done,
--  materials received, remarks, and any number of photos.
-- Run once in Supabase → SQL Editor, after schema.sql. Safe to run again.
-- =====================================================================
create table if not exists public.site_logs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  log_date    date not null default ((now() at time zone 'Asia/Kolkata')::date),
  weather     text not null default '',
  workers     int check (workers is null or workers >= 0),
  work_done   text not null,
  materials   text not null default '',
  remarks     text not null default '',
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists site_logs_project_idx on public.site_logs (project_id, log_date desc);

create table if not exists public.site_log_photos (
  id          uuid primary key default gen_random_uuid(),
  log_id      uuid not null references public.site_logs(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  path        text not null,              -- storage path in bucket project-files
  caption     text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists site_log_photos_idx on public.site_log_photos (project_id, created_at desc);

alter table public.site_logs enable row level security;
alter table public.site_log_photos enable row level security;

drop policy if exists "view site logs" on public.site_logs;
create policy "view site logs" on public.site_logs
  for select to authenticated using (public.can_view_project(project_id));
drop policy if exists "staff write site logs" on public.site_logs;
create policy "staff write site logs" on public.site_logs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "view site log photos" on public.site_log_photos;
create policy "view site log photos" on public.site_log_photos
  for select to authenticated using (public.can_view_project(project_id));
drop policy if exists "staff write site log photos" on public.site_log_photos;
create policy "staff write site log photos" on public.site_log_photos
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.site_logs, public.site_log_photos to authenticated;
revoke all on public.site_logs, public.site_log_photos from anon;
