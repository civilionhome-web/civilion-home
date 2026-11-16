-- =====================================================================
-- Migration 02: add staff from the app (Team page)
-- An admin adds a name + email + role. When that person first signs in
-- (email code or password), they become Staff/Admin automatically.
-- If they already have an account, their role changes straight away.
-- Run once in Supabase → SQL Editor. Safe to run again.
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
