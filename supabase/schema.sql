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
