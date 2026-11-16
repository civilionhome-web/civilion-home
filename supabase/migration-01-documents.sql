-- =====================================================================
-- Migration 01: project documents (agreement, drawings, permits, BOQ…)
-- Run once in Supabase → SQL Editor, after schema.sql.
-- =====================================================================
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  title        text not null,
  category     text not null default 'Other',
  path         text not null,              -- storage path in bucket project-files
  file_name    text not null default '',
  size_bytes   bigint not null default 0,
  mime         text not null default '',
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists documents_project_idx on public.documents (project_id, created_at desc);

alter table public.documents enable row level security;

drop policy if exists "view documents" on public.documents;
create policy "view documents" on public.documents
  for select to authenticated using (public.can_view_project(project_id));

drop policy if exists "staff write documents" on public.documents;
create policy "staff write documents" on public.documents
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.documents to authenticated;
revoke all on public.documents from anon;
