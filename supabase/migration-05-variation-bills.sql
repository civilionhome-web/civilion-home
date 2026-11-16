-- =====================================================================
-- Migration 05: variations (extra cost from decisions)
--  * Bills can be linked to the decision they came from (kind = variation)
--  * When a client approves an option with an extra cost, a bill for that
--    amount is created at the same moment, due the same day.
-- Run once in Supabase → SQL Editor, after schema.sql. Safe to run again.
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
