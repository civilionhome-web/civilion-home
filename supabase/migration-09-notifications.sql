-- =====================================================================
-- Migration 09: notifications for clients (bell + phone push + email)
--  * A notification is created automatically when staff add something
--    the client should know about (bill due, decision, daily log, update,
--    message, document, stage done, payment received).
--  * The app shows them under the bell; each new one is also handed to the
--    'notify' Edge Function, which sends phone push and email.
-- Run once in Supabase → SQL Editor, after migration 08. Safe to run again.
-- =====================================================================
create extension if not exists pg_net with schema extensions;

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  kind        text not null,            -- bill, credit, paid, decision, log, update, message, document, stage
  title       text not null,
  body        text not null default '',
  link        text not null default '/',
  sent_at     timestamptz,              -- set by the Edge Function when push/email went out
  created_at  timestamptz not null default now()
);
create index if not exists notifications_project_idx on public.notifications (project_id, created_at desc);

create table if not exists public.notification_seen (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  seen_at     timestamptz not null default now(),
  primary key (user_id, project_id)
);

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  p256dh      text not null,
  auth        text not null,
  user_agent  text not null default '',
  created_at  timestamptz not null default now()
);

alter table public.project_clients add column if not exists email_notifications boolean not null default true;

alter table public.notifications enable row level security;
alter table public.notification_seen enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "view notifications" on public.notifications;
create policy "view notifications" on public.notifications
  for select to authenticated using (public.can_view_project(project_id));

drop policy if exists "own seen state" on public.notification_seen;
create policy "own seen state" on public.notification_seen
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.notifications to authenticated;
grant select, insert, update, delete on public.notification_seen, public.push_subscriptions to authenticated;
revoke all on public.notifications, public.notification_seen, public.push_subscriptions from anon;

-- Client turns email notifications on/off for themselves
create or replace function public.set_my_email_notifications(p_on boolean) returns void
language sql security definer set search_path = public as $$
  update public.project_clients set email_notifications = p_on
   where email <> '' and lower(email) = public.my_email();
$$;
grant execute on function public.set_my_email_notifications(boolean) to authenticated;

create or replace function public.my_email_notifications() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(bool_and(email_notifications), true) from public.project_clients
   where email <> '' and lower(email) = public.my_email();
$$;
grant execute on function public.my_email_notifications() to authenticated;

-- Who receives a project's notifications (used by the Edge Function)
create or replace function public.project_client_user_ids(p_project uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct p.id from public.profiles p
    join public.project_clients c on c.project_id = p_project
   where p.role = 'client'
     and ((c.email <> '' and lower(p.email) = lower(c.email))
       or (c.phone_digits <> '' and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = c.phone_digits));
$$;
revoke all on function public.project_client_user_ids(uuid) from public, anon, authenticated;

-- Create a notification (called by the triggers below)
create or replace function public.notify(p_project uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare nid uuid;
begin
  insert into public.notifications (project_id, kind, title, body, link)
  values (p_project, p_kind, left(p_title, 140), left(coalesce(p_body, ''), 400), p_link)
  returning id into nid;
  -- hand it to the Edge Function for push + email (does nothing harmful if it isn't deployed yet)
  begin
    perform net.http_post(
      url := 'https://uflbaasiqfpafltbgfqf.supabase.co/functions/v1/notify',
      body := jsonb_build_object('id', nid),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  exception when others then null;
  end;
end;
$$;
revoke all on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.inr_text(n numeric) returns text
language sql immutable as $$
  select case when n < 0 then '−' else '' end || '₹' ||
    regexp_replace(
      regexp_replace(trunc(abs(n))::text, '(\d)(?=(\d{3})$)', '\1,'),
      '(\d)(?=(\d\d)+,)', '\1,', 'g');
$$;

-- ---------------------------------------------------------------- triggers
create or replace function public.trg_notify_bills() returns trigger
language plpgsql security definer set search_path = public as $$
declare no text := lpad(new.number::text, 2, '0');
begin
  if new.status = 'due' and (tg_op = 'INSERT' or old.status is distinct from 'due') then
    if new.amount < 0 then
      perform public.notify(new.project_id, 'credit', 'Credit added: ' || public.inr_text(new.amount),
        'Bill ' || no || ' · ' || new.title || ' — reduces the amount you pay.', '/payments');
    else
      perform public.notify(new.project_id, 'bill', 'Payment due: ' || public.inr_text(new.amount),
        'Bill ' || no || ' · ' || new.title || coalesce(' — please pay by ' || to_char(new.due_date, 'DD Mon YYYY'), ''), '/payments');
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'paid' and old.status is distinct from 'paid' and new.amount > 0 then
    perform public.notify(new.project_id, 'paid', 'Payment received — thank you',
      'Bill ' || no || ' · ' || new.title || ' · ' || public.inr_text(new.amount), '/payments');
  end if;
  return null;
end;
$$;
drop trigger if exists notify_bills on public.bills;
create trigger notify_bills after insert or update of status on public.bills
  for each row execute function public.trg_notify_bills();

create or replace function public.trg_notify_approvals() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status = 'cancelled') then
    perform public.notify(new.project_id, 'decision', 'Your decision is needed: ' || new.title,
      coalesce(nullif(new.description, ''), 'Open the app to see the options and choose.'), '/approvals');
  end if;
  return null;
end;
$$;
drop trigger if exists notify_approvals on public.approvals;
create trigger notify_approvals after insert or update of status on public.approvals
  for each row execute function public.trg_notify_approvals();

create or replace function public.trg_notify_site_logs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.project_id, 'log', 'Daily site log · ' || to_char(new.log_date, 'DD Mon'),
    new.work_done, '/site-log');
  return null;
end;
$$;
drop trigger if exists notify_site_logs on public.site_logs;
create trigger notify_site_logs after insert on public.site_logs
  for each row execute function public.trg_notify_site_logs();

create or replace function public.trg_notify_updates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.project_id, 'update', 'Site update' || coalesce(' · ' || nullif(new.period, ''), ''),
    new.body, '/progress');
  return null;
end;
$$;
drop trigger if exists notify_updates on public.updates;
create trigger notify_updates after insert on public.updates
  for each row execute function public.trg_notify_updates();

create or replace function public.trg_notify_messages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.from_staff then
    perform public.notify(new.project_id, 'message', 'Message from ' || coalesce(nullif(new.sender_name, ''), 'Civilion team'),
      case when new.body <> '' then new.body else 'Sent you a photo' end, '/chat');
  end if;
  return null;
end;
$$;
drop trigger if exists notify_messages on public.messages;
create trigger notify_messages after insert on public.messages
  for each row execute function public.trg_notify_messages();

create or replace function public.trg_notify_documents() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.project_id, 'document', 'New document: ' || new.title,
    coalesce(nullif(new.category, ''), 'Document'), '/documents');
  return null;
end;
$$;
drop trigger if exists notify_documents on public.documents;
create trigger notify_documents after insert on public.documents
  for each row execute function public.trg_notify_documents();

create or replace function public.trg_notify_stages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    perform public.notify(new.project_id, 'stage', 'Stage completed: ' || new.name,
      'One more step done on your home.', '/progress');
  end if;
  return null;
end;
$$;
drop trigger if exists notify_stages on public.stages;
create trigger notify_stages after update of status on public.stages
  for each row execute function public.trg_notify_stages();
