-- =====================================================================
-- Migration 24: consolidated DPR
--  Staff write each site's DPR as before, then in the evening press
--  "Send consolidated DPR": one report for every site of the day.
--  * It can be sent only when every planned site (not marked off) has its DPR.
--  * Admins get ONE alert when it is sent (and when it is sent again after
--    changes). The per-site "DPR: <site>" alerts to admins stop.
--  * 7 pm: staff reminded (missing site DPRs, or "send the consolidated DPR").
--  * 9 pm: admins told if the consolidated DPR has not been sent.
-- Run once in Supabase -> SQL Editor, after migration 23. Safe to run again.
-- =====================================================================

create table if not exists public.dpr_reports (
  report_date  date primary key,
  sent_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  sent_at      timestamptz not null default now(),
  sites        int not null default 0,
  workers      int not null default 0,
  issues       int not null default 0,
  times_sent   int not null default 1
);

-- Planned sites (not off) for a day, and whether each has a DPR.
create or replace function public.planned_dpr_status(d date)
returns table (project_id uuid, name text, has_dpr boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, exists (select 1 from public.dprs r where r.project_id = p.id and r.report_date = d)
    from public.projects p
   where not p.archived
     and exists (select 1 from public.day_plans dp where dp.project_id = p.id and dp.plan_date = d)
     and not exists (select 1 from public.site_leaves sl where sl.project_id = p.id and sl.leave_date = d and sl.status = 'approved');
$$;
revoke all on function public.planned_dpr_status(date) from public, anon, authenticated;

create or replace function public.dpr_report_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date; missing text;
begin
  if auth.uid() is null then return new; end if;
  if not public.is_admin() and (new.report_date > today or new.report_date < today - 1) then
    raise exception 'The consolidated DPR can be sent for today (or yesterday).';
  end if;
  select string_agg(name, ', ' order by name) into missing from public.planned_dpr_status(new.report_date) where not has_dpr;
  if missing is not null then
    raise exception 'Write the DPR for every planned site first. Missing: %', missing;
  end if;
  new.sent_by := auth.uid();
  new.sent_at := now();
  select count(distinct r.project_id),
         coalesce(sum((select coalesce(sum(nullif(x->>'count', '')::int), 0) from jsonb_array_elements(r.labour) x where (x->>'count') ~ '^[0-9]+$')), 0),
         count(*) filter (where r.issues <> '')
    into new.sites, new.workers, new.issues
    from public.dprs r where r.report_date = new.report_date;
  if tg_op = 'UPDATE' then new.times_sent := old.times_sent + 1; else new.times_sent := 1; end if;
  return new;
end $$;
drop trigger if exists dpr_report_guard on public.dpr_reports;
create trigger dpr_report_guard before insert or update on public.dpr_reports for each row execute function public.dpr_report_guard();

alter table public.dpr_reports enable row level security;
drop policy if exists "staff read dpr reports" on public.dpr_reports;
create policy "staff read dpr reports" on public.dpr_reports for select to authenticated using (public.is_staff());
drop policy if exists "staff send dpr reports" on public.dpr_reports;
create policy "staff send dpr reports" on public.dpr_reports for insert to authenticated with check (public.is_staff());
drop policy if exists "staff resend dpr reports" on public.dpr_reports;
create policy "staff resend dpr reports" on public.dpr_reports for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "admin deletes dpr reports" on public.dpr_reports;
create policy "admin deletes dpr reports" on public.dpr_reports for delete to authenticated using (public.is_admin());
grant select, insert, update, delete on public.dpr_reports to authenticated;
revoke all on public.dpr_reports from anon;

create or replace function public.trg_dpr_report_sent() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; a record;
begin
  select coalesce(nullif(full_name, ''), 'Staff') into who from public.profiles where id = new.sent_by;
  for a in select id from public.profiles where role = 'admin' and id is distinct from new.sent_by loop
    perform public.notify_staff(a.id, 'plan_new',
      case when tg_op = 'INSERT' then 'Consolidated DPR: ' else 'Consolidated DPR updated: ' end || to_char(new.report_date, 'Dy DD Mon'),
      coalesce(who, 'Staff') || ' · ' || new.sites || case when new.sites = 1 then ' site' else ' sites' end
        || ' · ' || new.workers || ' workers'
        || case when new.issues > 0 then ' · ' || new.issues || ' with issues' else ' · no issues' end,
      '/admin/dpr?date=' || new.report_date);
  end loop;
  return null;
end $$;
drop trigger if exists dpr_report_sent on public.dpr_reports;
create trigger dpr_report_sent after insert or update on public.dpr_reports for each row execute function public.trg_dpr_report_sent();

-- Per-site DPR: no alert to admins any more (the consolidated one replaces it);
-- staff are still told when the admin reviews their DPR with a note.
create or replace function public.trg_dpr_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text;
begin
  if tg_op = 'UPDATE' and new.status = 'reviewed' and old.status <> 'reviewed' and new.admin_note <> ''
     and new.created_by is not null and new.created_by is distinct from auth.uid() then
    select name into site from public.projects where id = new.project_id;
    perform public.notify_staff(new.created_by, 'plan_review', 'DPR reviewed: ' || site, new.admin_note, '/admin/dpr?date=' || new.report_date);
  end if;
  return null;
end $$;

-- 7 pm: remind staff
create or replace function public.dpr_staff_reminder() returns int
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date; s record; n int := 0; total int; missing int;
begin
  if exists (select 1 from public.dpr_reports where report_date = d) then return 0; end if;
  select count(*), count(*) filter (where not has_dpr) into total, missing from public.planned_dpr_status(d);
  if total = 0 then return 0; end if;
  if missing = 0 then
    for s in select id from public.profiles where role = 'staff' loop
      perform public.notify_staff(s.id, 'plan_reminder', 'Send today''s consolidated DPR',
        'All ' || total || ' site DPRs are in. Please send the consolidated DPR now.', '/admin/dpr');
      n := n + 1;
    end loop;
    return n;
  end if;
  for s in
    with miss as (
      select distinct p.project_id, p.name, dp.created_by, pr.role
        from public.planned_dpr_status(d) p
        join public.day_plans dp on dp.project_id = p.project_id and dp.plan_date = d
        left join public.profiles pr on pr.id = dp.created_by
       where not p.has_dpr
    ), targets as (
      select m.name, m.created_by as user_id from miss m where m.role = 'staff'
      union
      select m.name, st.id from miss m cross join public.profiles st
       where st.role = 'staff' and m.role is distinct from 'staff'
         and not exists (select 1 from miss m2 where m2.project_id = m.project_id and m2.role = 'staff')
    )
    select user_id, string_agg(name, ', ' order by name) as sites, count(*) as cnt from targets group by user_id
  loop
    perform public.notify_staff(s.user_id, 'plan_reminder',
      'Today''s DPR needed: ' || s.cnt || case when s.cnt = 1 then ' site' else ' sites' end,
      'Write the DPR for: ' || s.sites || ', then send the consolidated DPR.', '/admin/dpr');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.dpr_staff_reminder() from public, anon, authenticated;

-- 9 pm: tell admins if the consolidated DPR has not been sent
create or replace function public.dpr_admin_alert() returns int
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date; total int; list text; cnt int; a record; n int := 0;
begin
  if exists (select 1 from public.dpr_reports where report_date = d) then return 0; end if;
  select count(*) into total from public.planned_dpr_status(d);
  if total = 0 then return 0; end if;
  select string_agg(name, ', ' order by name), count(*) into list, cnt from public.planned_dpr_status(d) where not has_dpr;
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify_staff(a.id, 'plan_summary',
      'Consolidated DPR not sent (' || to_char(d, 'Dy DD Mon') || ')',
      case when coalesce(cnt, 0) = 0 then 'All ' || total || ' site DPRs are in, but the consolidated DPR has not been sent.'
           else 'No DPR yet for ' || cnt || ' of ' || total || ' planned sites: ' || list || '.' end,
      '/admin/dpr?date=' || d);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.dpr_admin_alert() from public, anon, authenticated;
