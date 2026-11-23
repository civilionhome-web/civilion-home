-- =====================================================================
-- Migration 22: super admin for changes made after approval
--  * profiles.is_super marks the super admin (set below for the owner's
--    "Civilion Admin" account). Only a super admin (or this SQL editor) can
--    give or take away super admin.
--  * Admins approve each site's plan and the site-off requests, then the day.
--    The day can be approved only when every site is covered: an approved
--    plan or an approved site-off, and nothing still waiting.
--  * If staff change the plans after the day was approved (edit a plan, add
--    one, delete one, or ask for a site off), the day is locked: the changed
--    plan and the day can then be approved only by the super admin.
-- Run once in Supabase -> SQL Editor, after migration 21. Safe to run again.
-- =====================================================================

-- ---------------------------------------------------------------- roles
alter table public.profiles add column if not exists is_super boolean not null default false;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_super);
$$;
grant execute on function public.is_super_admin() to authenticated;

create or replace function public.profiles_guard_super() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_super is distinct from old.is_super and auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Only the super admin can change who is super admin';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_super on public.profiles;
create trigger profiles_guard_super before update on public.profiles for each row execute function public.profiles_guard_super();

update public.profiles set is_super = true where id = '5fce3880-db4f-4bf7-8805-4acb3742f0b5';

-- ---------------------------------------------------------------- day locks
alter table public.day_plans add column if not exists needs_super boolean not null default false;

create table if not exists public.day_locks (
  plan_date  date primary key,
  site       text not null default '',
  locked_at  timestamptz not null default now()
);
alter table public.day_locks enable row level security;
drop policy if exists "staff read day locks" on public.day_locks;
create policy "staff read day locks" on public.day_locks for select to authenticated using (public.is_staff());
grant select on public.day_locks to authenticated;
revoke all on public.day_locks from anon;

-- Runs after day_plan_guard (triggers fire in name order).
create or replace function public.day_plan_super() returns trigger
language plpgsql security definer set search_path = public as $$
declare was_approved boolean;
begin
  if auth.uid() is null then return new; end if;
  was_approved := exists (select 1 from public.day_approvals where plan_date = new.plan_date)
                  or exists (select 1 from public.day_locks where plan_date = new.plan_date);
  if not public.is_admin() then
    -- staff: a change after the day was approved needs the super admin
    new.needs_super := (tg_op = 'UPDATE' and old.needs_super) or was_approved;
  elsif not public.is_super_admin() then
    if tg_op = 'UPDATE' then
      if old.needs_super and new.status = 'approved' and old.status is distinct from 'approved' then
        raise exception 'This plan was changed after the day was approved. Only the super admin can approve it.';
      end if;
      new.needs_super := old.needs_super;
    else
      new.needs_super := false;
    end if;
  elsif new.status = 'approved' then
    new.needs_super := false;   -- super admin approved the change
  end if;
  return new;
end $$;
drop trigger if exists day_plan_super on public.day_plans;
create trigger day_plan_super before insert or update on public.day_plans for each row execute function public.day_plan_super();

-- Day approval: every site covered, and a locked day only by the super admin.
create or replace function public.day_approval_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date := new.plan_date; waiting int; leaves int; missing text; lock record;
begin
  if auth.uid() is null then return new; end if;
  select * into lock from public.day_locks where plan_date = d;
  if found and not public.is_super_admin() then
    raise exception 'Staff changed this day after it was approved (%). Only the super admin can approve it again.', lock.site;
  end if;
  select count(*) into waiting from public.day_plans dp join public.projects p on p.id = dp.project_id and not p.archived
   where dp.plan_date = d and dp.status <> 'approved'
     and not exists (select 1 from public.site_leaves sl where sl.project_id = dp.project_id and sl.leave_date = d and sl.status = 'approved');
  if waiting > 0 then
    raise exception 'Approve every site first: % plan(s) are not approved yet.', waiting;
  end if;
  select count(*) into leaves from public.site_leaves where leave_date = d and status = 'pending';
  if leaves > 0 then
    raise exception 'Decide every site-off request first: % waiting.', leaves;
  end if;
  select string_agg(p.name, ', ' order by p.name) into missing from public.projects p
   where not p.archived
     and not exists (select 1 from public.day_plans dp where dp.project_id = p.id and dp.plan_date = d)
     and not exists (select 1 from public.site_leaves sl where sl.project_id = p.id and sl.leave_date = d and sl.status = 'approved');
  if missing is not null then
    raise exception 'Every site needs an approved plan or an approved site off. Missing: %', missing;
  end if;
  delete from public.day_locks where plan_date = d;
  return new;
end $$;
drop trigger if exists day_approval_check on public.day_approvals;
create trigger day_approval_check before insert on public.day_approvals for each row execute function public.day_approval_check();

-- Staff change after approval: clear it, lock the day, tell the super admin.
create or replace function public.trg_clear_day_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date; site text; a record; n int; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null or public.is_admin() then return null; end if;
  if tg_table_name = 'day_plans' then d := coalesce(new.plan_date, old.plan_date);
  else d := coalesce(new.leave_date, old.leave_date); end if;
  delete from public.day_approvals where plan_date = d;
  get diagnostics n = row_count;
  if n > 0 then
    select name into site from public.projects where id = coalesce(new.project_id, old.project_id);
    insert into public.day_locks (plan_date, site) values (d, coalesce(site, ''))
      on conflict (plan_date) do update set site = case when public.day_locks.site like '%' || excluded.site || '%' then public.day_locks.site
                                                         else public.day_locks.site || ', ' || excluded.site end;
    for a in select id from public.profiles where role = 'admin' and is_super loop
      perform public.notify_staff(a.id, 'plan_new',
        case when d = today then 'Today''s plan changed: your approval needed (' else 'Plan changed after approval: your approval needed (' end || to_char(d, 'Dy DD Mon') || ')',
        'Changed after approval: ' || coalesce(site, 'a site') || '. Only you (super admin) can approve the change and the day. Staff can''t make the "'
          || case when d = today then 'Today running sites' when d = today + 1 then 'Tomorrow planned sites' else 'day plan' end
          || '" PDF until then.', '/admin/planner?date=' || d);
    end loop;
  end if;
  return null;
end $$;
