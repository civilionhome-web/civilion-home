-- =====================================================================
-- Civilion Home — database schema for Supabase
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run once on a fresh project.
-- =====================================================================

-- ---------- Profiles (one row per signed-in person) -------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  phone       text not null default '',
  email       text not null default '',
  role        text not null default 'client' check (role in ('client','staff','admin')),
  created_at  timestamptz not null default now()
);

-- ---------- Projects ---------------------------------------------------
create table public.projects (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,                 -- "Anil & Divya's Home"
  location             text not null default '',      -- "Mannarkkad"
  client_greeting_name text not null default '',      -- "Anil"
  stage_label          text not null default '',      -- "First floor slab · curing"
  percent_complete     int  not null default 0 check (percent_complete between 0 and 100),
  schedule_status      text not null default 'On track' check (schedule_status in ('On track','Slight delay','Delayed','Ahead')),
  handover_target      text not null default '',      -- "Aug 2027"
  contract_amount      numeric(14,2) not null default 0,
  boq_amount           numeric(14,2) not null default 0,
  client_currency      text not null default 'AED',   -- shown as "≈ AED 42,980"
  pm_name              text not null default '',
  pm_phone             text not null default '',      -- WhatsApp number for video calls, digits with country code
  payment_instructions text not null default '',
  archived             boolean not null default false,
  created_at           timestamptz not null default now()
);

-- Who (which client) can open which project. Staff add a phone and/or email;
-- the client gets access as soon as they sign in with that phone or email.
create table public.project_clients (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  display_name  text not null default '',
  phone_digits  text not null default '',   -- e.g. 971501234567 (country code + number, digits only)
  email         text not null default '',
  created_at    timestamptz not null default now(),
  check (phone_digits <> '' or email <> '')
);
create index on public.project_clients (phone_digits);
create index on public.project_clients (lower(email));

-- ---------- Progress stages -------------------------------------------
create table public.stages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  position    int  not null default 0,
  name        text not null,
  note        text not null default '',
  status      text not null default 'upcoming' check (status in ('done','current','upcoming'))
);
create index on public.stages (project_id, position);

