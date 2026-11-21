-- =====================================================================
-- Migration 19: evening DPR (daily progress report) + weekly planner
--  DPR — internal, staff only (clients never see it). One per site per
--  staff member per day: planned works with done / partly / not done,
--  labour by trade, materials received / used, machinery, issues.
--   * 7:00 pm IST: staff reminded for today's planned sites without a DPR
--   * 9:00 pm IST: admins get the list of planned sites still without a DPR
--  Weekly plan — one per site per week (week starts Monday). Staff plan the
--  next week every Saturday; the admin approves / asks for changes / edits.
--   * Saturday 5:00 pm IST: staff reminded for sites without next week's plan
--   * Saturday 9:00 pm IST: admins get the list still missing
-- Run once in Supabase → SQL Editor, after migration 18. Safe to run again.
-- =====================================================================

-- ================================================================ DPR
create table if not exists public.dprs (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  report_date         date not null,
  works               jsonb not null default '[]'::jsonb check (jsonb_typeof(works) = 'array'),   -- [{work, status, qty, remarks}]
  labour              jsonb not null default '[]'::jsonb check (jsonb_typeof(labour) = 'array'),  -- [{trade, count}]
  materials_received  text not null default '',
  materials_used      text not null default '',
  machinery           text not null default '',
  issues              text not null default '',
  next_day            text not null default '',
  status              text not null default 'submitted' check (status in ('submitted','reviewed')),
  admin_note          text not null default '',
  created_by          uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists dprs_one_per_person on public.dprs (project_id, report_date, created_by);
create index if not exists dprs_date_idx on public.dprs (report_date);

-- Staff can write today's DPR, and finish yesterday's (late evening / after midnight).
create or replace function public.dpr_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.updated_at := now();
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.report_date > today or new.report_date < today - 1 then raise exception 'A DPR can be written for today (or finished for yesterday)'; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.status := 'submitted'; new.admin_note := '';
  else
    if old.report_date < today - 1 then raise exception 'This DPR can no longer be changed'; end if;
    new.created_by := old.created_by; new.admin_note := old.admin_note; new.status := 'submitted';
  end if;
  return new;
end $$;
drop trigger if exists dpr_guard on public.dprs;
create trigger dpr_guard before insert or update on public.dprs for each row execute function public.dpr_guard();

alter table public.dprs enable row level security;
drop policy if exists "staff read dprs" on public.dprs;
create policy "staff read dprs" on public.dprs for select to authenticated using (public.is_staff());
drop policy if exists "staff add dprs" on public.dprs;
create policy "staff add dprs" on public.dprs for insert to authenticated with check (public.is_staff());
drop policy if exists "admin or author edits dprs" on public.dprs;
create policy "admin or author edits dprs" on public.dprs for update to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes dprs" on public.dprs;
create policy "admin or author deletes dprs" on public.dprs for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid() and report_date >= (now() at time zone 'Asia/Kolkata')::date - 1));
grant select, insert, update, delete on public.dprs to authenticated;
revoke all on public.dprs from anon;

create or replace function public.trg_dpr_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text; who text; a record; total int;
begin
  select name into site from public.projects where id = new.project_id;
  select coalesce(nullif(full_name, ''), email, 'Staff') into who from public.profiles where id = new.created_by;
  if tg_op = 'INSERT' then
    select coalesce(sum(nullif(x->>'count', '')::int), 0) into total from jsonb_array_elements(new.labour) x
     where (x->>'count') ~ '^[0-9]+$';
    for a in select id from public.profiles where role = 'admin' and id is distinct from new.created_by loop
      perform public.notify_staff(a.id, 'plan_new', 'DPR: ' || site || ' (' || to_char(new.report_date, 'Dy DD Mon') || ')',
        who || ' · ' || jsonb_array_length(new.works) || ' work(s) · ' || total || ' workers'
        || case when new.issues <> '' then ' · Issues: ' || left(new.issues, 80) else '' end,
        '/admin/dpr?date=' || new.report_date);
    end loop;
  elsif new.status = 'reviewed' and old.status <> 'reviewed' and new.admin_note <> ''
        and new.created_by is not null and new.created_by is distinct from auth.uid() then
    perform public.notify_staff(new.created_by, 'plan_review', 'DPR reviewed: ' || site, new.admin_note, '/admin/dpr?date=' || new.report_date);
  end if;
  return null;
end $$;
drop trigger if exists dpr_alerts on public.dprs;
create trigger dpr_alerts after insert or update of status on public.dprs for each row execute function public.trg_dpr_alerts();

