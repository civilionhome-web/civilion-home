-- =====================================================================
-- Migration 17: 10 am alert for missing daily logs
--  Every morning at 10:00 am IST the admins get one alert (app + phone +
--  email) listing the sites that had a day plan for yesterday but still have
--  no daily site log for yesterday. Sites marked "off" yesterday are skipped.
--  No alert when every planned site has its log.
-- Run once in Supabase → SQL Editor, after migration 16. Safe to run again.
-- =====================================================================
create or replace function public.missing_log_alert() returns int
language plpgsql security definer set search_path = public as $$
declare
  yday date := (now() at time zone 'Asia/Kolkata')::date - 1;
  list text; cnt int; a record; n int := 0;
begin
  select string_agg(x.line, E'\n' order by x.name), count(*) into list, cnt from (
    select p.name,
           p.name || ' — planned by ' || coalesce(string_agg(distinct coalesce(nullif(pr.full_name, ''), 'staff'), ', '), 'staff') as line
      from public.projects p
      join public.day_plans d on d.project_id = p.id and d.plan_date = yday
      left join public.profiles pr on pr.id = d.created_by
     where not p.archived
       and not exists (select 1 from public.site_logs l where l.project_id = p.id and l.log_date = yday)
       and not exists (select 1 from public.site_leaves sl where sl.project_id = p.id and sl.leave_date = yday and sl.status = 'approved')
     group by p.id, p.name
  ) x;
  if coalesce(cnt, 0) = 0 then return 0; end if;
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify_staff(a.id, 'plan_summary',
      'Daily log missing: ' || cnt || case when cnt = 1 then ' site' else ' sites' end || ' (' || to_char(yday, 'Dy DD Mon') || ')',
      'Planned yesterday but no daily log yet:' || E'\n' || list,
      '/admin/planner?date=' || yday);
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