-- ---------- Weekly site updates + photos -------------------------------
create table public.updates (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  period      text not null default '',   -- "2–7 Nov"
  body        text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.updates (project_id, created_at desc);

create table public.update_photos (
  id          uuid primary key default gen_random_uuid(),
  update_id   uuid not null references public.updates(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  path        text not null,              -- storage path in bucket project-files
  caption     text not null default '',
  created_at  timestamptz not null default now()
);
create index on public.update_photos (project_id, created_at desc);

-- ---------- Site cameras + today's site log ---------------------------
create table public.cameras (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,                -- "Front", "Rear & yard"
  stream_type text not null default 'hls' check (stream_type in ('hls','embed','image')),
  url         text not null,                -- .m3u8 link, embed/iframe link, or refreshing snapshot image link
  position    int  not null default 0,
  active      boolean not null default true
);
create index on public.cameras (project_id, position);

create table public.site_events (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  happened_at timestamptz not null default now(),
  text        text not null                 -- "Cement delivery, 220 bags"
);
create index on public.site_events (project_id, happened_at desc);

-- ---------- Bills -----------------------------------------------------
create table public.bills (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  number              int  not null,
  title               text not null,          -- "First floor slab"
  amount              numeric(14,2) not null,
  percent_of_contract numeric(5,2),
  details             text not null default '',  -- "6 BOQ items measured · 24 photos"
  status              text not null default 'due' check (status in ('upcoming','due','paid')),
  due_date            date,
  paid_on             date,
  bill_path           text,                    -- PDF of the BOQ bill (storage)
  receipt_path        text,                    -- PDF of the receipt (storage)
  created_at          timestamptz not null default now()
);
create index on public.bills (project_id, number);

-- ---------- Client decisions (approvals / variation orders) -----------
create table public.approvals (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  title             text not null,            -- "Living room floor tile"
  description       text not null default '',
  due_date          date,
  status            text not null default 'open' check (status in ('open','decided','cancelled')),
  reference         text not null default '', -- "VO-03"
  chosen_option_id  uuid,
  decided_by        uuid references public.profiles(id) on delete set null,
  decided_by_name   text not null default '',
  decided_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index on public.approvals (project_id, created_at desc);

create table public.approval_options (
  id           uuid primary key default gen_random_uuid(),
  approval_id  uuid not null references public.approvals(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  position     int  not null default 0,
  name         text not null,                 -- "Kajaria matt, Ivory"
  detail       text not null default '',      -- "800 × 800 mm · in BOQ item F1"
  cost_delta   numeric(14,2) not null default 0,  -- 0 = no extra cost, + extra, − saving
  photo_path   text
);
create index on public.approval_options (approval_id, position);

alter table public.approvals
  add constraint approvals_chosen_option_fk
  foreign key (chosen_option_id) references public.approval_options(id) on delete set null;

-- ---------- Chat ------------------------------------------------------
create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  sender_id    uuid references public.profiles(id) on delete set null,
  sender_name  text not null default '',
  from_staff   boolean not null default false,
  body         text not null default '',
  photo_path   text,
  created_at   timestamptz not null default now(),
  check (body <> '' or photo_path is not null)
);
create index on public.messages (project_id, created_at);

-- =====================================================================
-- Helper functions
-- =====================================================================
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('staff','admin'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- digits of the signed-in person's phone, '' if none
create or replace function public.my_phone_digits() returns text
language sql stable as $$
  select regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\D', '', 'g');
$$;

create or replace function public.my_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.can_view_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (
    select 1 from public.project_clients pc
    where pc.project_id = pid
      and (
        (pc.phone_digits <> '' and pc.phone_digits = public.my_phone_digits())
        or (pc.email <> '' and lower(pc.email) = public.my_email())
      )
  );
$$;

-- turns a text into a uuid, or null if it isn't one (used for storage paths)
create or replace function public.try_uuid(t text) returns uuid
language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end;
$$;

-- =====================================================================
-- Triggers
-- =====================================================================
-- New sign-in → profile row
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, phone, email)
  values (new.id, coalesce(new.phone, ''), coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change roles (the SQL editor, where auth.uid() is null, may too)
create or replace function public.guard_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  if new.id is distinct from old.id then
    raise exception 'id cannot change';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_role_change();

-- Chat messages: fill sender details from the signed-in person, never from the app
create or replace function public.fill_message_sender() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  new.sender_id   := auth.uid();
  new.from_staff  := coalesce(p.role in ('staff','admin'), false);
  new.sender_name := coalesce(nullif(p.full_name, ''), case when new.from_staff then 'Civilion team' else 'Client' end);
  new.created_at  := now();
  return new;
end;
$$;

create trigger messages_fill_sender
  before insert on public.messages
  for each row execute function public.fill_message_sender();

-- =====================================================================
-- Client action: choose an option on an open decision
-- =====================================================================
create or replace function public.decide_approval(p_approval uuid, p_option uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.approvals; o public.approval_options; who text;
begin
  select * into a from public.approvals where id = p_approval for update;
  if a.id is null then raise exception 'Decision not found'; end if;
  if not public.can_view_project(a.project_id) then raise exception 'Not allowed'; end if;
  if a.status <> 'open' then raise exception 'This decision is already closed'; end if;
  select * into o from public.approval_options where id = p_option and approval_id = p_approval;
  if o.id is null then raise exception 'Option not found'; end if;
  select coalesce(nullif(full_name, ''), nullif(phone, ''), email) into who from public.profiles where id = auth.uid();
  update public.approvals
     set status = 'decided', chosen_option_id = o.id, decided_by = auth.uid(),
         decided_by_name = coalesce(who, ''), decided_at = now()
   where id = a.id;
end;
$$;

-- =====================================================================
-- Row level security: clients see only their projects; staff see all
-- =====================================================================
alter table public.profiles         enable row level security;
alter table public.projects         enable row level security;
alter table public.project_clients  enable row level security;
alter table public.stages           enable row level security;
alter table public.updates          enable row level security;
alter table public.update_photos    enable row level security;
alter table public.cameras          enable row level security;
alter table public.site_events      enable row level security;
alter table public.bills            enable row level security;
alter table public.approvals        enable row level security;
alter table public.approval_options enable row level security;
alter table public.messages         enable row level security;

-- profiles
create policy "read own profile or staff reads all" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_staff());
create policy "update own profile or admin" on public.profiles
  for update to authenticated using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- projects
create policy "view project" on public.projects
  for select to authenticated using (public.can_view_project(id));
create policy "staff write projects" on public.projects
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- project_clients: only staff (clients don't need to see the access list)
create policy "staff manage project clients" on public.project_clients
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Generic pattern for project-owned tables: members read, staff write
do $$
declare t text;
begin
  foreach t in array array['stages','updates','update_photos','cameras','site_events','bills','approvals','approval_options']
  loop
    execute format('create policy "view %1$s" on public.%1$I for select to authenticated using (public.can_view_project(project_id))', t);
    execute format('create policy "staff write %1$s" on public.%1$I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;

-- messages: members read and post in their project; staff can delete
create policy "view messages" on public.messages
  for select to authenticated using (public.can_view_project(project_id));
create policy "post messages" on public.messages
  for insert to authenticated with check (public.can_view_project(project_id));
create policy "staff delete messages" on public.messages
  for delete to authenticated using (public.is_staff());

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
grant execute on function public.decide_approval(uuid, uuid) to authenticated;
grant execute on function public.is_staff() to authenticated;

-- =====================================================================
-- Storage: one private bucket, files kept under <project_id>/...
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

create policy "members read project files" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-files'
         and public.can_view_project(public.try_uuid((storage.foldername(name))[1])));

create policy "staff upload project files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-files' and public.is_staff());

create policy "clients upload chat photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-files'
              and (storage.foldername(name))[2] = 'chat'
              and public.can_view_project(public.try_uuid((storage.foldername(name))[1])));

create policy "staff change project files" on storage.objects
  for update to authenticated
  using (bucket_id = 'project-files' and public.is_staff());

create policy "staff delete project files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-files' and public.is_staff());

-- =====================================================================
-- Live updates for chat and decisions
-- =====================================================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.approvals;

-- =====================================================================
-- Migration 01: project documents (agreement, drawings, permits, BOQ…)
-- (Also available alone as migration-01-documents.sql for existing databases.)
-- =====================================================================
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  title        text not null,
  category     text not null default 'Other',
  path         text not null,              -- storage path in bucket project-files
  file_name    text not null default '',
  size_bytes   bigint not null default 0,
  mime         text not null default '',
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists documents_project_idx on public.documents (project_id, created_at desc);

alter table public.documents enable row level security;

drop policy if exists "view documents" on public.documents;
create policy "view documents" on public.documents
  for select to authenticated using (public.can_view_project(project_id));

drop policy if exists "staff write documents" on public.documents;
create policy "staff write documents" on public.documents
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.documents to authenticated;
revoke all on public.documents from anon;

-- =====================================================================
-- Migration 02: add staff from the app (Team page)
-- An admin adds a name + email + role. When that person first signs in
-- (email code or password), they become Staff/Admin automatically.
-- If they already have an account, their role changes straight away.
-- (Also available alone as migration-02-staff-invites.sql for existing databases.)
-- =====================================================================
create table if not exists public.staff_invites (
  email       text primary key,               -- always stored lower-case
  full_name   text not null default '',
  role        text not null default 'staff' check (role in ('staff','admin')),
  invited_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.staff_invites enable row level security;
drop policy if exists "admins manage staff invites" on public.staff_invites;
create policy "admins manage staff invites" on public.staff_invites
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.staff_invites to authenticated;
revoke all on public.staff_invites from anon;

-- New sign-in → profile row, with the invited role and name if there is an invite
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.staff_invites;
begin
  select * into inv from public.staff_invites where email = lower(coalesce(new.email, ''));
  insert into public.profiles (id, phone, email, role, full_name)
  values (new.id, coalesce(new.phone, ''), coalesce(new.email, ''),
          coalesce(inv.role, 'client'), coalesce(inv.full_name, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Admin action: add (or update) a staff member by email
create or replace function public.invite_staff(p_email text, p_name text, p_role text default 'staff')
returns text
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  n text := trim(coalesce(p_name, ''));
  existing uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can add staff'; end if;
  if e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Please enter a valid email address'; end if;
  if p_role not in ('staff', 'admin') then raise exception 'Role must be Staff or Admin'; end if;

  insert into public.staff_invites (email, full_name, role, invited_by)
  values (e, n, p_role, auth.uid())
  on conflict (email) do update set full_name = excluded.full_name, role = excluded.role;

  select id into existing from public.profiles where lower(email) = e;
  if existing is not null then
    if existing = auth.uid() then raise exception 'You cannot change your own role'; end if;
    update public.profiles
       set role = p_role,
           full_name = case when n <> '' then n else full_name end
     where id = existing;
    return 'updated';
  end if;
  return 'invited';
end;
$$;

revoke all on function public.invite_staff(text, text, text) from public, anon;
grant execute on function public.invite_staff(text, text, text) to authenticated;
-- =====================================================================
-- Migration 03: time schedule + hindrance register
--  * Project start date and agreed completion date
--  * Planned start / end date for each stage
--  * Hindrance register: reason, who caused it, from / to dates.
--    Days lost to client-caused hindrances extend the completion date.
-- (Also available alone as migration-03-schedule-hindrances.sql for existing databases.)
-- =====================================================================
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists completion_date date;   -- as per agreement

alter table public.stages add column if not exists start_date date;
alter table public.stages add column if not exists end_date date;

create table if not exists public.hindrances (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  from_date   date not null,
  to_date     date,                                   -- empty = still going on
  reason      text not null,
  caused_by   text not null default 'client'
              check (caused_by in ('client','weather','authority','contractor','other')),
  remarks     text not null default '',
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint hindrance_dates check (to_date is null or to_date >= from_date)
);
create index if not exists hindrances_project_idx on public.hindrances (project_id, from_date);

alter table public.hindrances enable row level security;

drop policy if exists "view hindrances" on public.hindrances;
create policy "view hindrances" on public.hindrances
  for select to authenticated using (public.can_view_project(project_id));

drop policy if exists "staff write hindrances" on public.hindrances;
create policy "staff write hindrances" on public.hindrances
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.hindrances to authenticated;
revoke all on public.hindrances from anon;
-- =====================================================================
-- Migration 04: daily site log with photos
--  One entry per day (or more): weather, workers on site, work done,
--  materials received, remarks, and any number of photos.
-- (Also available alone as migration-04-daily-site-log.sql for existing databases.)
-- =====================================================================
create table if not exists public.site_logs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  log_date    date not null default ((now() at time zone 'Asia/Kolkata')::date),
  weather     text not null default '',
  workers     int check (workers is null or workers >= 0),
  work_done   text not null,
  materials   text not null default '',
  remarks     text not null default '',
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists site_logs_project_idx on public.site_logs (project_id, log_date desc);

create table if not exists public.site_log_photos (
  id          uuid primary key default gen_random_uuid(),
  log_id      uuid not null references public.site_logs(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  path        text not null,              -- storage path in bucket project-files
  caption     text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists site_log_photos_idx on public.site_log_photos (project_id, created_at desc);

alter table public.site_logs enable row level security;
alter table public.site_log_photos enable row level security;

drop policy if exists "view site logs" on public.site_logs;
create policy "view site logs" on public.site_logs
  for select to authenticated using (public.can_view_project(project_id));
drop policy if exists "staff write site logs" on public.site_logs;
create policy "staff write site logs" on public.site_logs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "view site log photos" on public.site_log_photos;
create policy "view site log photos" on public.site_log_photos
  for select to authenticated using (public.can_view_project(project_id));
drop policy if exists "staff write site log photos" on public.site_log_photos;
create policy "staff write site log photos" on public.site_log_photos
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.site_logs, public.site_log_photos to authenticated;
revoke all on public.site_logs, public.site_log_photos from anon;
-- =====================================================================
-- Migration 05: variations (extra cost from decisions)
--  * Bills can be linked to the decision they came from (kind = variation)
--  * When a client approves an option with an extra cost, a bill for that
--    amount is created at the same moment, due the same day.
-- (Also available alone as migration-05-variation-bills.sql for existing databases.)
-- =====================================================================
alter table public.bills add column if not exists kind text not null default 'stage';
alter table public.bills add column if not exists approval_id uuid references public.approvals(id) on delete set null;
do $$ begin
  alter table public.bills add constraint bills_kind_check check (kind in ('stage','variation'));
exception when duplicate_object then null; end $$;
create unique index if not exists bills_one_per_approval on public.bills (approval_id) where approval_id is not null;

create or replace function public.decide_approval(p_approval uuid, p_option uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.approvals; o public.approval_options; who text;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  next_no int;
begin
  select * into a from public.approvals where id = p_approval for update;
  if a.id is null then raise exception 'Decision not found'; end if;
  if not public.can_view_project(a.project_id) then raise exception 'Not allowed'; end if;
  if a.status <> 'open' then raise exception 'This decision is already closed'; end if;
  select * into o from public.approval_options where id = p_option and approval_id = p_approval;
  if o.id is null then raise exception 'Option not found'; end if;
  select coalesce(nullif(full_name, ''), nullif(phone, ''), email) into who from public.profiles where id = auth.uid();
  update public.approvals
     set status = 'decided', chosen_option_id = o.id, decided_by = auth.uid(),
         decided_by_name = coalesce(who, ''), decided_at = now()
   where id = a.id;

  -- Extra cost approved → variation bill, due today
  if o.cost_delta > 0 then
    perform pg_advisory_xact_lock(hashtext(a.project_id::text));
    select coalesce(max(number), 0) + 1 into next_no from public.bills where project_id = a.project_id;
    insert into public.bills (project_id, number, title, amount, details, status, due_date, kind, approval_id)
    values (a.project_id, next_no, 'Variation · ' || a.title, o.cost_delta,
            concat_ws(' · ', nullif(a.reference, ''), o.name,
                      'approved by ' || coalesce(nullif(who, ''), 'client') || ' on ' || to_char(today, 'DD Mon YYYY')),
            'due', today, 'variation', a.id)
    on conflict do nothing;
  end if;
end;
$$;
grant execute on function public.decide_approval(uuid, uuid) to authenticated;
-- =====================================================================
-- Migration 06: bill every approved variation, savings included
--  * Extra cost  → variation bill (+amount), due on the approval date
--  * Saving      → variation credit (−amount), dated the approval date;
--                  it reduces the amount due and the total project cost
--  * Decisions already approved without a bill get one now, dated on the
--    day they were approved.
-- (Also available alone as migration-06-variation-credits.sql for existing databases.)
-- =====================================================================
create or replace function public.bill_variation(p_approval uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.approvals; o public.approval_options;
  d date; next_no int;
begin
  select * into a from public.approvals where id = p_approval;
  if a.id is null or a.status <> 'decided' then return; end if;
  select * into o from public.approval_options where id = a.chosen_option_id;
  if o.id is null or o.cost_delta = 0 then return; end if;
  if exists (select 1 from public.bills where approval_id = a.id) then return; end if;
  d := coalesce((a.decided_at at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date);
  perform pg_advisory_xact_lock(hashtext(a.project_id::text));
  select coalesce(max(number), 0) + 1 into next_no from public.bills where project_id = a.project_id;
  insert into public.bills (project_id, number, title, amount, details, status, due_date, kind, approval_id)
  values (a.project_id, next_no,
          case when o.cost_delta > 0 then 'Variation · ' else 'Variation credit · ' end || a.title,
          o.cost_delta,
          concat_ws(' · ', nullif(a.reference, ''), o.name,
                    'approved by ' || coalesce(nullif(a.decided_by_name, ''), 'client') || ' on ' || to_char(d, 'DD Mon YYYY'),
                    case when o.cost_delta < 0 then 'reduces the amount due' end),
          'due', d, 'variation', a.id)
  on conflict do nothing;
end;
$$;
revoke all on function public.bill_variation(uuid) from public, anon, authenticated;

create or replace function public.decide_approval(p_approval uuid, p_option uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.approvals; o public.approval_options; who text;
begin
  select * into a from public.approvals where id = p_approval for update;
  if a.id is null then raise exception 'Decision not found'; end if;
  if not public.can_view_project(a.project_id) then raise exception 'Not allowed'; end if;
  if a.status <> 'open' then raise exception 'This decision is already closed'; end if;
  select * into o from public.approval_options where id = p_option and approval_id = p_approval;
  if o.id is null then raise exception 'Option not found'; end if;
  select coalesce(nullif(full_name, ''), nullif(phone, ''), email) into who from public.profiles where id = auth.uid();
  update public.approvals
     set status = 'decided', chosen_option_id = o.id, decided_by = auth.uid(),
         decided_by_name = coalesce(who, ''), decided_at = now()
   where id = a.id;
  perform public.bill_variation(a.id);     -- extra cost or saving → bill on the same date
end;
$$;
grant execute on function public.decide_approval(uuid, uuid) to authenticated;

-- Bill decisions that were approved before this change
select public.bill_variation(id) from public.approvals where status = 'decided';
-- =====================================================================
-- Migration 07: several stages in progress at once, each with its own %
--  * stages.progress (0–100). Done = 100, Upcoming = 0.
--  * The project's overall % and "current work" line are worked out from
--    the stages automatically (each stage counts equally).
-- (Also available alone as migration-07-stage-progress.sql for existing databases.)
-- =====================================================================
alter table public.stages add column if not exists progress smallint not null default 0;
do $$ begin
  alter table public.stages add constraint stages_progress_range check (progress between 0 and 100);
exception when duplicate_object then null; end $$;

-- Keep status and % consistent
create or replace function public.stage_progress_fix() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' then new.progress := 100;
  elsif new.status = 'upcoming' then new.progress := 0;
  elsif new.status = 'current' and new.progress >= 100 then new.progress := 99;
  end if;
  return new;
end;
$$;
drop trigger if exists stage_progress_fix on public.stages;
create trigger stage_progress_fix before insert or update of status, progress on public.stages
  for each row execute function public.stage_progress_fix();

-- Project overall % and current-work line from its stages
create or replace function public.refresh_project_progress(p_project uuid) returns void
language plpgsql security definer set search_path = public as $$
declare total int; pct int; label text;
begin
  select count(*), coalesce(round(sum(progress)::numeric / nullif(count(*), 0)), 0)
    into total, pct from public.stages where project_id = p_project;
  if total = 0 then return; end if;
  select string_agg(name, ' · ' order by position) into label
    from public.stages where project_id = p_project and status = 'current';
  if label is null then
    select 'Next: ' || name into label from public.stages
     where project_id = p_project and status = 'upcoming' order by position limit 1;
  end if;
  update public.projects
     set percent_complete = pct, stage_label = coalesce(label, 'All stages completed')
   where id = p_project;
end;
$$;

create or replace function public.stages_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_project_progress(coalesce(new.project_id, old.project_id));
  return null;
end;
$$;
drop trigger if exists stages_changed on public.stages;
create trigger stages_changed after insert or update or delete on public.stages
  for each row execute function public.stages_changed();

-- Bring existing data in line
update public.stages set progress = 100 where status = 'done' and progress <> 100;
select public.refresh_project_progress(id) from public.projects;
-- =====================================================================
-- Migration 08: cancel a choice already made on a decision
--  * Client (or staff) can cancel a chosen option; the decision opens again
--  * Its variation bill/credit is cancelled too, as long as it isn't paid
--  * A note is posted in the project chat so the PM knows
-- (Also available alone as migration-08-undo-decision.sql for existing databases.)
-- =====================================================================
create or replace function public.undo_decision(p_approval uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  a public.approvals; o public.approval_options; b public.bills;
  who text; staff boolean := public.is_staff(); note text;
begin
  select * into a from public.approvals where id = p_approval for update;
  if a.id is null then raise exception 'Decision not found'; end if;
  if not public.can_view_project(a.project_id) then raise exception 'Not allowed'; end if;
  if a.status <> 'decided' then raise exception 'This decision has no choice to cancel'; end if;
  select * into o from public.approval_options where id = a.chosen_option_id;
  select * into b from public.bills where approval_id = a.id;
  if b.id is not null and b.status = 'paid' then
    raise exception 'The bill for this change is already paid. Please contact your project manager to cancel it.';
  end if;

  if b.id is not null then delete from public.bills where id = b.id; end if;
  update public.approvals
     set status = 'open', chosen_option_id = null, decided_by = null, decided_by_name = '', decided_at = null
   where id = a.id;

  select coalesce(nullif(full_name, ''), nullif(phone, ''), email) into who from public.profiles where id = auth.uid();
  note := case when staff then 'Reopened the decision "' else 'I cancelled my choice on "' end
          || a.title || '"' || coalesce(' (was: ' || o.name || ')', '')
          || case when b.id is not null then '. Bill ' || lpad(b.number::text, 2, '0') || ' has been cancelled.' else '.' end
          || case when staff then '' else ' I will choose again.' end;
  insert into public.messages (project_id, sender_id, sender_name, from_staff, body)
  values (a.project_id, auth.uid(), coalesce(who, ''), staff, note);
  return case when b.id is not null then 'bill_cancelled' else 'reopened' end;
end;
$$;
revoke all on function public.undo_decision(uuid) from public, anon;
grant execute on function public.undo_decision(uuid) to authenticated;
-- =====================================================================
-- Migration 09: notifications for clients (bell + phone push + email)
--  * A notification is created automatically when staff add something
--    the client should know about (bill due, decision, daily log, update,
--    message, document, stage done, payment received).
--  * The app shows them under the bell; each new one is also handed to the
--    'notify' Edge Function, which sends phone push and email.
-- (Also available alone as migration-09-notifications.sql for existing databases.)
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
-- =====================================================================
-- Migration 10: videos in the daily site log
--  Site log media can now be a photo or a video (stored the same way).
-- (Also available alone as migration-10-log-videos.sql for existing databases.)
-- =====================================================================
alter table public.site_log_photos add column if not exists kind text not null default 'image';
do $$ begin
  alter table public.site_log_photos add constraint site_log_photos_kind check (kind in ('image','video'));
exception when duplicate_object then null; end $$;

-- =====================================================================
-- Migration 11: day planner (tomorrow's work plan for every site)
--  Staff fill in the next day's plan for each site every evening:
--  works with team and number of workers, materials, machinery, remarks.
--  Only admins see all plans. Staff see only the plans they wrote.
--  Clients never see them.
-- Run once in Supabase → SQL Editor, after schema.sql. Safe to run again.
-- =====================================================================
create table if not exists public.day_plans (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  plan_date   date not null,
  supervisor  text not null default '',          -- site in-charge for the day
  start_time  text not null default '',          -- e.g. 08:00
  tasks       jsonb not null default '[]'::jsonb  -- [{work, team, workers}]
              check (jsonb_typeof(tasks) = 'array'),
  materials   text not null default '',          -- materials to deliver / keep ready
  equipment   text not null default '',          -- machinery, tools, vehicles
  remarks     text not null default '',
  status      text not null default 'submitted' check (status in ('submitted','approved','changes')),
  admin_note  text not null default '',
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists day_plans_one_per_person
  on public.day_plans (project_id, plan_date, created_by);
create index if not exists day_plans_date_idx on public.day_plans (plan_date);

-- Staff can't approve their own plans, and can't change plans for past days.
create or replace function public.day_plan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.updated_at := now();
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.status := 'submitted';
    new.admin_note := '';
  else
    if old.plan_date < today then raise exception 'Plans for past days can no longer be changed'; end if;
    new.created_by := old.created_by;
    new.admin_note := old.admin_note;
    new.status := 'submitted';            -- edited again → admin reviews again
  end if;
  if new.plan_date < today then raise exception 'Pick today or a future date for the plan'; end if;
  return new;
end $$;
drop trigger if exists day_plan_guard on public.day_plans;
create trigger day_plan_guard before insert or update on public.day_plans
  for each row execute function public.day_plan_guard();

alter table public.day_plans enable row level security;
drop policy if exists "admin or author reads day plans" on public.day_plans;
create policy "admin or author reads day plans" on public.day_plans
  for select to authenticated using (public.is_admin() or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "staff add day plans" on public.day_plans;
create policy "staff add day plans" on public.day_plans
  for insert to authenticated with check (public.is_staff());
drop policy if exists "admin or author edits day plans" on public.day_plans;
create policy "admin or author edits day plans" on public.day_plans
  for update to authenticated using (public.is_admin() or (public.is_staff() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes day plans" on public.day_plans;
create policy "admin or author deletes day plans" on public.day_plans
  for delete to authenticated using (public.is_admin() or (public.is_staff() and created_by = auth.uid() and plan_date >= (now() at time zone 'Asia/Kolkata')::date));

grant select, insert, update, delete on public.day_plans to authenticated;
revoke all on public.day_plans from anon;

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

-- =====================================================================
-- Migration 13: daily overdue-payment reminder to clients
--  Every morning at 10:00 am IST (8:30 am UAE) each project with unpaid
--  bills past their due date gets ONE reminder: bell + phone push + email.
--  It stops by itself when the bills are marked paid. Staff can switch it
--  off per project (Overview tab), e.g. when extra time was agreed.
-- Run once in Supabase → SQL Editor, after migration 12. Safe to run again.
-- =====================================================================
alter table public.projects add column if not exists overdue_reminders boolean not null default true;

create or replace function public.overdue_payment_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  p record; b record; lines text; total numeric; credits numeric; net numeric; cnt int; n int := 0;
begin
  for p in
    select pr.id, pr.name from public.projects pr
     where not pr.archived and pr.overdue_reminders
       and exists (select 1 from public.bills x where x.project_id = pr.id and x.status = 'due'
                     and x.amount > 0 and x.due_date < today)
       -- only once a day, even if run twice
       and not exists (select 1 from public.notifications nt where nt.project_id = pr.id and nt.kind = 'bill'
                         and nt.title like 'Payment overdue%' and (nt.created_at at time zone 'Asia/Kolkata')::date = today)
  loop
    lines := ''; total := 0; cnt := 0;
    for b in
      select number, title, amount, due_date from public.bills
       where project_id = p.id and status = 'due' and amount > 0 and due_date < today order by due_date, number
    loop
      cnt := cnt + 1;
      if cnt <= 2 then
        lines := lines || 'Bill ' || lpad(b.number::text, 2, '0') || ' · ' || left(b.title, 30) || ' — ' || public.inr_text(b.amount)
              || ', due ' || to_char(b.due_date, 'DD Mon') || ' (' || (today - b.due_date)
              || case when today - b.due_date = 1 then ' day' else ' days' end || ' overdue)' || E'\n';
      end if;
      total := total + b.amount;
    end loop;
    if cnt > 2 then lines := lines || '+ ' || (cnt - 2) || ' more overdue bill(s)' || E'\n'; end if;
    select coalesce(sum(amount), 0) into credits from public.bills where project_id = p.id and status = 'due' and amount < 0;
    net := total + credits;                       -- credits are negative
    if net <= 0 then continue; end if;
    perform public.notify(p.id, 'bill',
      'Payment overdue: ' || public.inr_text(net),
      lines
      || case when credits < 0 then 'Less credit ' || public.inr_text(-credits) || E'\n' else '' end
      || 'Kindly pay at the earliest. Bank details: Payments in the app. Already paid? Please share the transfer reference.',
      '/payments');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.overdue_payment_reminders() from public, anon, authenticated;

-- 04:30 UTC = 10:00 am IST
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'overdue-payment-reminders';
end $$;
select cron.schedule('overdue-payment-reminders', '30 4 * * *', 'select public.overdue_payment_reminders()');

-- =====================================================================
-- Migration 14: day planner open to all staff + same-day changes by admin
--  * Every staff member can now see all sites' plans (clients still can't).
--    Staff still edit only their own plans; admins can edit any plan.
--  * When an admin changes someone else's plan (e.g. that morning), the plan
--    is marked "Changed by admin" with the time, and the staff member who
--    wrote it gets an alert (bell + phone) with the admin's note.
-- Run once in Supabase → SQL Editor, after migration 13. Safe to run again.
-- =====================================================================
alter table public.day_plans add column if not exists changed_at timestamptz;
alter table public.day_plans add column if not exists changed_by uuid references public.profiles(id) on delete set null;

drop policy if exists "admin or author reads day plans" on public.day_plans;
drop policy if exists "staff read day plans" on public.day_plans;
create policy "staff read day plans" on public.day_plans
  for select to authenticated using (public.is_staff());

-- Guard: keep staff rules, and stamp admin changes to other people's plans
create or replace function public.day_plan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.updated_at := now();
  if auth.uid() is null then return new; end if;
  if public.is_admin() then
    if tg_op = 'UPDATE' and old.created_by is distinct from auth.uid()
       and (new.tasks, new.materials, new.equipment, new.remarks, new.supervisor, new.start_time)
           is distinct from (old.tasks, old.materials, old.equipment, old.remarks, old.supervisor, old.start_time) then
      new.changed_at := now();
      new.changed_by := auth.uid();
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.status := 'submitted';
    new.admin_note := '';
    new.changed_at := null; new.changed_by := null;
  else
    if old.plan_date < today then raise exception 'Plans for past days can no longer be changed'; end if;
    new.created_by := old.created_by;
    new.admin_note := old.admin_note;
    new.changed_at := old.changed_at; new.changed_by := old.changed_by;
    new.status := 'submitted';            -- edited again → admin reviews again
  end if;
  if new.plan_date < today then raise exception 'Pick today or a future date for the plan'; end if;
  return new;
end $$;

-- Alert the author when the admin changes their plan
create or replace function public.trg_day_plan_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text;
begin
  if new.changed_at is distinct from old.changed_at and new.changed_at is not null and new.created_by is not null
     and new.created_by is distinct from auth.uid() then
    select name into site from public.projects where id = new.project_id;
    perform public.notify_staff(new.created_by, 'plan_review',
      'Plan changed by admin: ' || site || ' (' || to_char(new.plan_date, 'Dy DD Mon') || ')',
      coalesce(nullif(new.admin_note, ''), 'Open the day planner to see the changes.'),
      '/admin/planner?date=' || new.plan_date);
  end if;
  return null;
end $$;
drop trigger if exists day_plan_changed on public.day_plans;
create trigger day_plan_changed after update on public.day_plans
  for each row execute function public.trg_day_plan_changed();

-- =====================================================================
-- Migration 15: site leave (no work that day) + admin approval of the whole day
--  * Staff can mark a site as "off" for a day with a reason (rain, material not
--    arrived, client function ...). The admin approves or rejects it.
--  * The admin approves the whole day's plan with one button. Only after that
--    can staff make the PDF / print of that day's working sites.
--  * If staff change a plan or a leave for that day afterwards, the day's
--    approval is cleared and the admin is told, so it gets checked again.
-- Run once in Supabase → SQL Editor, after migration 14. Safe to run again.
-- =====================================================================
create table if not exists public.site_leaves (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  leave_date  date not null,
  reason      text not null check (length(trim(reason)) > 0),
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note  text not null default '',
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists site_leaves_one_per_day on public.site_leaves (project_id, leave_date);
create index if not exists site_leaves_date_idx on public.site_leaves (leave_date);

create table if not exists public.day_approvals (
  plan_date    date primary key,
  approved_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  approved_at  timestamptz not null default now()
);

-- Staff rules for leaves: always start as 'pending', can't decide their own,
-- can't change past days; an edit after a decision goes back to 'pending'.
create or replace function public.site_leave_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.updated_at := now();
  if auth.uid() is null then return new; end if;
  if public.is_admin() then
    if tg_op = 'INSERT' then
      new.created_by := coalesce(new.created_by, auth.uid());
      if new.created_by = auth.uid() and new.status = 'pending' then new.status := 'approved'; end if;  -- admin's own: approved
    end if;
    if new.status <> 'pending' and (tg_op = 'INSERT' or new.status is distinct from old.status) then
      new.decided_by := auth.uid(); new.decided_at := now();
    end if;
    return new;
  end if;
  if new.leave_date < today then raise exception 'Pick today or a future date'; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    if old.leave_date < today then raise exception 'Past days can no longer be changed'; end if;
    new.created_by := old.created_by;
  end if;
  new.status := 'pending'; new.admin_note := case when tg_op = 'INSERT' then '' else old.admin_note end;
  new.decided_by := null; new.decided_at := null;
  return new;
end $$;
drop trigger if exists site_leave_guard on public.site_leaves;
create trigger site_leave_guard before insert or update on public.site_leaves
  for each row execute function public.site_leave_guard();

alter table public.site_leaves enable row level security;
drop policy if exists "staff read site leaves" on public.site_leaves;
create policy "staff read site leaves" on public.site_leaves for select to authenticated using (public.is_staff());
drop policy if exists "staff add site leaves" on public.site_leaves;
create policy "staff add site leaves" on public.site_leaves for insert to authenticated with check (public.is_staff());
drop policy if exists "admin or author edits site leaves" on public.site_leaves;
create policy "admin or author edits site leaves" on public.site_leaves for update to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes site leaves" on public.site_leaves;
create policy "admin or author deletes site leaves" on public.site_leaves for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid() and status <> 'approved'));
grant select, insert, update, delete on public.site_leaves to authenticated;
revoke all on public.site_leaves from anon;

alter table public.day_approvals enable row level security;
drop policy if exists "staff read day approvals" on public.day_approvals;
create policy "staff read day approvals" on public.day_approvals for select to authenticated using (public.is_staff());
drop policy if exists "admin approves days" on public.day_approvals;
create policy "admin approves days" on public.day_approvals for insert to authenticated with check (public.is_admin());
drop policy if exists "admin removes day approvals" on public.day_approvals;
create policy "admin removes day approvals" on public.day_approvals for delete to authenticated using (public.is_admin());
grant select, insert, delete on public.day_approvals to authenticated;
revoke all on public.day_approvals from anon;

-- ---------------------------------------------------------------- alerts
create or replace function public.trg_site_leave_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text; who text; a record; d text;
begin
  select name into site from public.projects where id = new.project_id;
  select coalesce(nullif(full_name, ''), email, 'Staff') into who from public.profiles where id = new.created_by;
  d := to_char(new.leave_date, 'Dy DD Mon');
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending' or old.reason <> new.reason) then
    for a in select id from public.profiles where role = 'admin' and id is distinct from new.created_by loop
      perform public.notify_staff(a.id, 'plan_new', 'Site off requested: ' || site || ' (' || d || ')',
        who || ' · ' || new.reason, '/admin/planner?date=' || new.leave_date);
    end loop;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved','rejected')
        and new.created_by is not null and new.created_by is distinct from auth.uid() then
    perform public.notify_staff(new.created_by, 'plan_review',
      case when new.status = 'approved' then 'Site off approved: ' else 'Site off rejected: ' end || site || ' (' || d || ')',
      coalesce(nullif(new.admin_note, ''), new.reason), '/admin/planner?date=' || new.leave_date);
  end if;
  return null;
end $$;
drop trigger if exists site_leave_alerts on public.site_leaves;
create trigger site_leave_alerts after insert or update on public.site_leaves
  for each row execute function public.trg_site_leave_alerts();

-- Day approved → tell all staff the PDF is ready
create or replace function public.trg_day_approved() returns trigger
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  for s in select id from public.profiles where role = 'staff' loop
    perform public.notify_staff(s.id, 'plan_review', 'Day plan approved: ' || to_char(new.plan_date, 'Dy DD Mon'),
      'You can now make the PDF of the working sites.', '/admin/planner?date=' || new.plan_date);
  end loop;
  return null;
end $$;
drop trigger if exists day_approved on public.day_approvals;
create trigger day_approved after insert on public.day_approvals
  for each row execute function public.trg_day_approved();

-- Staff change after approval → clear the day's approval and tell admins
create or replace function public.trg_clear_day_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date; site text; a record; n int;
begin
  if auth.uid() is null or public.is_admin() then return null; end if;
  if tg_table_name = 'day_plans' then d := coalesce(new.plan_date, old.plan_date);
  else d := coalesce(new.leave_date, old.leave_date); end if;
  delete from public.day_approvals where plan_date = d;
  get diagnostics n = row_count;
  if n > 0 then
    select name into site from public.projects where id = coalesce(new.project_id, old.project_id);
    for a in select id from public.profiles where role = 'admin' loop
      perform public.notify_staff(a.id, 'plan_new', 'Day plan needs approval again: ' || to_char(d, 'Dy DD Mon'),
        'Changed after approval: ' || site || '. Staff can''t make the PDF until you approve again.', '/admin/planner?date=' || d);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists day_plans_clear_approval on public.day_plans;
create trigger day_plans_clear_approval after insert or update or delete on public.day_plans
  for each row execute function public.trg_clear_day_approval();
drop trigger if exists site_leaves_clear_approval on public.site_leaves;
create trigger site_leaves_clear_approval after insert or update or delete on public.site_leaves
  for each row execute function public.trg_clear_day_approval();

-- ---------------------------------------------------------------- reminders skip sites marked off
create or replace function public.day_plan_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare tmr date := (now() at time zone 'Asia/Kolkata')::date + 1; s record; n int := 0;
begin
  for s in
    with missing as (
      select p.id, p.name from public.projects p
       where not p.archived
         and not exists (select 1 from public.day_plans d where d.project_id = p.id and d.plan_date = tmr)
         and not exists (select 1 from public.site_leaves l where l.project_id = p.id and l.leave_date = tmr and l.status <> 'rejected')
    ), recent as (
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
      'Please add tomorrow''s work plan for: ' || s.sites || '. If a site has no work, mark it as off with the reason.', '/admin/planner');
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.day_plan_admin_summary() returns int
language plpgsql security definer set search_path = public as $$
declare tmr date := (now() at time zone 'Asia/Kolkata')::date + 1;
        total int; planned int; off int; waiting int; leaves int; missing text; a record; n int := 0; msg text;
begin
  select count(*) into total from public.projects where not archived;
  select count(distinct l.project_id) into off from public.site_leaves l
    join public.projects p on p.id = l.project_id and not p.archived where l.leave_date = tmr and l.status = 'approved';
  select count(distinct d.project_id) into planned from public.day_plans d
    join public.projects p on p.id = d.project_id and not p.archived where d.plan_date = tmr;
  select count(*) into waiting from public.day_plans where plan_date = tmr and status = 'submitted';
  select count(*) into leaves from public.site_leaves where leave_date = tmr and status = 'pending';
  select string_agg(p.name, ', ' order by p.name) into missing from public.projects p
   where not p.archived and not exists (select 1 from public.day_plans d where d.project_id = p.id and d.plan_date = tmr)
     and not exists (select 1 from public.site_leaves l where l.project_id = p.id and l.leave_date = tmr and l.status <> 'rejected');
  if total = 0 then return 0; end if;
  if missing is null and waiting = 0 and leaves = 0 and exists (select 1 from public.day_approvals where plan_date = tmr) then return 0; end if;
  msg := planned || ' of ' || (total - off) || ' working sites planned'
      || case when off > 0 then ' (' || off || ' off)' else '' end || '.'
      || coalesce(' Still missing: ' || missing || '.', '')
      || case when waiting > 0 then ' ' || waiting || ' plan(s) to review.' else '' end
      || case when leaves > 0 then ' ' || leaves || ' site-off request(s) waiting.' else '' end
      || case when not exists (select 1 from public.day_approvals where plan_date = tmr) then ' Approve the day so staff can make the PDF.' else '' end;
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify_staff(a.id, 'plan_summary', 'Tomorrow''s day plan: ' || planned || '/' || (total - off) || ' sites', msg, '/admin/planner');
    n := n + 1;
  end loop;
  return n;
end;
$$;

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

-- =====================================================================
-- Migration 19: evening DPR (daily progress report) + weekly planner
--  DPR — internal, staff only (clients never see it). One per site per
--  staff member per day: planned works with done / partly / not done,
--  labour by trade, materials received / used, machinery, issues.
--   * 7:00 pm IST: staff reminded for today's planned sites without a DPR
--   * 9:00 pm IST: admins get the list of planned sites still without a DPR
--  Weekly plan — one per site per week (week starts Monday). Staff plan the
--  next week every Saturday; the admin approves / asks for changes / edits.
--   * Saturday 5:00 pm IST: staff reminded for sites without next week's plan
--   * Saturday 9:00 pm IST: admins get the list still missing
-- Run once in Supabase → SQL Editor, after migration 18. Safe to run again.
-- =====================================================================

-- ================================================================ DPR
create table if not exists public.dprs (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  report_date         date not null,
  works               jsonb not null default '[]'::jsonb check (jsonb_typeof(works) = 'array'),   -- [{work, status, qty, remarks}]
  labour              jsonb not null default '[]'::jsonb check (jsonb_typeof(labour) = 'array'),  -- [{trade, count}]
  materials_received  text not null default '',
  materials_used      text not null default '',
  machinery           text not null default '',
  issues              text not null default '',
  next_day            text not null default '',
  status              text not null default 'submitted' check (status in ('submitted','reviewed')),
  admin_note          text not null default '',
  created_by          uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists dprs_one_per_person on public.dprs (project_id, report_date, created_by);
create index if not exists dprs_date_idx on public.dprs (report_date);

-- Staff can write today's DPR, and finish yesterday's (late evening / after midnight).
create or replace function public.dpr_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.updated_at := now();
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.report_date > today or new.report_date < today - 1 then raise exception 'A DPR can be written for today (or finished for yesterday)'; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.status := 'submitted'; new.admin_note := '';
  else
    if old.report_date < today - 1 then raise exception 'This DPR can no longer be changed'; end if;
    new.created_by := old.created_by; new.admin_note := old.admin_note; new.status := 'submitted';
  end if;
  return new;
end $$;
drop trigger if exists dpr_guard on public.dprs;
create trigger dpr_guard before insert or update on public.dprs for each row execute function public.dpr_guard();

alter table public.dprs enable row level security;
drop policy if exists "staff read dprs" on public.dprs;
create policy "staff read dprs" on public.dprs for select to authenticated using (public.is_staff());
drop policy if exists "staff add dprs" on public.dprs;
create policy "staff add dprs" on public.dprs for insert to authenticated with check (public.is_staff());
drop policy if exists "admin or author edits dprs" on public.dprs;
create policy "admin or author edits dprs" on public.dprs for update to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes dprs" on public.dprs;
create policy "admin or author deletes dprs" on public.dprs for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid() and report_date >= (now() at time zone 'Asia/Kolkata')::date - 1));
grant select, insert, update, delete on public.dprs to authenticated;
revoke all on public.dprs from anon;

create or replace function public.trg_dpr_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text; who text; a record; total int;
begin
  select name into site from public.projects where id = new.project_id;
  select coalesce(nullif(full_name, ''), email, 'Staff') into who from public.profiles where id = new.created_by;
  if tg_op = 'INSERT' then
    select coalesce(sum(nullif(x->>'count', '')::int), 0) into total from jsonb_array_elements(new.labour) x
     where (x->>'count') ~ '^[0-9]+$';
    for a in select id from public.profiles where role = 'admin' and id is distinct from new.created_by loop
      perform public.notify_staff(a.id, 'plan_new', 'DPR: ' || site || ' (' || to_char(new.report_date, 'Dy DD Mon') || ')',
        who || ' · ' || jsonb_array_length(new.works) || ' work(s) · ' || total || ' workers'
        || case when new.issues <> '' then ' · Issues: ' || left(new.issues, 80) else '' end,
        '/admin/dpr?date=' || new.report_date);
    end loop;
  elsif new.status = 'reviewed' and old.status <> 'reviewed' and new.admin_note <> ''
        and new.created_by is not null and new.created_by is distinct from auth.uid() then
    perform public.notify_staff(new.created_by, 'plan_review', 'DPR reviewed: ' || site, new.admin_note, '/admin/dpr?date=' || new.report_date);
  end if;
  return null;
end $$;
drop trigger if exists dpr_alerts on public.dprs;
create trigger dpr_alerts after insert or update of status on public.dprs for each row execute function public.trg_dpr_alerts();

-- 7 pm: remind staff (sites planned today, not off, without a DPR)
create or replace function public.dpr_staff_reminder() returns int
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date; s record; n int := 0;
begin
  for s in
    with missing as (
      select distinct p.id, p.name, dp.created_by, pr.role
        from public.projects p
        join public.day_plans dp on dp.project_id = p.id and dp.plan_date = d
        left join public.profiles pr on pr.id = dp.created_by
       where not p.archived
         and not exists (select 1 from public.dprs r where r.project_id = p.id and r.report_date = d)
         and not exists (select 1 from public.site_leaves sl where sl.project_id = p.id and sl.leave_date = d and sl.status = 'approved')
    ), targets as (
      select m.name, m.created_by as user_id from missing m where m.role = 'staff'
      union
      select m.name, st.id from missing m cross join public.profiles st
       where st.role = 'staff' and m.role is distinct from 'staff'
         and not exists (select 1 from missing m2 where m2.id = m.id and m2.role = 'staff')
    )
    select user_id, string_agg(name, ', ' order by name) as sites, count(*) as cnt from targets group by user_id
  loop
    perform public.notify_staff(s.user_id, 'plan_reminder',
      'Today''s DPR needed: ' || s.cnt || case when s.cnt = 1 then ' site' else ' sites' end,
      'Please send today''s progress report (DPR) for: ' || s.sites || '.', '/admin/dpr');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.dpr_staff_reminder() from public, anon, authenticated;

-- 9 pm: tell admins which planned sites still have no DPR
create or replace function public.dpr_admin_alert() returns int
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date; list text; cnt int; a record; n int := 0;
begin
  select string_agg(x.line, E'\n' order by x.name), count(*) into list, cnt from (
    select p.name, p.name || ' — planned by ' || coalesce(string_agg(distinct coalesce(nullif(pr.full_name, ''), 'staff'), ', '), 'staff') as line
      from public.projects p
      join public.day_plans dp on dp.project_id = p.id and dp.plan_date = d
      left join public.profiles pr on pr.id = dp.created_by
     where not p.archived
       and not exists (select 1 from public.dprs r where r.project_id = p.id and r.report_date = d)
       and not exists (select 1 from public.site_leaves sl where sl.project_id = p.id and sl.leave_date = d and sl.status = 'approved')
     group by p.id, p.name) x;
  if coalesce(cnt, 0) = 0 then return 0; end if;
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify_staff(a.id, 'plan_summary',
      'DPR missing: ' || cnt || case when cnt = 1 then ' site' else ' sites' end || ' (' || to_char(d, 'Dy DD Mon') || ')',
      'Planned today but no DPR yet:' || E'\n' || list, '/admin/dpr?date=' || d);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.dpr_admin_alert() from public, anon, authenticated;

-- ================================================================ weekly plans
create table if not exists public.weekly_plans (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  week_start  date not null check (extract(isodow from week_start) = 1),   -- Monday
  items       jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),   -- [{work, target, days, team}]
  materials   text not null default '',
  remarks     text not null default '',
  status      text not null default 'submitted' check (status in ('submitted','approved','changes')),
  admin_note  text not null default '',
  changed_at  timestamptz,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists weekly_plans_one_per_person on public.weekly_plans (project_id, week_start, created_by);
create index if not exists weekly_plans_week_idx on public.weekly_plans (week_start);

create or replace function public.weekly_plan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare this_week date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date;
begin
  new.updated_at := now();
  if auth.uid() is null then return new; end if;
  if public.is_admin() then
    if tg_op = 'UPDATE' and old.created_by is distinct from auth.uid()
       and (new.items, new.materials, new.remarks) is distinct from (old.items, old.materials, old.remarks) then
      new.changed_at := now();
    end if;
    return new;
  end if;
  if new.week_start < this_week then raise exception 'Pick this week or a later week'; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.status := 'submitted'; new.admin_note := ''; new.changed_at := null;
  else
    if old.week_start < this_week then raise exception 'Past weeks can no longer be changed'; end if;
    new.created_by := old.created_by; new.admin_note := old.admin_note; new.changed_at := old.changed_at;
    new.status := 'submitted';
  end if;
  return new;
end $$;
drop trigger if exists weekly_plan_guard on public.weekly_plans;
create trigger weekly_plan_guard before insert or update on public.weekly_plans for each row execute function public.weekly_plan_guard();

alter table public.weekly_plans enable row level security;
drop policy if exists "staff read weekly plans" on public.weekly_plans;
create policy "staff read weekly plans" on public.weekly_plans for select to authenticated using (public.is_staff());
drop policy if exists "staff add weekly plans" on public.weekly_plans;
create policy "staff add weekly plans" on public.weekly_plans for insert to authenticated with check (public.is_staff());
drop policy if exists "admin or author edits weekly plans" on public.weekly_plans;
create policy "admin or author edits weekly plans" on public.weekly_plans for update to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "admin or author deletes weekly plans" on public.weekly_plans;
create policy "admin or author deletes weekly plans" on public.weekly_plans for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()
         and week_start >= date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date));
grant select, insert, update, delete on public.weekly_plans to authenticated;
revoke all on public.weekly_plans from anon;

create or replace function public.trg_weekly_plan_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text; who text; a record; wk text;
begin
  select name into site from public.projects where id = new.project_id;
  select coalesce(nullif(full_name, ''), email, 'Staff') into who from public.profiles where id = new.created_by;
  wk := 'week of ' || to_char(new.week_start, 'DD Mon');
  if tg_op = 'INSERT' or (old.status <> 'submitted' and new.status = 'submitted') then
    for a in select id from public.profiles where role = 'admin' and id is distinct from new.created_by loop
      perform public.notify_staff(a.id, 'plan_new',
        case when tg_op = 'INSERT' then 'New weekly plan: ' else 'Weekly plan updated: ' end || site,
        who || ' · ' || wk || ' · ' || jsonb_array_length(new.items) || ' work(s)', '/admin/weekly?week=' || new.week_start);
    end loop;
  elsif new.created_by is not null and new.created_by is distinct from auth.uid() then
    if new.status is distinct from old.status and new.status in ('approved','changes') then
      perform public.notify_staff(new.created_by, 'plan_review',
        case when new.status = 'approved' then 'Weekly plan approved: ' else 'Changes asked: weekly plan ' end || site,
        wk || coalesce(' · ' || nullif(new.admin_note, ''), ''), '/admin/weekly?week=' || new.week_start);
    elsif new.changed_at is distinct from old.changed_at and new.changed_at is not null then
      perform public.notify_staff(new.created_by, 'plan_review', 'Weekly plan changed by admin: ' || site,
        wk || coalesce(' · ' || nullif(new.admin_note, ''), ''), '/admin/weekly?week=' || new.week_start);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists weekly_plan_alerts on public.weekly_plans;
create trigger weekly_plan_alerts after insert or update on public.weekly_plans for each row execute function public.trg_weekly_plan_alerts();

-- Saturday 5 pm: remind staff about next week's plan
create or replace function public.weekly_plan_reminder() returns int
language plpgsql security definer set search_path = public as $$
declare nxt date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date + 7; s record; n int := 0;
begin
  for s in
    with missing as (
      select p.id, p.name from public.projects p
       where not p.archived and not exists (select 1 from public.weekly_plans w where w.project_id = p.id and w.week_start = nxt)
    ), recent as (   -- who planned each site in the last 14 days
      select distinct d.project_id, d.created_by as user_id from public.day_plans d
        join public.profiles pr on pr.id = d.created_by and pr.role = 'staff'
       where d.plan_date between nxt - 21 and nxt - 1
    ), targets as (
      select m.name, r.user_id from missing m join recent r on r.project_id = m.id
      union
      select m.name, pr.id from missing m cross join public.profiles pr
       where pr.role = 'staff' and not exists (select 1 from recent r where r.project_id = m.id)
    )
    select user_id, string_agg(name, ', ' order by name) as sites, count(*) as cnt from targets group by user_id
  loop
    perform public.notify_staff(s.user_id, 'plan_reminder',
      'Next week''s plan needed: ' || s.cnt || case when s.cnt = 1 then ' site' else ' sites' end,
      'Please add the weekly plan (week of ' || to_char(nxt, 'DD Mon') || ') for: ' || s.sites || '.', '/admin/weekly?week=' || nxt);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.weekly_plan_reminder() from public, anon, authenticated;

-- Saturday 9 pm: tell admins what's missing / waiting
create or replace function public.weekly_plan_admin_summary() returns int
language plpgsql security definer set search_path = public as $$
declare nxt date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date + 7;
        total int; planned int; waiting int; missing text; a record; n int := 0;
begin
  select count(*) into total from public.projects where not archived;
  select count(distinct w.project_id) into planned from public.weekly_plans w join public.projects p on p.id = w.project_id and not p.archived where w.week_start = nxt;
  select count(*) into waiting from public.weekly_plans where week_start = nxt and status = 'submitted';
  select string_agg(p.name, ', ' order by p.name) into missing from public.projects p
   where not p.archived and not exists (select 1 from public.weekly_plans w where w.project_id = p.id and w.week_start = nxt);
  if total = 0 or (missing is null and waiting = 0) then return 0; end if;
  for a in select id from public.profiles where role = 'admin' loop
    perform public.notify_staff(a.id, 'plan_summary', 'Next week''s plans: ' || planned || '/' || total || ' sites',
      planned || ' of ' || total || ' sites planned for the week of ' || to_char(nxt, 'DD Mon') || '.'
      || coalesce(' Missing: ' || missing || '.', '')
      || case when waiting > 0 then ' ' || waiting || ' waiting for your review.' else '' end,
      '/admin/weekly?week=' || nxt);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.weekly_plan_admin_summary() from public, anon, authenticated;

-- ================================================================ schedules (UTC)
do $$ begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('dpr-staff-reminder', 'dpr-admin-alert', 'weekly-plan-reminder', 'weekly-plan-admin-summary');
end $$;
select cron.schedule('dpr-staff-reminder',        '30 13 * * *', 'select public.dpr_staff_reminder()');         -- 7:00 pm IST
select cron.schedule('dpr-admin-alert',           '30 15 * * *', 'select public.dpr_admin_alert()');            -- 9:00 pm IST
select cron.schedule('weekly-plan-reminder',      '30 11 * * 6', 'select public.weekly_plan_reminder()');       -- Sat 5:00 pm IST
select cron.schedule('weekly-plan-admin-summary', '30 15 * * 6', 'select public.weekly_plan_admin_summary()');  -- Sat 9:00 pm IST

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
