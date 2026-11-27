-- =====================================================================
-- Migration 27: Project managers (PM)
--  * profiles.is_pm marks a login as a PM (set on the Team page by an admin).
--  * projects.pm_id is the project's PM (chosen when adding or editing a
--    project; only admins can set it).
--  * A PM can do for THEIR projects what the admin does: approve or send back
--    day plans, site-off requests, hindrances, DPRs and weekly plans, and
--    edit those plans. Alerts for their projects go to them as well as admins.
--  * The day approves itself once every site is covered (approved plan or
--    approved site off). A day changed after approval still needs the super
--    admin (migration 22).
-- Run once in Supabase -> SQL Editor, after migration 26. Safe to run again.
-- =====================================================================

alter table public.profiles add column if not exists is_pm boolean not null default false;
alter table public.projects add column if not exists pm_id uuid references public.profiles(id) on delete set null;

create or replace function public.can_approve(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.projects p join public.profiles pr on pr.id = p.pm_id
     where p.id = p_project and pr.id = auth.uid() and pr.is_pm and pr.role in ('staff', 'admin'));
$$;
grant execute on function public.can_approve(uuid) to authenticated;

-- only admins choose PMs
create or replace function public.profiles_guard_pm() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_pm is distinct from old.is_pm and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can choose who is a PM';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_pm on public.profiles;
create trigger profiles_guard_pm before update on public.profiles for each row execute function public.profiles_guard_pm();

create or replace function public.projects_guard_pm() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and new.pm_id is distinct from (case when tg_op = 'UPDATE' then old.pm_id else null end) then
    raise exception 'Only an admin can choose the project manager';
  end if;
  if new.pm_id is not null and not exists (select 1 from public.profiles where id = new.pm_id and is_pm) then
    raise exception 'Pick a PM from the list';
  end if;
  return new;
end $$;
drop trigger if exists projects_guard_pm on public.projects;
create trigger projects_guard_pm before insert or update of pm_id on public.projects for each row execute function public.projects_guard_pm();

-- ---------------------------------------------------------------- PMs approve their own projects
create or replace function public.day_plan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.updated_at := now();
  if auth.uid() is null then return new; end if;
  if public.can_approve(new.project_id) then
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

create or replace function public.day_plan_super() returns trigger
language plpgsql security definer set search_path = public as $$
declare was_approved boolean;
begin
  if auth.uid() is null then return new; end if;
  was_approved := exists (select 1 from public.day_approvals where plan_date = new.plan_date)
                  or exists (select 1 from public.day_locks where plan_date = new.plan_date);
  if not public.can_approve(new.project_id) then
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

create or replace function public.trg_clear_day_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date; site text; a record; n int; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null or public.can_approve(coalesce(new.project_id, old.project_id)) then return null; end if;
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

create or replace function public.site_leave_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.updated_at := now();
  if auth.uid() is null then return new; end if;
  if public.can_approve(new.project_id) then
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

create or replace function public.day_change_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null then return new; end if;
  if public.can_approve(new.project_id) then
    if tg_op = 'INSERT' then
      new.created_by := coalesce(new.created_by, auth.uid());
      new.status := case when new.kind = 'hindrance' then 'approved' else 'recorded' end;   -- admin's own: no approval needed
    end if;
    if new.kind = 'hindrance' then
      if new.status = 'approved' and new.hindrance_id is null then
        new.hindrance_id := public.day_change_register(new);
      elsif tg_op = 'UPDATE' and new.status = 'rejected' and old.hindrance_id is not null then
        delete from public.hindrances where id = old.hindrance_id;
        new.hindrance_id := null;
      end if;
    end if;
    return new;
  end if;
  if new.change_date <> today then raise exception 'Changes can be recorded only for today'; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    if old.change_date <> today then raise exception 'Past days can no longer be changed'; end if;
    new.created_by := old.created_by;
    if old.status = 'approved' then raise exception 'This hindrance is already approved; ask the admin to change it'; end if;
  end if;
  new.status := case when new.kind = 'hindrance' then 'pending' else 'recorded' end;
  new.hindrance_id := null;
  new.admin_note := case when tg_op = 'INSERT' then '' else old.admin_note end;
  return new;
end $$;

create or replace function public.dpr_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.updated_at := now();
  if auth.uid() is null or public.can_approve(new.project_id) then return new; end if;
  if new.report_date > today or new.report_date < today - 1 then raise exception 'A DPR can be written for today (or finished for yesterday)'; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.status := 'submitted'; new.admin_note := '';
  else
    if old.report_date < today - 1 then raise exception 'This DPR can no longer be changed'; end if;
    new.created_by := old.created_by; new.admin_note := old.admin_note; new.status := 'submitted';
  end if;
  return new;
end $$;

