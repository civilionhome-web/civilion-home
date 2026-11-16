-- =====================================================================
-- Migration 03: time schedule + hindrance register
--  * Project start date and agreed completion date
--  * Planned start / end date for each stage
--  * Hindrance register: reason, who caused it, from / to dates.
--    Days lost to client-caused hindrances extend the completion date.
-- Run once in Supabase → SQL Editor, after schema.sql.
-- =====================================================================
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists completion_date date;   -- as per agreement

alter table public.stages add column if not exists start_date date;
alter table public.stages add column if not exists end_date date;

create table if not exists public.hindrances (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  from_date   date not null,
  to_date     date,                                   -- empty = still going on
  reason      text not null,
  caused_by   text not null default 'client'
              check (caused_by in ('client','weather','authority','contractor','other')),
  remarks     text not null default '',
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint hindrance_dates check (to_date is null or to_date >= from_date)
);
create index if not exists hindrances_project_idx on public.hindrances (project_id, from_date);

alter table public.hindrances enable row level security;

drop policy if exists "view hindrances" on public.hindrances;
create policy "view hindrances" on public.hindrances
  for select to authenticated using (public.can_view_project(project_id));

drop policy if exists "staff write hindrances" on public.hindrances;
create policy "staff write hindrances" on public.hindrances
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.hindrances to authenticated;
revoke all on public.hindrances from anon;
