-- =====================================================================
-- Migration 15: site leave (no work that day) + admin approval of the whole day
--  * Staff can mark a site as "off" for a day with a reason (rain, material not
--    arrived, client function ...). The admin approves or rejects it.
--  * The admin approves the whole day's plan with one button. Only after that
--    can staff make the PDF / print of that day's working sites.
--  * If staff change a plan or a leave for that day afterwards, the day's
--    approval is cleared and the admin is told, so it gets checked again.
-- Run once in Supabase → SQL Editor, after migration 14. Safe to run again.
-- =====================================================================
create table if not exists public.site_leaves (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  leave_date  date not null,
  reason      text not null check (length(trim(reason)) > 0),
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note  text not null default '',
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists site_leaves_one_per_day on public.site_leaves (project_id, leave_date);
create index if not exists site_leaves_date_idx on public.site_leaves (leave_date);

create table if not exists public.day_approvals (
  plan_date    date primary key,
  approved_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  approved_at  timestamptz not null default now()
);

-- Staff rules for leaves: always start as 'pending', can't decide their own,
-- can't change past days; an edit after a decision goes back to 'pending'.
create or replace function public.site_leave_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.updated_at := now();
  if auth.uid() is null then return new; end if;
  if public.is_admin() then
    if tg_op = 'INSERT' then
      new.created_by := coalesce(new.created_by, auth.uid());
      if new.created_by = auth.uid() and new.status = 'pending' then new.status := 'approved'; end if;  -- admin's own: approved
    end if;
    if new.status <> 'pending' and (tg_op = 'INSERT' or new.status is distinct from old.status) then
      new.decided_by := auth.uid(); new.decided_at := now();
    end if;
    return new;
  end if;
  if new.leave_date < today then raise exception 'Pick today or a future date'; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    if old.leave_date < today then raise exception 'Past days can no longer be changed'; end if;
    new.created_by := old.created_by;
  end if;
  new.status := 'pending'; new.admin_note := case when tg_op = 'INSERT' then '' else old.admin_note end;
  new.decided_by := null; new.decided_at := null;
  return new;
end $$;
drop trigger if exists site_leave_guard on public.site_leaves;
create trigger site_leave_guard before insert or update on public.site_leaves
  for each row execute function public.site_leave_guard();

alter table public.site_leaves enable row level security;
drop policy if exists "staff read site leaves" on public.site_leaves;
create policy "staff read site leaves" on public.site_leaves for select to authenticated using (public.is_staff());
drop policy if exists "staff add site leaves" on public.site_leaves;
create policy "staff add site leaves" on public.site_leaves for insert to authenticated with check (public.is_staff());
drop policy if exists "admin or author edits site leaves" on public.site_leaves;
create policy "admin or author edits site leaves" on public.site_leaves for update to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes site leaves" on public.site_leaves;
create policy "admin or author deletes site leaves" on public.site_leaves for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid() and status <> 'approved'));
grant select, insert, update, delete on public.site_leaves to authenticated;
revoke all on public.site_leaves from anon;

alter table public.day_approvals enable row level security;
drop policy if exists "staff read day approvals" on public.day_approvals;
create policy "staff read day approvals" on public.day_approvals for select to authenticated using (public.is_staff());
drop policy if exists "admin approves days" on public.day_approvals;
create policy "admin approves days" on public.day_approvals for insert to authenticated with check (public.is_admin());
drop policy if exists "admin removes day approvals" on public.day_approvals;
create policy "admin removes day approvals" on public.day_approvals for delete to authenticated using (public.is_admin());
grant select, insert, delete on public.day_approvals to authenticated;
revoke all on public.day_approvals from anon;

-- ---------------------------------------------------------------- alerts
create or replace function public.trg_site_leave_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text; who text; a record; d text;
begin
  select name into site from public.projects where id = new.project_id;
  select coalesce(nullif(full_name, ''), email, 'Staff') into who from public.profiles where id = new.created_by;
  d := to_char(new.leave_date, 'Dy DD Mon');
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending' or old.reason <> new.reason) then
    for a in select id from public.profiles where role = 'admin' and id is distinct from new.created_by loop
      perform public.notify_staff(a.id, 'plan_new', 'Site off requested: ' || site || ' (' || d || ')',
        who || ' · ' || new.reason, '/admin/planner?date=' || new.leave_date);
    end loop;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved','rejected')
        and new.created_by is not null and new.created_by is distinct from auth.uid() then
    perform public.notify_staff(new.created_by, 'plan_review',
      case when new.status = 'approved' then 'Site off approved: ' else 'Site off rejected: ' end || site || ' (' || d || ')',
      coalesce(nullif(new.admin_note, ''), new.reason), '/admin/planner?date=' || new.leave_date);
  end if;
  return null;
end $$;
drop trigger if exists site_leave_alerts on public.site_leaves;
create trigger site_leave_alerts after insert or update on public.site_leaves
  for each row execute function public.trg_site_leave_alerts();

-- Day approved → tell all staff the PDF is ready
create or replace function public.trg_day_approved() returns trigger
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  for s in select id from public.profiles where role = 'staff' loop
    perform public.notify_staff(s.id, 'plan_review', 'Day plan approved: ' || to_char(new.plan_date, 'Dy DD Mon'),
      'You can now make the PDF of the working sites.', '/admin/planner?date=' || new.plan_date);
  end loop;
  return null;
