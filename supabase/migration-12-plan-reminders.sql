-- =====================================================================
-- Migration 12: automatic day-plan reminders for staff and admins
--  * 6:00 pm IST: staff are reminded about sites with no plan for tomorrow.
--    A site's reminder goes to the staff who planned it in the last 14 days;
--    a site nobody has planned recently goes to all staff.
--  * 8:00 pm IST: admins get a summary (sites still missing, plans to review).
--  * When staff send a plan, admins are alerted straight away.
--  * When the admin approves or asks for changes, the staff member is told.
--  Alerts appear under the bell in the staff screens, as phone push, and the
--  6 pm / 8 pm reminders also by email. Clients never see these.
-- Run once in Supabase → SQL Editor, after migration 11. Safe to run again.
-- =====================================================================
create extension if not exists pg_cron;

create table if not exists public.staff_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,      -- plan_reminder, plan_summary, plan_new, plan_review
  title       text not null,
  body        text not null default '',
  link        text not null default '/admin/planner',
  read_at     timestamptz,
  sent_at     timestamptz,        -- set by the Edge Function when push/email went out
  created_at  timestamptz not null default now()
);
create index if not exists staff_notifications_user_idx on public.staff_notifications (user_id, created_at desc);

alter table public.staff_notifications enable row level security;
drop policy if exists "own staff notifications" on public.staff_notifications;
create policy "own staff notifications" on public.staff_notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "mark own staff notifications read" on public.staff_notifications;
create policy "mark own staff notifications read" on public.staff_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, update on public.staff_notifications to authenticated;
revoke all on public.staff_notifications from anon;

-- Create one staff alert and hand it to the Edge Function (push + email)
create or replace function public.notify_staff(p_user uuid, p_kind text, p_title text, p_body text, p_link text default '/admin/planner')
returns void language plpgsql security definer set search_path = public, extensions as $$
declare nid uuid;
begin
  insert into public.staff_notifications (user_id, kind, title, body, link)
  values (p_user, p_kind, left(p_title, 140), left(coalesce(p_body, ''), 600), p_link)
  returning id into nid;
  begin
    perform net.http_post(
      url := 'https://uflbaasiqfpafltbgfqf.supabase.co/functions/v1/notify',
      body := jsonb_build_object('staff_id', nid),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  exception when others then null;
  end;
end;
$$;
revoke all on function public.notify_staff(uuid, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- live alerts
create or replace function public.trg_day_plan_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text; who text; a record; when_txt text;
begin
  select name into site from public.projects where id = new.project_id;
  select coalesce(nullif(full_name, ''), email, 'Staff') into who from public.profiles where id = new.created_by;
  when_txt := to_char(new.plan_date, 'Dy DD Mon');
  if tg_op = 'INSERT' or (old.status <> 'submitted' and new.status = 'submitted') then
    -- tell admins (except the one who wrote it)
    for a in select id from public.profiles where role = 'admin' and id is distinct from new.created_by loop
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
drop trigger if exists day_plan_alerts on public.day_plans;
create trigger day_plan_alerts after insert or update of status on public.day_plans
  for each row execute function public.trg_day_plan_alerts();

-- ---------------------------------------------------------------- 6 pm: remind staff
create or replace function public.day_plan_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare tmr date := (now() at time zone 'Asia/Kolkata')::date + 1; s record; n int := 0;
begin
  for s in
    with missing as (
      select p.id, p.name from public.projects p
       where not p.archived
         and not exists (select 1 from public.day_plans d where d.project_id = p.id and d.plan_date = tmr)
    ), recent as (   -- who planned each site in the last 14 days
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
      'Please add tomorrow''s work plan for: ' || s.sites || '.', '/admin/planner');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.day_plan_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------- 8 pm: summary for admins
create or replace function public.day_plan_admin_summary() returns int
language plpgsql security definer set search_path = public as $$
declare tmr date := (now() at time zone 'Asia/Kolkata')::date + 1;
        total int; planned int; waiting int; missing text; a record; n int := 0; msg text;
begin
  select count(*) into total from public.projects where not archived;
  select count(distinct d.project_id) into planned from public.day_plans d
    join public.projects p on p.id = d.project_id and not p.archived where d.plan_date = tmr;
  select count(*) into waiting from public.day_plans where plan_date = tmr and status = 'submitted';
  select string_agg(p.name, ', ' order by p.name) into missing from public.projects p
   where not p.archived and not exists (select 1 from public.day_plans d where d.project_id = p.id and d.plan_date = tmr);
  if total = 0 or (missing is null and waiting = 0) then return 0; end if;
  msg := planned || ' of ' || total || ' sites planned.'
      || coalesce(' Still missing: ' || missing || '.', '')
      || case when waiting > 0 then ' ' || waiting || ' plan(s) waiting for your review.' else '' end;
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify_staff(a.id, 'plan_summary', 'Tomorrow''s day plan: ' || planned || '/' || total || ' sites', msg, '/admin/planner');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.day_plan_admin_summary() from public, anon, authenticated;

-- ---------------------------------------------------------------- schedule (times are UTC: 12:30 = 6:00 pm IST)
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('day-plan-reminders', 'day-plan-admin-summary');
end $$;
select cron.schedule('day-plan-reminders', '30 12 * * *', 'select public.day_plan_reminders()');
select cron.schedule('day-plan-admin-summary', '30 14 * * *', 'select public.day_plan_admin_summary()');
