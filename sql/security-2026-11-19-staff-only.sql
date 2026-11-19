-- Staff-only data was readable by any logged-in person (learners, app
-- athletes) and, through 26 planner views, by anyone at all. Lock to staff.
drop policy if exists certificates_staff_read on public.certificates;
create policy certificates_staff_read on public.certificates for select to authenticated using (public.is_staff());
drop policy if exists read_bases on public.coach_bases;
create policy read_bases on public.coach_bases for select to authenticated using (public.is_staff());
drop policy if exists read_caps on public.coach_capabilities;
create policy read_caps on public.coach_capabilities for select to authenticated using (public.is_staff());
drop policy if exists read_pairs on public.coach_pairings;
create policy read_pairs on public.coach_pairings for select to authenticated using (public.is_staff());
drop policy if exists coach_notifications_read on public.coach_notifications;
create policy coach_notifications_read on public.coach_notifications for select to authenticated using (public.is_staff());
drop policy if exists "staff can read feedback manuals" on public.feedback_manuals;
drop policy if exists "staff read feedback manuals" on public.feedback_manuals;
create policy "staff read feedback manuals" on public.feedback_manuals for select to authenticated using (public.is_staff());
drop policy if exists planned_notes_read on public.planned_notes;
create policy planned_notes_read on public.planned_notes for select to authenticated using (public.is_staff());
drop policy if exists planned_read on public.planned_seminars;
create policy planned_read on public.planned_seminars for select to authenticated using (public.is_staff());
drop policy if exists hist_read on public.seminar_history;
create policy hist_read on public.seminar_history for select to authenticated using (public.is_staff());
drop policy if exists venues_read on public.venues;
create policy venues_read on public.venues for select to authenticated using (public.is_staff());
drop policy if exists email_templates_read on public.email_templates;
create policy email_templates_read on public.email_templates for select to authenticated using (public.is_staff());
do $$ declare v text; begin
  foreach v in array array['v_brand_trend','v_coach_load','v_coach_load_planned','v_coach_record','v_competitor_by_market','v_competitor_soldout','v_conflict_capability','v_conflict_market_spacing','v_conflict_pairing','v_conflict_unavailable','v_conflict_unstaffed','v_conflicts_ranked','v_course_readiness','v_map_points','v_market_coverage','v_market_gaps','v_market_record','v_market_unmatched','v_media_todo','v_month_index','v_month_index_by_region','v_plan','v_revisit_by_coach','v_revisit_candidates','v_trail_opportunities','v_venue_record'] loop
    execute format('alter view public.%I set (security_invoker = on)', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;
-- Public seminar pages read courses without logging in: give them only the
-- public columns (host name/email, admin and staffing notes stay private).
revoke select on public.courses from anon;
grant select (id, brand, type, level, title, slug, summary, description, movements, workshop_focus, venue_name, address, city, country, state, starts_at, ends_at, timezone, capacity, price_cents, deposit_cents, currency, status, language, image_url, latitude, longitude, archived) on public.courses to anon;
