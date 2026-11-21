-- =====================================================================
-- Migration 16: changes during the day (day planner)
--  Staff record what changed on site during the day:
--   * hindrance       – work stopped/slowed (reason, who caused it, from–to time)
--   * labour          – workers shifted to another site
--   * team            – a team / gang shifted to another site
--   * machinery       – machinery / tools / vehicle shifted to another site
--   * split           – half day at this site, rest of the day at another site
--  Shifts are recorded at once; the admin and the staff of the other site are
--  told. A hindrance waits for admin approval; once approved it is added to the
--  project's hindrance register (which clients see, and which counts towards
--  the completion date when the client caused it).
-- Run once in Supabase → SQL Editor, after migration 15. Safe to run again.
-- =====================================================================
create table if not exists public.day_changes (
  id             uuid primary key default gen_random_uuid(),
  change_date    date not null,
  project_id     uuid not null references public.projects(id) on delete cascade,     -- site where it happened / from site
  kind           text not null check (kind in ('hindrance','labour','team','machinery','split')),
  to_project_id  uuid references public.projects(id) on delete set null,             -- other site (shifts, split day)
  item           text not null default '',      -- team name / machinery / type of labour
  workers        int check (workers is null or workers >= 0),
  at_time        text not null default '',      -- from (e.g. 11:30)
  until_time     text not null default '',      -- till (hindrance)
  reason         text not null default '',
  caused_by      text check (caused_by is null or caused_by in ('client','weather','authority','contractor','other')),
  status         text not null default 'recorded' check (status in ('recorded','pending','approved','rejected')),
  admin_note     text not null default '',
  hindrance_id   uuid references public.hindrances(id) on delete set null,
  created_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint day_change_other_site check (kind = 'hindrance' or (to_project_id is not null and to_project_id <> project_id))
);
create index if not exists day_changes_date_idx on public.day_changes (change_date);

-- Add an approved hindrance to the project's hindrance register
create or replace function public.day_change_register(c public.day_changes) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid; who text;
begin
  select coalesce(nullif(full_name, ''), 'staff') into who from public.profiles where id = c.created_by;
  insert into public.hindrances (project_id, from_date, to_date, reason, caused_by, remarks, created_by)
  values (c.project_id, c.change_date, c.change_date,
          c.reason || case when c.at_time <> '' or c.until_time <> '' then ' (' || nullif(c.at_time, '') || coalesce('–' || nullif(c.until_time, ''), '') || ')' else '' end,
          coalesce(c.caused_by, 'other'),
          'Booked from the day planner by ' || who, c.created_by)
  returning id into hid;
  return hid;
end $$;
revoke all on function public.day_change_register(public.day_changes) from public, anon, authenticated;

create or replace function public.day_change_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null then return new; end if;
  if public.is_admin() then
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
drop trigger if exists day_change_guard on public.day_changes;
create trigger day_change_guard before insert or update on public.day_changes
  for each row execute function public.day_change_guard();

alter table public.day_changes enable row level security;
drop policy if exists "staff read day changes" on public.day_changes;
create policy "staff read day changes" on public.day_changes for select to authenticated using (public.is_staff());
drop policy if exists "staff add day changes" on public.day_changes;
create policy "staff add day changes" on public.day_changes for insert to authenticated with check (public.is_staff());
drop policy if exists "admin or author edits day changes" on public.day_changes;
create policy "admin or author edits day changes" on public.day_changes for update to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes day changes" on public.day_changes;
create policy "admin or author deletes day changes" on public.day_changes for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid() and status <> 'approved'
                               and change_date = (now() at time zone 'Asia/Kolkata')::date));
grant select, insert, update, delete on public.day_changes to authenticated;
revoke all on public.day_changes from anon;

-- ---------------------------------------------------------------- alerts
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
    for a in select id from public.profiles where role = 'admin' and id is distinct from new.created_by loop
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
drop trigger if exists day_change_alerts on public.day_changes;
create trigger day_change_alerts after insert or update on public.day_changes
  for each row execute function public.trg_day_change_alerts();
