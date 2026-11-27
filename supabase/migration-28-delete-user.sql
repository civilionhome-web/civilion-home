-- =====================================================================
-- Migration 28: delete a user from the Team page
--  public.delete_user(target): removes the person's login for good.
--  * Admins can delete staff and clients; only the super admin can delete
--    an admin. Nobody can delete themselves or the super admin.
--  * Their staff invite is removed, and (for anyone) their phone/email is
--    taken off every project's client list, so signing in again gives them
--    no access.
--  * Their records stay (plans, logs, DPRs, messages, documents) with the
--    name left blank; their alerts and phone subscriptions are deleted.
-- Run once in Supabase -> SQL Editor, after migration 27. Safe to run again.
-- =====================================================================
create or replace function public.delete_user(target uuid) returns text
language plpgsql security definer set search_path = public, auth as $$
declare p public.profiles%rowtype; u_email text; u_phone text; digits text; n_clients int := 0;
begin
  if not public.is_admin() then raise exception 'Only an admin can delete users'; end if;
  if target = auth.uid() then raise exception 'You cannot delete your own login'; end if;
  select * into p from public.profiles where id = target;
  if not found then raise exception 'User not found'; end if;
  if p.is_super then raise exception 'The super admin cannot be deleted'; end if;
  if p.role = 'admin' and not public.is_super_admin() then raise exception 'Only the super admin can delete an admin'; end if;

  select email, phone into u_email, u_phone from auth.users where id = target;
  u_email := lower(coalesce(nullif(u_email, ''), nullif(p.email, ''), ''));
  digits := regexp_replace(coalesce(nullif(u_phone, ''), p.phone, ''), '\D', '', 'g');

  if digits <> '' or u_email <> '' then
    delete from public.project_clients pc
     where (digits <> '' and pc.phone_digits = digits) or (u_email <> '' and lower(coalesce(pc.email, '')) = u_email);
    get diagnostics n_clients = row_count;
    delete from public.staff_invites where u_email <> '' and lower(email) = u_email;
  end if;

  delete from auth.users where id = target;
  if not found then delete from public.profiles where id = target; end if;
  return coalesce(nullif(p.full_name, ''), 'User') || ' deleted' ||
         case when n_clients > 0 then ' and removed from ' || n_clients || ' project client list(s)' else '' end;
end $$;
revoke all on function public.delete_user(uuid) from public, anon;
grant execute on function public.delete_user(uuid) to authenticated;