-- 7 pm: remind staff (sites planned today, not off, without a DPR)
create or replace function public.dpr_staff_reminder() returns int
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date; s record; n int := 0;
begin
  for s in
    with missing as (
      select distinct p.id, p.name, dp.created_by, pr.role
        from public.projects p
        join public.day_plans dp on dp.project_id = p.id and dp.plan_date = d
        left join public.profiles pr on pr.id = dp.created_by
       where not p.archived
         and not exists (select 1 from public.dprs r where r.project_id = p.id and r.report_date = d)
         and not exists (select 1 from public.site_leaves sl where sl.project_id = p.id and sl.leave_date = d and sl.status = 'approved')
    ), targets as (
      select m.name, m.created_by as user_id from missing m where m.role = 'staff'
      union
      select m.name, st.id from missing m cross join public.profiles st
       where st.role = 'staff' and m.role is distinct from 'staff'
         and not exists (select 1 from missing m2 where m2.id = m.id and m2.role = 'staff')
    )
    select user_id, string_agg(name, ', ' order by name) as sites, count(*) as cnt from targets group by user_id
  loop
    perform public.notify_staff(s.user_id, 'plan_reminder',
      'Today''s DPR needed: ' || s.cnt || case when s.cnt = 1 then ' site' else ' sites' end,
      'Please send today''s progress report (DPR) for: ' || s.sites || '.', '/admin/dpr');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.dpr_staff_reminder() from public, anon, authenticated;

-- 9 pm: tell admins which planned sites still have no DPR
create or replace function public.dpr_admin_alert() returns int
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date; list text; cnt int; a record; n int := 0;
begin
  select string_agg(x.line, E'\n' order by x.name), count(*) into list, cnt from (
    select p.name, p.name || ' — planned by ' || coalesce(string_agg(distinct coalesce(nullif(pr.full_name, ''), 'staff'), ', '), 'staff') as line
      from public.projects p
      join public.day_plans dp on dp.project_id = p.id and dp.plan_date = d
      left join public.profiles pr on pr.id = dp.created_by
     where not p.archived
       and not exists (select 1 from public.dprs r where r.project_id = p.id and r.report_date = d)
       and not exists (select 1 from public.site_leaves sl where sl.project_id = p.id and sl.leave_date = d and sl.status = 'approved')
     group by p.id, p.name) x;
  if coalesce(cnt, 0) = 0 then return 0; end if;
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify_staff(a.id, 'plan_summary',
      'DPR missing: ' || cnt || case when cnt = 1 then ' site' else ' sites' end || ' (' || to_char(d, 'Dy DD Mon') || ')',
      'Planned today but no DPR yet:' || E'\n' || list, '/admin/dpr?date=' || d);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.dpr_admin_alert() from public, anon, authenticated;

-- ================================================================ weekly plans
create table if not exists public.weekly_plans (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  week_start  date not null check (extract(isodow from week_start) = 1),   -- Monday
  items       jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),   -- [{work, target, days, team}]
  materials   text not null default '',
  remarks     text not null default '',
  status      text not null default 'submitted' check (status in ('submitted','approved','changes')),
  admin_note  text not null default '',
  changed_at  timestamptz,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists weekly_plans_one_per_person on public.weekly_plans (project_id, week_start, created_by);
create index if not exists weekly_plans_week_idx on public.weekly_plans (week_start);

create or replace function public.weekly_plan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare this_week date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date;
begin
  new.updated_at := now();
  if auth.uid() is null then return new; end if;
  if public.is_admin() then
    if tg_op = 'UPDATE' and old.created_by is distinct from auth.uid()
       and (new.items, new.materials, new.remarks) is distinct from (old.items, old.materials, old.remarks) then
      new.changed_at := now();
    end if;
    return new;
  end if;
  if new.week_start < this_week then raise exception 'Pick this week or a later week'; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.status := 'submitted'; new.admin_note := ''; new.changed_at := null;
  else
    if old.week_start < this_week then raise exception 'Past weeks can no longer be changed'; end if;
    new.created_by := old.created_by; new.admin_note := old.admin_note; new.changed_at := old.changed_at;
    new.status := 'submitted';
  end if;
  return new;
end $$;
drop trigger if exists weekly_plan_guard on public.weekly_plans;
create trigger weekly_plan_guard before insert or update on public.weekly_plans for each row execute function public.weekly_plan_guard();

alter table public.weekly_plans enable row level security;
drop policy if exists "staff read weekly plans" on public.weekly_plans;
create policy "staff read weekly plans" on public.weekly_plans for select to authenticated using (public.is_staff());
drop policy if exists "staff add weekly plans" on public.weekly_plans;
create policy "staff add weekly plans" on public.weekly_plans for insert to authenticated with check (public.is_staff());
drop policy if exists "admin or author edits weekly plans" on public.weekly_plans;
create policy "admin or author edits weekly plans" on public.weekly_plans for update to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes weekly plans" on public.weekly_plans;
create policy "admin or author deletes weekly plans" on public.weekly_plans for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()
         and week_start >= date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date));
grant select, insert, update, delete on public.weekly_plans to authenticated;
revoke all on public.weekly_plans from anon;

