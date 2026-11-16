-- =====================================================================
-- Migration 06: bill every approved variation, savings included
--  * Extra cost  → variation bill (+amount), due on the approval date
--  * Saving      → variation credit (−amount), dated the approval date;
--                  it reduces the amount due and the total project cost
--  * Decisions already approved without a bill get one now, dated on the
--    day they were approved.
-- Run once in Supabase → SQL Editor, after migration 05. Safe to run again.
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
