-- =====================================================================
-- Migration 25: tell the client when their site is off
--  * When a site-off day is approved (today, tomorrow or a later date), the
--    project's client gets a notification (bell, phone and email):
--    "No work at your site tomorrow (Sat 28 Nov)" with the reason.
--  * Sent once per site-off. Sent again only if the reason changes and it is
--    approved again.
--  * If an approved site off is later rejected or deleted, the client is told
--    that work goes ahead as planned that day.
-- Run once in Supabase -> SQL Editor, after migration 24. Safe to run again.
-- =====================================================================

create table if not exists public.site_leave_notices (
  leave_id    uuid primary key,
  project_id  uuid not null,
  leave_date  date not null,
  reason      text not null,
  sent_at     timestamptz not null default now()
);
alter table public.site_leave_notices enable row level security;
revoke all on public.site_leave_notices from anon, authenticated;

create or replace function public.trg_site_leave_client() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  r public.site_leaves%rowtype;
  sent public.site_leave_notices%rowtype;
  dayword text;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if r.leave_date < today then return null; end if;
  if exists (select 1 from public.projects where id = r.project_id and archived) then return null; end if;
  dayword := case when r.leave_date = today then 'today' when r.leave_date = today + 1 then 'tomorrow'
                  else 'on ' || to_char(r.leave_date, 'FMDay') end || ' (' || to_char(r.leave_date, 'Dy DD Mon') || ')';
  select * into sent from public.site_leave_notices where leave_id = r.id;

  if tg_op <> 'DELETE' and new.status = 'approved' then
    if found and sent.reason = new.reason and sent.leave_date = new.leave_date then return null; end if;  -- already told
    perform public.notify(new.project_id, 'update',
      'No work at your site ' || dayword,
      'Reason: ' || new.reason || '. Your project manager will keep you posted; message us in the app for any questions.',
      '/progress');
    insert into public.site_leave_notices (leave_id, project_id, leave_date, reason) values (new.id, new.project_id, new.leave_date, new.reason)
      on conflict (leave_id) do update set leave_date = excluded.leave_date, reason = excluded.reason, sent_at = now();
  elsif found and (tg_op = 'DELETE' or new.status = 'rejected') then
    perform public.notify(r.project_id, 'update',
      'Work goes ahead at your site ' || dayword,
      'The site will not be off after all. Work continues as planned.',
      '/progress');
    delete from public.site_leave_notices where leave_id = r.id;
  end if;
  return null;
end $$;
drop trigger if exists site_leave_client on public.site_leaves;
create trigger site_leave_client after insert or update or delete on public.site_leaves
  for each row execute function public.trg_site_leave_client();