create or replace function public.weekly_plan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare this_week date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date;
begin
  new.updated_at := now();
  if auth.uid() is null then return new; end if;
  if public.can_approve(new.project_id) then
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

create or replace function public.trg_day_plan_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text; who text; a record; when_txt text;
begin
  select name into site from public.projects where id = new.project_id;
  select coalesce(nullif(full_name, ''), email, 'Staff') into who from public.profiles where id = new.created_by;
  when_txt := to_char(new.plan_date, 'Dy DD Mon');
  if tg_op = 'INSERT' or (old.status <> 'submitted' and new.status = 'submitted') then
    -- tell admins (except the one who wrote it)
    for a in select id from public.profiles where (role = 'admin' or id = (select pm_id from public.projects where id = new.project_id)) and id is distinct from new.created_by loop
      perform public.notify_staff(a.id, 'plan_new',
        case when tg_op = 'INSERT' then 'New day plan: ' else 'Day plan updated: ' end || site,
        who || ' · ' || when_txt || ' · ' || jsonb_array_length(new.tasks) || ' work(s)', '/admin/planner?date=' || new.plan_date);
    end loop;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.created_by is not null
        and new.created_by is distinct from auth.uid() then
    if new.status = 'approved' then
      perform public.notify_staff(new.created_by, 'plan_review', 'Plan approved: ' || site,
        when_txt || coalesce(' · ' || nullif(new.admin_note, ''), ''), '/admin/planner?date=' || new.plan_date);
    elsif new.status = 'changes' then
      perform public.notify_staff(new.created_by, 'plan_review', 'Changes asked: ' || site,
        when_txt || ' · ' || coalesce(nullif(new.admin_note, ''), 'Open the planner to see what to change.'), '/admin/planner?date=' || new.plan_date);
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.trg_site_leave_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text; who text; a record; d text;
begin
  select name into site from public.projects where id = new.project_id;
  select coalesce(nullif(full_name, ''), email, 'Staff') into who from public.profiles where id = new.created_by;
  d := to_char(new.leave_date, 'Dy DD Mon');
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending' or old.reason <> new.reason) then
    for a in select id from public.profiles where (role = 'admin' or id = (select pm_id from public.projects where id = new.project_id)) and id is distinct from new.created_by loop
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

create or replace function public.trg_day_change_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text; other text; who text; msg text; title text; a record;
begin
  select name into site from public.projects where id = new.project_id;
  select name into other from public.projects where id = new.to_project_id;
  select coalesce(nullif(full_name, ''), email, 'Staff') into who from public.profiles where id = new.created_by;
  msg := case new.kind
    when 'hindrance' then coalesce(nullif(new.reason, ''), 'Hindrance')
         || case when new.at_time <> '' then ' · from ' || new.at_time else '' end
         || case when new.until_time <> '' then ' till ' || new.until_time else '' end
    when 'labour' then coalesce(new.workers::text || ' ', '') || coalesce(nullif(new.item, ''), 'workers') || ' → ' || other
    when 'team' then coalesce(nullif(new.item, ''), 'Team') || coalesce(' (' || new.workers || ')', '') || ' → ' || other
    when 'machinery' then coalesce(nullif(new.item, ''), 'Machinery') || ' → ' || other
    else coalesce(nullif(new.item, ''), 'Team') || ': half day here, rest at ' || other end
    || case when new.kind <> 'hindrance' and new.at_time <> '' then ' at ' || new.at_time else '' end
    || case when new.kind <> 'hindrance' and new.reason <> '' then ' · ' || new.reason else '' end;
  if tg_op = 'INSERT' then
    title := case when new.kind = 'hindrance' then 'Hindrance at ' || site else 'Shift from ' || site end;
    for a in select id from public.profiles where (role = 'admin' or id = (select pm_id from public.projects where id = new.project_id)) and id is distinct from new.created_by loop
      perform public.notify_staff(a.id, 'plan_new', title, who || ' · ' || msg, '/admin/planner?date=' || new.change_date);
    end loop;
    -- staff who planned the other site that day
    if new.to_project_id is not null then
      for a in select distinct created_by as id from public.day_plans
                where project_id = new.to_project_id and plan_date = new.change_date
                  and created_by is not null and created_by is distinct from new.created_by loop
        perform public.notify_staff(a.id, 'plan_review', 'Coming to ' || other || ' from ' || site, msg, '/admin/planner?date=' || new.change_date);
      end loop;
    end if;
  elsif new.kind = 'hindrance' and new.status is distinct from old.status and new.status in ('approved','rejected')
        and new.created_by is not null and new.created_by is distinct from auth.uid() then
    perform public.notify_staff(new.created_by, 'plan_review',
      case when new.status = 'approved' then 'Hindrance approved: ' else 'Hindrance rejected: ' end || site,
      coalesce(nullif(new.admin_note, ''), msg) || case when new.status = 'approved' then ' · added to the hindrance register' else '' end,
      '/admin/planner?date=' || new.change_date);
  end if;
  return null;
