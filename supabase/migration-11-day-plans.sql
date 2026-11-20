-- =====================================================================
-- Migration 11: day planner (tomorrow's work plan for every site)
--  Staff fill in the next day's plan for each site every evening:
--  works with team and number of workers, materials, machinery, remarks.
--  Only admins see all plans. Staff see only the plans they wrote.
--  Clients never see them.
-- Run once in Supabase → SQL Editor, after schema.sql. Safe to run again.
-- =====================================================================
create table if not exists public.day_plans (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  plan_date   date not null,
  supervisor  text not null default '',          -- site in-charge for the day
  start_time  text not null default '',          -- e.g. 08:00
  tasks       jsonb not null default '[]'::jsonb  -- [{work, team, workers}]
              check (jsonb_typeof(tasks) = 'array'),
  materials   text not null default '',          -- materials to deliver / keep ready
  equipment   text not null default '',          -- machinery, tools, vehicles
  remarks     text not null default '',
  status      text not null default 'submitted' check (status in ('submitted','approved','changes')),
  admin_note  text not null default '',
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists day_plans_one_per_person
  on public.day_plans (project_id, plan_date, created_by);
create index if not exists day_plans_date_idx on public.day_plans (plan_date);

-- Staff can't approve their own plans, and can't change plans for past days.
create or replace function public.day_plan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.updated_at := now();
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.status := 'submitted';
    new.admin_note := '';
  else
    if old.plan_date < today then raise exception 'Plans for past days can no longer be changed'; end if;
    new.created_by := old.created_by;
    new.admin_note := old.admin_note;
    new.status := 'submitted';            -- edited again → admin reviews again
  end if;
  if new.plan_date < today then raise exception 'Pick today or a future date for the plan'; end if;
  return new;
end $$;
drop trigger if exists day_plan_guard on public.day_plans;
create trigger day_plan_guard before insert or update on public.day_plans
  for each row execute function public.day_plan_guard();

alter table public.day_plans enable row level security;
drop policy if exists "admin or author reads day plans" on public.day_plans;
create policy "admin or author reads day plans" on public.day_plans
  for select to authenticated using (public.is_admin() or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "staff add day plans" on public.day_plans;
create policy "staff add day plans" on public.day_plans
  for insert to authenticated with check (public.is_staff());
drop policy if exists "admin or author edits day plans" on public.day_plans;
create policy "admin or author edits day plans" on public.day_plans
  for update to authenticated using (public.is_admin() or (public.is_staff() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes day plans" on public.day_plans;
create policy "admin or author deletes day plans" on public.day_plans
  for delete to authenticated using (public.is_admin() or (public.is_staff() and created_by = auth.uid() and plan_date >= (now() at time zone 'Asia/Kolkata')::date));

grant select, insert, update, delete on public.day_plans to authenticated;
revoke all on public.day_plans from anon;
