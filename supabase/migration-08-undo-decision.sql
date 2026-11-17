-- =====================================================================
-- Migration 08: cancel a choice already made on a decision
--  * Client (or staff) can cancel a chosen option; the decision opens again
--  * Its variation bill/credit is cancelled too, as long as it isn't paid
--  * A note is posted in the project chat so the PM knows
-- Run once in Supabase → SQL Editor, after migration 07. Safe to run again.
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
