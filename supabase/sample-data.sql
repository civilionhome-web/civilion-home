-- =====================================================================
-- OPTIONAL: loads the demo project from the design (Anil & Divya's Home,
-- Mannarkkad — example data) so you can see every screen filled in.
--
-- 1. Change the two values on the next lines: a phone (country code + number,
--    digits only) and/or an email YOU can sign in with as a "client".
-- 2. Run in Supabase → SQL Editor. Delete the project from the admin panel later.
-- =====================================================================
do $$
declare
  demo_phone text := '971501234567';     -- <- your test mobile, digits only
  demo_email text := '';                 -- <- or a test email
  pid uuid;
  a1 uuid; a2 uuid; o3 uuid;
begin
  insert into public.projects (name, location, client_greeting_name, stage_label, percent_complete, schedule_status,
    handover_target, contract_amount, boq_amount, client_currency, pm_name, pm_phone, payment_instructions)
  values ('Anil & Divya''s Home (demo)', 'Mannarkkad', 'Anil', 'First floor slab · curing', 53, 'On track',
    'Aug 2027', 6891200, 5840000, 'AED', 'Rahul Nair', '',
    E'Account name: Civilion Builders and Developers LLP\nBank: [YOUR BANK]\nAccount no: [ACCOUNT NO]\nIFSC: [IFSC]\nSWIFT: [SWIFT]\n\nAlways confirm these details with us on a call before your first transfer.')
  returning id into pid;

  insert into public.project_clients (project_id, display_name, phone_digits, email)
  values (pid, 'Demo client', demo_phone, demo_email);

  insert into public.stages (project_id, position, name, note, status) values
    (pid, 0, 'Agreement & mobilisation', 'Permit issued 28 Jul', 'done'),
    (pid, 1, 'Foundation & plinth', 'Completed 30 Aug', 'done'),
    (pid, 2, 'Ground floor slab', 'Cast 24 Sep · cube test passed', 'done'),
    (pid, 3, 'First floor slab / roof', 'Cast 6 Nov · curing till 20 Nov', 'current'),
    (pid, 4, 'Masonry & plastering', 'Target 15 Jan 2027', 'upcoming'),
    (pid, 5, 'Electrical, plumbing, flooring', 'Target Apr 2027', 'upcoming'),
    (pid, 6, 'Painting & finishing', 'Target Jul 2027', 'upcoming'),
    (pid, 7, 'Handover & OC', 'Target Aug 2027', 'upcoming');

  insert into public.updates (project_id, period, body) values
    (pid, '2–7 Nov', 'First floor slab cast on 6 Nov: 38 m³ of M20 concrete. 6 test cubes taken. Brickwork restarts 10 Nov.');

  insert into public.site_events (project_id, happened_at, text) values
    (pid, now() - interval '3 hours', 'Cement delivery, 220 bags'),
    (pid, now() - interval '1 hour', 'Engineer site visit');

  insert into public.bills (project_id, number, title, amount, percent_of_contract, details, status, due_date, paid_on) values
    (pid, 1, 'Agreement', 689120, 10, '', 'paid', null, '2026-06-14'),
    (pid, 2, 'Foundation & plinth', 1033680, 15, '', 'paid', null, '2026-09-06'),
    (pid, 3, 'Ground floor slab', 1033680, 15, '', 'paid', null, '2026-10-02'),
    (pid, 4, 'First floor slab', 1033680, 15, '6 BOQ items measured · 24 photos', 'due', current_date + 3, null);

  insert into public.approvals (project_id, title, description, due_date, reference)
  values (pid, 'Living room floor tile',
    'Pick one. Samples were shown on the 7 Nov video call. The upgrade is added as a variation order at the Annexure B rate.',
    current_date + 5, 'VO-03')
  returning id into a1;
  insert into public.approval_options (approval_id, project_id, position, name, detail, cost_delta) values
    (a1, pid, 0, 'Kajaria matt, Ivory', '800 × 800 mm · in BOQ item F1', 0),
    (a1, pid, 1, 'Somany glossy, Grey marble', '1200 × 600 mm · upgrade B1', 38400);

  insert into public.approvals (project_id, title, reference, status, decided_by_name, decided_at)
  values (pid, 'Store partition removed', 'VO-02', 'decided', 'Anil', now() - interval '20 days')
  returning id into a2;
  insert into public.approval_options (approval_id, project_id, position, name, cost_delta)
  values (a2, pid, 0, 'Remove partition', -9350) returning id into o3;
  update public.approvals set chosen_option_id = o3 where id = a2;
end $$;
