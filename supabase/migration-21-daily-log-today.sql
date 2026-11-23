-- =====================================================================
-- Migration 21: daily-log checks look at TODAY's plan
--  Staff plan tomorrow's sites in the evening; the next morning those sites
--  must have today's daily log.
--   *  9:00 am IST: each staff member is reminded for today's planned sites
--      (that they planned) with no daily log for today yet.
--   * 10:01 am IST: admins get the list of today's planned sites still
--      without today's daily log. Sites marked "off" today are skipped.
--  Replaces the yesterday-based checks from migrations 17 and 18.
-- Run once in Supabase -> SQL Editor, after migration 20. Safe to run again.
-- =====================================================================
create or replace function public.missing_log_alert() returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  list text; cnt int; a record; n int := 0;
begin
  select string_agg(x.line, E'\n' order by x.name), count(*) into list, cnt from (
    select p.name,
           p.name || ' — planned by ' || coalesce(string_agg(distinct coalesce(nullif(pr.full_name, ''), 'staff'), ', '), 'staff') as line
      from public.projects p
      join public.day_plans d on d.project_id = p.id and d.plan_date = today
      left join public.profiles pr on pr.id = d.created_by
     where not p.archived
       and not exists (select 1 from public.site_logs l where l.project_id = p.id and l.log_date = today)
       and not exists (select 1 from public.site_leaves sl where sl.project_id = p.id and sl.leave_date = today and sl.status = 'approved')
     group by p.id, p.name
  ) x;
  if coalesce(cnt, 0) = 0 then return 0; end if;
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify_staff(a.id, 'plan_summary',
      'Daily log missing today: ' || cnt || case when cnt = 1 then ' site' else ' sites' end || ' (' || to_char(today, 'Dy DD Mon') || ')',
      'In today''s plan but no daily log yet:' || E'\n' || list,
      '/admin/planner?date=' || today);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.missing_log_alert() from public, anon, authenticated;

-- 04:31 UTC = 10:01 am IST
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'missing-log-alert';
end $$;
select cron.schedule('missing-log-alert', '31 4 * * *', 'select public.missing_log_alert()');

create or replace function public.staff_log_reminder() returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  s record; n int := 0;
begin
  for s in
    with missing as (
      select distinct p.id, p.name, d.created_by, pr.role
        from public.projects p
        join public.day_plans d on d.project_id = p.id and d.plan_date = today
        left join public.profiles pr on pr.id = d.created_by
       where not p.archived
         and not exists (select 1 from public.site_logs l where l.project_id = p.id and l.log_date = today)
         and not exists (select 1 from public.site_leaves sl where sl.project_id = p.id and sl.leave_date = today and sl.status = 'approved')
    ), targets as (
      select m.name, m.created_by as user_id from missing m where m.role = 'staff'
      union
      select m.name, st.id from missing m cross join public.profiles st
       where st.role = 'staff' and (m.role is distinct from 'staff')
         and not exists (select 1 from missing m2 where m2.id = m.id and m2.role = 'staff')
    )
    select user_id, string_agg(name, ', ' order by name) as sites, count(*) as cnt from targets group by user_id
  loop
    perform public.notify_staff(s.user_id, 'plan_reminder',
      'Add today''s daily log: ' || s.cnt || case when s.cnt = 1 then ' site' else ' sites' end,
      'No daily log yet for ' || to_char(today, 'Dy DD Mon') || ': ' || s.sites || '. Please add it before 10 am.',
      '/admin/planner?date=' || today);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.staff_log_reminder() from public, anon, authenticated;

-- 03:30 UTC = 9:00 am IST
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'staff-log-reminder';
end $$;
select cron.schedule('staff-log-reminder', '30 3 * * *', 'select public.staff_log_reminder()');
