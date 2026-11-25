-- =====================================================================
-- Migration 23: daily logs: "all in" alert + 12 pm check
--  * When the last of today's planned sites gets its daily log, admins get
--    ONE alert: "All daily logs in today". Once per day, not per log.
--  * Missing-log alert now runs twice: 10:01 am and 12:00 pm IST. Each lists
--    today's planned sites (not marked off) that still have no daily log.
--    No alert when every planned site has its log.
-- Run once in Supabase -> SQL Editor, after migration 22. Safe to run again.
-- =====================================================================

create table if not exists public.daily_log_alerts (
  log_date  date not null,
  kind      text not null,
  sent_at   timestamptz not null default now(),
  primary key (log_date, kind)
);
alter table public.daily_log_alerts enable row level security;
revoke all on public.daily_log_alerts from anon, authenticated;

-- Today's planned sites (not marked off) and whether each has its daily log.
create or replace function public.planned_log_status(d date)
returns table (project_id uuid, name text, planned_by text, has_log boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name,
         coalesce(string_agg(distinct coalesce(nullif(pr.full_name, ''), 'staff'), ', '), 'staff'),
         exists (select 1 from public.site_logs l where l.project_id = p.id and l.log_date = d)
    from public.projects p
    join public.day_plans dp on dp.project_id = p.id and dp.plan_date = d
    left join public.profiles pr on pr.id = dp.created_by
   where not p.archived
     and not exists (select 1 from public.site_leaves sl where sl.project_id = p.id and sl.leave_date = d and sl.status = 'approved')
   group by p.id, p.name;
$$;
revoke all on function public.planned_log_status(date) from public, anon, authenticated;

-- Missing-log alert, with the time shown in the title.
create or replace function public.missing_log_alert_at(at_label text) returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  list text; cnt int; a record; n int := 0;
begin
  select string_agg(s.name || ' — planned by ' || s.planned_by, E'\n' order by s.name), count(*)
    into list, cnt from public.planned_log_status(today) s where not s.has_log;
  if coalesce(cnt, 0) = 0 then return 0; end if;
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify_staff(a.id, 'plan_summary',
      'Daily log missing at ' || at_label || ': ' || cnt || case when cnt = 1 then ' site' else ' sites' end || ' (' || to_char(today, 'Dy DD Mon') || ')',
      'In today''s plan but no daily log yet:' || E'\n' || list,
      '/admin/planner?date=' || today);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.missing_log_alert_at(text) from public, anon, authenticated;

create or replace function public.missing_log_alert() returns int
language sql security definer set search_path = public as $$ select public.missing_log_alert_at('10 am'); $$;
revoke all on function public.missing_log_alert() from public, anon, authenticated;

-- One alert when every planned site has today's log.
create or replace function public.trg_daily_logs_complete() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date; total int; done int; a record;
begin
  if new.log_date <> today then return null; end if;
  select count(*), count(*) filter (where has_log) into total, done from public.planned_log_status(today);
  if total = 0 or done < total then return null; end if;
  insert into public.daily_log_alerts (log_date, kind) values (today, 'complete') on conflict do nothing;
  if not found then return null; end if;   -- already told today
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify_staff(a.id, 'plan_summary',
      'All daily logs in: ' || total || case when total = 1 then ' site' else ' sites' end || ' (' || to_char(today, 'Dy DD Mon') || ')',
      'Every site in today''s plan has its daily log. Last one: '
        || coalesce((select name from public.projects where id = new.project_id), 'a site')
        || ' at ' || to_char(now() at time zone 'Asia/Kolkata', 'FMHH12:MI am') || '.',
      '/admin/planner?date=' || today);
  end loop;
  return null;
end $$;
drop trigger if exists daily_logs_complete on public.site_logs;
create trigger daily_logs_complete after insert or update of log_date, project_id on public.site_logs
  for each row execute function public.trg_daily_logs_complete();

-- Schedules (UTC): 10:01 am IST stays; add 12:00 pm IST.
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('missing-log-alert', 'missing-log-alert-noon');
end $$;
select cron.schedule('missing-log-alert',      '31 4 * * *', 'select public.missing_log_alert()');            -- 10:01 am IST
select cron.schedule('missing-log-alert-noon', '30 6 * * *', $$select public.missing_log_alert_at('12 pm')$$); -- 12:00 pm IST
