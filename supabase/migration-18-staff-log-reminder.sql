-- =====================================================================
-- Migration 18: 9 am daily-log reminder for staff
--  Every morning at 9:00 am IST each staff member gets a reminder (app +
--  phone + email) for the sites they planned yesterday that have no daily
--  site log for yesterday yet. Sites planned by an admin go to all staff.
--  Sites marked "off" yesterday are skipped. At 10 am the admins get the
--  list of sites still missing (migration 17).
-- Run once in Supabase → SQL Editor, after migration 17. Safe to run again.
-- =====================================================================
create or replace function public.staff_log_reminder() returns int
language plpgsql security definer set search_path = public as $$
declare
  yday date := (now() at time zone 'Asia/Kolkata')::date - 1;
  s record; n int := 0;
begin
  for s in
    with missing as (
      select distinct p.id, p.name, d.created_by, pr.role
        from public.projects p
        join public.day_plans d on d.project_id = p.id and d.plan_date = yday
        left join public.profiles pr on pr.id = d.created_by
       where not p.archived
         and not exists (select 1 from public.site_logs l where l.project_id = p.id and l.log_date = yday)
         and not exists (select 1 from public.site_leaves sl where sl.project_id = p.id and sl.leave_date = yday and sl.status = 'approved')
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
      'Add yesterday''s daily log: ' || s.cnt || case when s.cnt = 1 then ' site' else ' sites' end,
      'No daily log yet for ' || to_char(yday, 'Dy DD Mon') || ': ' || s.sites || '. Please add it before 10 am.',
      '/admin');
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
