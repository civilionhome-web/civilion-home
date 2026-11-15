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
