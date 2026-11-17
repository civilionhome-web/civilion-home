-- =====================================================================
-- Migration 07: several stages in progress at once, each with its own %
--  * stages.progress (0–100). Done = 100, Upcoming = 0.
--  * The project's overall % and "current work" line are worked out from
--    the stages automatically (each stage counts equally).
-- Run once in Supabase → SQL Editor, after schema.sql. Safe to run again.
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