end $$;
drop trigger if exists day_approved on public.day_approvals;
create trigger day_approved after insert on public.day_approvals
  for each row execute function public.trg_day_approved();

-- Staff change after approval → clear the day's approval and tell admins
create or replace function public.trg_clear_day_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date; site text; a record; n int;
begin
  if auth.uid() is null or public.is_admin() then return null; end if;
  if tg_table_name = 'day_plans' then d := coalesce(new.plan_date, old.plan_date);
  else d := coalesce(new.leave_date, old.leave_date); end if;
  delete from public.day_approvals where plan_date = d;
  get diagnostics n = row_count;
  if n > 0 then
    select name into site from public.projects where id = coalesce(new.project_id, old.project_id);
    for a in select id from public.profiles where role = 'admin' loop
      perform public.notify_staff(a.id, 'plan_new', 'Day plan needs approval again: ' || to_char(d, 'Dy DD Mon'),
        'Changed after approval: ' || site || '. Staff can''t make the PDF until you approve again.', '/admin/planner?date=' || d);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists day_plans_clear_approval on public.day_plans;
create trigger day_plans_clear_approval after insert or update or delete on public.day_plans
  for each row execute function public.trg_clear_day_approval();
drop trigger if exists site_leaves_clear_approval on public.site_leaves;
create trigger site_leaves_clear_approval after insert or update or delete on public.site_leaves
  for each row execute function public.trg_clear_day_approval();

-- ---------------------------------------------------------------- reminders skip sites marked off
create or replace function public.day_plan_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare tmr date := (now() at time zone 'Asia/Kolkata')::date + 1; s record; n int := 0;
begin
  for s in
    with missing as (
      select p.id, p.name from public.projects p
       where not p.archived
         and not exists (select 1 from public.day_plans d where d.project_id = p.id and d.plan_date = tmr)
         and not exists (select 1 from public.site_leaves l where l.project_id = p.id and l.leave_date = tmr and l.status <> 'rejected')
    ), recent as (
      select distinct d.project_id, d.created_by as user_id from public.day_plans d
        join public.profiles pr on pr.id = d.created_by and pr.role in ('staff','admin')
       where d.plan_date between tmr - 14 and tmr - 1
    ), targets as (
      select m.name, r.user_id from missing m join recent r on r.project_id = m.id
      union
      select m.name, pr.id from missing m cross join public.profiles pr
       where pr.role = 'staff' and not exists (select 1 from recent r where r.project_id = m.id)
    )
    select user_id, string_agg(name, ', ' order by name) as sites, count(*) as cnt from targets group by user_id
  loop
    perform public.notify_staff(s.user_id, 'plan_reminder',
      'Tomorrow''s plan needed for ' || s.cnt || case when s.cnt = 1 then ' site' else ' sites' end,
      'Please add tomorrow''s work plan for: ' || s.sites || '. If a site has no work, mark it as off with the reason.', '/admin/planner');
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.day_plan_admin_summary() returns int
language plpgsql security definer set search_path = public as $$
declare tmr date := (now() at time zone 'Asia/Kolkata')::date + 1;
        total int; planned int; off int; waiting int; leaves int; missing text; a record; n int := 0; msg text;
begin
  select count(*) into total from public.projects where not archived;
  select count(distinct l.project_id) into off from public.site_leaves l
    join public.projects p on p.id = l.project_id and not p.archived where l.leave_date = tmr and l.status = 'approved';
  select count(distinct d.project_id) into planned from public.day_plans d
    join public.projects p on p.id = d.project_id and not p.archived where d.plan_date = tmr;
  select count(*) into waiting from public.day_plans where plan_date = tmr and status = 'submitted';
  select count(*) into leaves from public.site_leaves where leave_date = tmr and status = 'pending';
  select string_agg(p.name, ', ' order by p.name) into missing from public.projects p
   where not p.archived and not exists (select 1 from public.day_plans d where d.project_id = p.id and d.plan_date = tmr)
     and not exists (select 1 from public.site_leaves l where l.project_id = p.id and l.leave_date = tmr and l.status <> 'rejected');
  if total = 0 then return 0; end if;
  if missing is null and waiting = 0 and leaves = 0 and exists (select 1 from public.day_approvals where plan_date = tmr) then return 0; end if;
  msg := planned || ' of ' || (total - off) || ' working sites planned'
      || case when off > 0 then ' (' || off || ' off)' else '' end || '.'
      || coalesce(' Still missing: ' || missing || '.', '')
      || case when waiting > 0 then ' ' || waiting || ' plan(s) to review.' else '' end
      || case when leaves > 0 then ' ' || leaves || ' site-off request(s) waiting.' else '' end
      || case when not exists (select 1 from public.day_approvals where plan_date = tmr) then ' Approve the day so staff can make the PDF.' else '' end;
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify_staff(a.id, 'plan_summary', 'Tomorrow''s day plan: ' || planned || '/' || (total - off) || ' sites', msg, '/admin/planner');
    n := n + 1;
  end loop;
  return n;
end;
$$;