end $$;

create or replace function public.trg_weekly_plan_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text; who text; a record; wk text;
begin
  select name into site from public.projects where id = new.project_id;
  select coalesce(nullif(full_name, ''), email, 'Staff') into who from public.profiles where id = new.created_by;
  wk := 'week of ' || to_char(new.week_start, 'DD Mon');
  if tg_op = 'INSERT' or (old.status <> 'submitted' and new.status = 'submitted') then
    for a in select id from public.profiles where (role = 'admin' or id = (select pm_id from public.projects where id = new.project_id)) and id is distinct from new.created_by loop
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

-- update / delete rules: the project's PM as well as admins
drop policy if exists "admin or author edits day plans" on public.day_plans;
create policy "admin or author edits day plans" on public.day_plans
  for update to authenticated using (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid()))
  with check (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes day plans" on public.day_plans;
create policy "admin or author deletes day plans" on public.day_plans
  for delete to authenticated using (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid() and plan_date >= (now() at time zone 'Asia/Kolkata')::date));
drop policy if exists "admin or author edits site leaves" on public.site_leaves;
create policy "admin or author edits site leaves" on public.site_leaves for update to authenticated
  using (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid()))
  with check (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes site leaves" on public.site_leaves;
create policy "admin or author deletes site leaves" on public.site_leaves for delete to authenticated
  using (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid() and status <> 'approved'));
drop policy if exists "admin or author edits day changes" on public.day_changes;
create policy "admin or author edits day changes" on public.day_changes for update to authenticated
  using (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid()))
  with check (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes day changes" on public.day_changes;
create policy "admin or author deletes day changes" on public.day_changes for delete to authenticated
  using (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid() and status <> 'approved'
                               and change_date = (now() at time zone 'Asia/Kolkata')::date));
drop policy if exists "admin or author edits dprs" on public.dprs;
create policy "admin or author edits dprs" on public.dprs for update to authenticated
  using (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid()))
  with check (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes dprs" on public.dprs;
create policy "admin or author deletes dprs" on public.dprs for delete to authenticated
  using (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid() and report_date >= (now() at time zone 'Asia/Kolkata')::date - 1));
drop policy if exists "admin or author edits weekly plans" on public.weekly_plans;
create policy "admin or author edits weekly plans" on public.weekly_plans for update to authenticated
  using (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid()))
  with check (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes weekly plans" on public.weekly_plans;
create policy "admin or author deletes weekly plans" on public.weekly_plans for delete to authenticated
  using (public.can_approve(project_id) or (public.is_staff() and created_by = auth.uid()
         and week_start >= date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date));

-- ---------------------------------------------------------------- the day approves itself
create or replace function public.auto_approve_day(d date) returns void
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if d is null or d < today then return; end if;
  if exists (select 1 from public.day_approvals where plan_date = d) then return; end if;
  if exists (select 1 from public.day_locks where plan_date = d) and not public.is_super_admin() then return; end if;
  if exists (select 1 from public.day_plans dp join public.projects p on p.id = dp.project_id and not p.archived
              where dp.plan_date = d and dp.status <> 'approved'
                and not exists (select 1 from public.site_leaves sl where sl.project_id = dp.project_id and sl.leave_date = d and sl.status = 'approved')) then return; end if;
  if exists (select 1 from public.site_leaves where leave_date = d and status = 'pending') then return; end if;
  if exists (select 1 from public.projects p where not p.archived
              and not exists (select 1 from public.day_plans dp where dp.project_id = p.id and dp.plan_date = d)
              and not exists (select 1 from public.site_leaves sl where sl.project_id = p.id and sl.leave_date = d and sl.status = 'approved')) then return; end if;
  begin
    insert into public.day_approvals (plan_date) values (d);
  exception when others then null;
  end;
end $$;
revoke all on function public.auto_approve_day(date) from public, anon, authenticated;

create or replace function public.trg_auto_approve_day() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  if tg_table_name = 'day_plans' then perform public.auto_approve_day(coalesce(new.plan_date, old.plan_date));
  else perform public.auto_approve_day(coalesce(new.leave_date, old.leave_date)); end if;
  return null;
end $$;
drop trigger if exists zz_auto_approve_day on public.day_plans;
create trigger zz_auto_approve_day after insert or update or delete on public.day_plans for each row execute function public.trg_auto_approve_day();
drop trigger if exists zz_auto_approve_day on public.site_leaves;
create trigger zz_auto_approve_day after insert or update or delete on public.site_leaves for each row execute function public.trg_auto_approve_day();
