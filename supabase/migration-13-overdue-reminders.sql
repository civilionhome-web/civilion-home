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
