-- =====================================================================
-- Migration 20: approval alert names the PDF to make
--  Evening (approving tomorrow): "Tomorrow planned sites" now; next morning,
--  if nothing changes, staff print "Today running sites" with no new approval.
--  Any staff change after approval still clears it (migration 15) and asks
--  the admin to approve again.
-- Run once in Supabase → SQL Editor, after migration 19. Safe to run again.
-- =====================================================================
create or replace function public.trg_day_approved() returns trigger
language plpgsql security definer set search_path = public as $$
declare s record; today date := (now() at time zone 'Asia/Kolkata')::date; t text; b text;
begin
  if new.plan_date = today + 1 then
    t := 'Tomorrow''s plan approved: ' || to_char(new.plan_date, 'Dy DD Mon');
    b := 'Make the "Tomorrow planned sites" PDF now. Tomorrow morning, if nothing changes, print "Today running sites" with no new approval. Any change needs approval again.';
  elsif new.plan_date = today then
    t := 'Today''s plan approved: ' || to_char(new.plan_date, 'Dy DD Mon');
    b := 'You can now make the "Today running sites" PDF.';
  else
    t := 'Day plan approved: ' || to_char(new.plan_date, 'Dy DD Mon');
    b := 'You can now make the PDF of the working sites.';
  end if;
  for s in select id from public.profiles where role = 'staff' loop
    perform public.notify_staff(s.id, 'plan_review', t, b, '/admin/planner?date=' || new.plan_date);
  end loop;
  return null;
end $$;

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
    for a in select id from public.profiles where role = 'admin' loop
      perform public.notify_staff(a.id, 'plan_new',
        case when d = today then 'Today''s plan changed: approve again (' else 'Plan changed: approve again (' end || to_char(d, 'Dy DD Mon') || ')',
        'Changed after approval: ' || site || '. Staff can''t make the "'
          || case when d = today then 'Today running sites' when d = today + 1 then 'Tomorrow planned sites' else 'day plan' end
          || '" PDF until you approve again.', '/admin/planner?date=' || d);
    end loop;
  end if;
  return null;
end $$;
