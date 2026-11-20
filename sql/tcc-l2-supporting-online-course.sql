-- Every TCC Level 2 live seminar includes the supporting online course
-- (TCC Level 2 online), and no other course does (Nathan, 20 Nov 2026).
-- Set by the database on every new or edited course, so it never depends
-- on someone ticking the box in the portal. The course that is granted is
-- chosen by brand and level (grantOnlineCourse), so a TCC Level 2 seminar
-- only ever gives TCC Level 2 online.

create or replace function public.courses_supporting_online_course()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.grants_online_course :=
    new.brand::text = 'tcc'
    and coalesce(new.type::text, '') = 'live_seminar'
    and regexp_replace(coalesce(new.level, ''), '\D', '', 'g') = '2';
  return new;
end;
$$;

drop trigger if exists courses_supporting_online_course on public.courses;
create trigger courses_supporting_online_course
  before insert or update on public.courses
  for each row execute function public.courses_supporting_online_course();

-- Every existing course already matched when this was added (20 Nov 2026:
-- Colchester, Liège, Arnhem, Gresham and the past Settimo San Pietro on,
-- everything else off), so nothing needed updating.