create or replace function public.trg_weekly_plan_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text; who text; a record; wk text;
begin
  select name into site from public.projects where id = new.project_id;
  select coalesce(nullif(full_name, ''), email, 'Staff') into who from public.profiles where id = new.created_by;
  wk := 'week of ' || to_char(new.week_start, 'DD Mon');
  if tg_op = 'INSERT' or (old.status <> 'submitted' and new.status = 'submitted') then
    for a in select id from public.profiles where role = 'admin' and id is distinct from new.created_by loop
      perform public.notify_staff(a.id, 'plan_new',
        case when tg_op = 'INSERT' then 'New weekly plan: ' else 'Weekly plan updated: ' end || site,
        who || ' · ' || wk || ' · ' || jsonb_array_length(new.items) || ' work(s)', '/admin/weekly?week=' || new.week_start);
    end loop;
  elsif new.created_by is not null and new.created_by is distinct from auth.uid() then
    if new.status is distinct from old.status and new.status in ('approved','changes') then
      perform public.notify_staff(new.created_by, 'plan_review',
        case when new.status = 'approved' then 'Weekly plan approved: ' else 'Changes asked: weekly plan ' end || site,
        wk || coalesce(' · ' || nullif(new.admin_note, ''), ''), '/admin/weekly?week=' || new.week_start);
    elsif new.changed_at is distinct from old.changed_at and new.changed_at is not null then
      perform public.notify_staff(new.created_by, 'plan_review', 'Weekly plan changed by admin: ' || site,
        wk || coalesce(' · ' || nullif(new.admin_note, ''), ''), '/admin/weekly?week=' || new.week_start);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists weekly_plan_alerts on public.weekly_plans;
create trigger weekly_plan_alerts after insert or update on public.weekly_plans for each row execute function public.trg_weekly_plan_alerts();

-- Saturday 5 pm: remind staff about next week's plan
create or replace function public.weekly_plan_reminder() returns int
language plpgsql security definer set search_path = public as $$
declare nxt date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date + 7; s record; n int := 0;
begin
  for s in
    with missing as (
      select p.id, p.name from public.projects p
       where not p.archived and not exists (select 1 from public.weekly_plans w where w.project_id = p.id and w.week_start = nxt)
    ), recent as (   -- who planned each site in the last 14 days
      select distinct d.project_id, d.created_by as user_id from public.day_plans d
        join public.profiles pr on pr.id = d.created_by and pr.role = 'staff'
       where d.plan_date between nxt - 21 and nxt - 1
    ), targets as (
      select m.name, r.user_id from missing m join recent r on r.project_id = m.id
      union
      select m.name, pr.id from missing m cross join public.profiles pr
       where pr.role = 'staff' and not exists (select 1 from recent r where r.project_id = m.id)
    )
    select user_id, string_agg(name, ', ' order by name) as sites, count(*) as cnt from targets group by user_id
  loop
    perform public.notify_staff(s.user_id, 'plan_reminder',
      'Next week''s plan needed: ' || s.cnt || case when s.cnt = 1 then ' site' else ' sites' end,
      'Please add the weekly plan (week of ' || to_char(nxt, 'DD Mon') || ') for: ' || s.sites || '.', '/admin/weekly?week=' || nxt);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.weekly_plan_reminder() from public, anon, authenticated;

-- Saturday 9 pm: tell admins what's missing / waiting
create or replace function public.weekly_plan_admin_summary() returns int
language plpgsql security definer set search_path = public as $$
declare nxt date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date + 7;
        total int; planned int; waiting int; missing text; a record; n int := 0;
begin
  select count(*) into total from public.projects where not archived;
  select count(distinct w.project_id) into planned from public.weekly_plans w join public.projects p on p.id = w.project_id and not p.archived where w.week_start = nxt;
  select count(*) into waiting from public.weekly_plans where week_start = nxt and status = 'submitted';
  select string_agg(p.name, ', ' order by p.name) into missing from public.projects p
   where not p.archived and not exists (select 1 from public.weekly_plans w where w.project_id = p.id and w.week_start = nxt);
  if total = 0 or (missing is null and waiting = 0) then return 0; end if;
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify_staff(a.id, 'plan_summary', 'Next week''s plans: ' || planned || '/' || total || ' sites',
      planned || ' of ' || total || ' sites planned for the week of ' || to_char(nxt, 'DD Mon') || '.'
      || coalesce(' Missing: ' || missing || '.', '')
      || case when waiting > 0 then ' ' || waiting || ' waiting for your review.' else '' end,
      '/admin/weekly?week=' || nxt);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.weekly_plan_admin_summary() from public, anon, authenticated;

-- ================================================================ schedules (UTC)
do $$ begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('dpr-staff-reminder', 'dpr-admin-alert', 'weekly-plan-reminder', 'weekly-plan-admin-summary');
end $$;
select cron.schedule('dpr-staff-reminder',        '30 13 * * *', 'select public.dpr_staff_reminder()');         -- 7:00 pm IST
select cron.schedule('dpr-admin-alert',           '30 15 * * *', 'select public.dpr_admin_alert()');            -- 9:00 pm IST
select cron.schedule('weekly-plan-reminder',      '30 11 * * 6', 'select public.weekly_plan_reminder()');       -- Sat 5:00 pm IST
select cron.schedule('weekly-plan-admin-summary', '30 15 * * 6', 'select public.weekly_plan_admin_summary()');  -- Sat 9:00 pm IST
