-- 19 Nov 2026 security pass on BirdBox Learn. Parts A-C are already
-- applied to the live database. Part D waits until this PR is live.

-- A. Login-link requests: hashed connection id for the per-connection limit
alter table public.directory_link_sends add column if not exists ip_hash text;
create index if not exists directory_link_sends_ip_idx on public.directory_link_sends (ip_hash, sent_at);

-- B. Course package ids only for buyers, admins and all-access (part 1)
alter table public.learn_courses add column if not exists ready boolean generated always as (current_version is not null) stored;
create or replace function public.learn_current_versions(ids uuid[])
returns table(course_id uuid, version_id uuid, launch_path text)
language sql stable security definer set search_path = public as $$
  select c.id, c.current_version, v.launch_path
  from learn_courses c left join learn_versions v on v.id = c.current_version
  where c.id = any(ids) and learn_can_see_course(c.id)
    and (learn_is_admin()
      or exists (select 1 from learn_enrolments e where e.course_id = c.id
                 and (e.user_id = auth.uid() or lower(e.email) = lower(coalesce(auth.jwt()->>'email',''))))
      or exists (select 1 from learn_all_access a where lower(a.email) = lower(coalesce(auth.jwt()->>'email',''))));
$$;
revoke all on function public.learn_current_versions(uuid[]) from public, anon;
grant execute on function public.learn_current_versions(uuid[]) to authenticated;
drop policy if exists learn_versions_read on public.learn_versions;
create policy learn_versions_read on public.learn_versions for select using (
  learn_can_see_course(course_id) and (learn_is_admin()
    or exists (select 1 from learn_enrolments e where e.course_id = learn_versions.course_id
               and (e.user_id = auth.uid() or lower(e.email) = lower(coalesce(auth.jwt()->>'email',''))))
    or exists (select 1 from learn_all_access a where lower(a.email) = lower(coalesce(auth.jwt()->>'email','')))));

-- C. Portfolio colleague invites: own portfolio only, ratings only via learn-rate
drop policy if exists "own invites" on public.learn_portfolio_invites;
create policy "own invites read" on public.learn_portfolio_invites for select using (user_id = auth.uid());
create policy "own invites add" on public.learn_portfolio_invites for insert with check (
  user_id = auth.uid() and ratings is null and submitted_at is null and rater_name is null
  and exists (select 1 from public.learn_portfolio p where p.id = portfolio_id and p.user_id = auth.uid()));
create policy "own invites remove" on public.learn_portfolio_invites for delete using (user_id = auth.uid() and submitted_at is null);

-- D. APPLY ONLY AFTER THIS PR IS DEPLOYED: hide current_version (and the
-- preview tester list) from browsers. The pages now use `ready` and
-- learn_current_versions instead.
-- revoke select on public.learn_courses from anon, authenticated;
-- grant select (id, slug, title, brand, level, language, ceus, active, created_at, cert_title, on_site, ready) on public.learn_courses to anon, authenticated;
