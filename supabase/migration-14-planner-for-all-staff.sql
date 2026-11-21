-- =====================================================================
-- Migration 14: day planner open to all staff + same-day changes by admin
--  * Every staff member can now see all sites' plans (clients still can't).
--    Staff still edit only their own plans; admins can edit any plan.
--  * When an admin changes someone else's plan (e.g. that morning), the plan
--    is marked "Changed by admin" with the time, and the staff member who
--    wrote it gets an alert (bell + phone) with the admin's note.
-- Run once in Supabase → SQL Editor, after migration 13. Safe to run again.
-- =====================================================================
alter table public.day_plans add column if not exists changed_at timestamptz;
alter table public.day_plans add column if not exists changed_by uuid references public.profiles(id) on delete set null;

drop policy if exists "admin or author reads day plans" on public.day_plans;
drop policy if exists "staff read day plans" on public.day_plans;
create policy "staff read day plans" on public.day_plans
  for select to authenticated using (public.is_staff());

-- Guard: keep staff rules, and stamp admin changes to other people's plans
create or replace function public.day_plan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.updated_at := now();
  if auth.uid() is null then return new; end if;
  if public.is_admin() then
    if tg_op = 'UPDATE' and old.created_by is distinct from auth.uid()
       and (new.tasks, new.materials, new.equipment, new.remarks, new.supervisor, new.start_time)
           is distinct from (old.tasks, old.materials, old.equipment, old.remarks, old.supervisor, old.start_time) then
      new.changed_at := now();
      new.changed_by := auth.uid();
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.status := 'submitted';
    new.admin_note := '';
    new.changed_at := null; new.changed_by := null;
  else
    if old.plan_date < today then raise exception 'Plans for past days can no longer be changed'; end if;
    new.created_by := old.created_by;
    new.admin_note := old.admin_note;
    new.changed_at := old.changed_at; new.changed_by := old.changed_by;
    new.status := 'submitted';            -- edited again → admin reviews again
  end if;
  if new.plan_date < today then raise exception 'Pick today or a future date for the plan'; end if;
  return new;
end $$;

-- Alert the author when the admin changes their plan
create or replace function public.trg_day_plan_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text;
begin
  if new.changed_at is distinct from old.changed_at and new.changed_at is not null and new.created_by is not null
     and new.created_by is distinct from auth.uid() then
    select name into site from public.projects where id = new.project_id;
    perform public.notify_staff(new.created_by, 'plan_review',
      'Plan changed by admin: ' || site || ' (' || to_char(new.plan_date, 'Dy DD Mon') || ')',
      coalesce(nullif(new.admin_note, ''), 'Open the day planner to see the changes.'),
      '/admin/planner?date=' || new.plan_date);
  end if;
  return null;
end $$;
drop trigger if exists day_plan_changed on public.day_plans;
create trigger day_plan_changed after update on public.day_plans
  for each row execute function public.trg_day_plan_changed();
