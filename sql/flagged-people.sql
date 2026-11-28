-- Flagged people and revoked certificates (Nathan, 25 Nov 2026)
--
-- Someone with an unpaid balance is not blocked. Instead, whenever they
-- touch anything (book, buy, sign up, apply, log in) the office gets an
-- email so Nathan can decide what to do. Their old seminar certificate
-- and attendance record are revoked, not deleted: kept as proof they
-- attended, but no longer counted anywhere.

-- 1. Revoke, never delete -------------------------------------------------
alter table public.past_certificates
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_reason text;
alter table public.past_attendees
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_reason text;

-- 2. The flag list --------------------------------------------------------
create table if not exists public.flagged_people (
  id         bigint generated always as identity primary key,
  email      text,                 -- lower case
  full_name  text not null,
  name_key   text not null,        -- lower case, no accents, letters only
  reason     text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.flag_events (
  id          bigint generated always as identity primary key,
  flagged_id  bigint not null references public.flagged_people(id),
  matched_on  text not null,       -- 'email' or 'name'
  source      text not null,       -- which table they touched
  action      text not null,       -- 'INSERT' or 'UPDATE' / 'login'
  detail      jsonb,
  at          timestamptz not null default now(),
  emailed_at  timestamptz
);

-- Staff only: the service role reads these; nobody else.
alter table public.flagged_people enable row level security;
alter table public.flag_events   enable row level security;
revoke all on public.flagged_people, public.flag_events from anon, authenticated;

-- "Zoë Núñez-Peña" -> "zoenunezpena"
create or replace function public.flag_name_key(n text) returns text
language sql immutable as $$
  select regexp_replace(
    translate(lower(coalesce(n, '')),
      'áàâäãåéèêëíìîïóòôöõúùûüñçý', 'aaaaaaeeeeiiiiooooouuuuncy'),
    '[^a-z]', '', 'g')
$$;

-- 3. The watcher: one trigger function for every table -------------------
create or replace function public.flag_watch() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb := to_jsonb(new);
  emails text[];
  names  text[];
  hit record;
begin
  emails := array_remove(array[
    lower(j->>'email'), lower(j->>'payer_email'), lower(j->>'buyer_email'),
    lower(j->>'recipient_email'), lower(j->>'mentee_email'), lower(j->>'public_email')
  ], null);
  names := array_remove(array[
    public.flag_name_key(nullif(trim(coalesce(j->>'first_name','') || ' ' || coalesce(j->>'last_name','')), '')),
    public.flag_name_key(j->>'full_name'), public.flag_name_key(j->>'name'),
    public.flag_name_key(j->>'payer_name'), public.flag_name_key(j->>'buyer_name'),
    public.flag_name_key(j->>'recipient_name'), public.flag_name_key(j->>'mentee_name'),
    public.flag_name_key(j->>'participant_name')
  ], '');

  for hit in
    select f.id, case when f.email = any(emails) then 'email' else 'name' end as how
    from public.flagged_people f
    where f.active and (f.email = any(emails) or f.name_key = any(names))
  loop
    insert into public.flag_events (flagged_id, matched_on, source, action, detail)
    values (hit.id, hit.how, tg_table_schema || '.' || tg_table_name, tg_op,
            j - 'password' - 'encrypted_password' - 'raw_app_meta_data');
  end loop;
  return null;
exception when others then
  -- never stop a booking or sign-up because the watcher failed
  return null;
end $$;

-- Logins: only when last_sign_in_at moves, so it fires once per sign-in.
create or replace function public.flag_watch_login() returns trigger
language plpgsql security definer set search_path = public as $$
declare hit record;
begin
  if new.last_sign_in_at is not distinct from old.last_sign_in_at then return null; end if;
  for hit in
    select f.id from public.flagged_people f
    where f.active and f.email = lower(new.email)
  loop
    insert into public.flag_events (flagged_id, matched_on, source, action, detail)
    values (hit.id, 'email', 'auth.users', 'login',
            jsonb_build_object('email', new.email, 'last_sign_in_at', new.last_sign_in_at));
  end loop;
  return null;
exception when others then
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'public.registrations', 'public.abandoned_checkouts', 'public.course_payments',
    'public.online_sales', 'public.online_invoices', 'public.learn_enrolments',
    'public.learn_invites', 'public.learn_all_access', 'public.learn_mentorships',
    'public.mentor_bookings', 'public.directory_profiles', 'public.directory_contact_requests',
    'public.email_signups', 'public.interest_signups', 'public.quiz_responses',
    'public.gift_cards', 'public.hoodie_claims', 'public.staff_pathway_applications',
    'public.programming_applications', 'train.applications', 'train.athletes',
    'train.move_offers'
  ] loop
    execute format('drop trigger if exists flag_watch on %s', t);
    execute format('create trigger flag_watch after insert on %s for each row execute function public.flag_watch()', t);
  end loop;
end $$;

-- New Learn / programming accounts, and every sign-in.
drop trigger if exists flag_watch on auth.users;
create trigger flag_watch after insert on auth.users
  for each row execute function public.flag_watch();
drop trigger if exists flag_watch_login on auth.users;
create trigger flag_watch_login after update of last_sign_in_at on auth.users
  for each row execute function public.flag_watch_login();

-- 4. Trainer Directory qualifications: skip revoked records ----------------
-- Same view as before; only the two "revoked_at is null" lines are new.
create or replace view public.directory_qualifications as
 SELECT lower(r.email) AS email, c.brand::text AS brand,
    NULLIF(regexp_replace(COALESCE(c.level, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) AS level,
    CASE WHEN c.type = 'workshop'::course_type THEN 'workshop'::text ELSE 'seminar'::text END AS kind,
    c.workshop_focus AS focus, ce.awarded_on,
    NULLIF(concat_ws(', '::text, NULLIF(c.city, ''::text), NULLIF(c.country, ''::text)), ''::text) AS place,
    NULL::text AS course_title, 'certificate'::text AS source
   FROM certificates ce
     JOIN registrations r ON r.id = ce.registration_id
     JOIN courses c ON c.id = ce.course_id
  WHERE r.email IS NOT NULL
UNION ALL
 SELECT lower(lc.email) AS email, l.brand,
    NULLIF(regexp_replace(COALESCE(l.level, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) AS level,
    'online'::text AS kind, NULL::text AS focus, lc.awarded_on, NULL::text AS place,
    COALESCE(NULLIF(l.cert_title, ''::text), l.title) AS course_title, 'online'::text AS source
   FROM learn_certificates lc
     JOIN learn_courses l ON l.id = lc.course_id
  WHERE lc.email IS NOT NULL
UNION ALL
 SELECT lower(e.email) AS email, l.brand,
    NULLIF(regexp_replace(COALESCE(l.level, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) AS level,
    'online'::text AS kind, NULL::text AS focus, e.lw_completed_at::date AS awarded_on, NULL::text AS place,
    COALESCE(NULLIF(l.cert_title, ''::text), l.title) AS course_title, 'online'::text AS source
   FROM learn_enrolments e
     JOIN learn_courses l ON l.id = e.course_id
  WHERE e.lw_completed_at IS NOT NULL AND e.email IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM learn_certificates lc
          WHERE lc.course_id = e.course_id AND lower(lc.email) = lower(e.email)))
UNION ALL
 SELECT lower(u.email::text) AS email, l.brand,
    NULLIF(regexp_replace(COALESCE(l.level, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) AS level,
    'online'::text AS kind, NULL::text AS focus, COALESCE(a.completed_at, a.updated_at)::date AS awarded_on,
    NULL::text AS place, COALESCE(NULLIF(l.cert_title, ''::text), l.title) AS course_title, 'online'::text AS source
   FROM learn_attempts a
     JOIN auth.users u ON u.id = a.user_id
     JOIN learn_courses l ON l.id = a.course_id
  WHERE (a.success_status = 'passed'::text OR COALESCE(a.success_status, ''::text) <> 'failed'::text AND a.completion_status = 'completed'::text)
    AND u.email IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM learn_certificates lc
          WHERE lc.course_id = a.course_id AND lc.user_id = a.user_id))
UNION ALL
 SELECT DISTINCT ON ((lower(pa.email)), pa.brand, pa.level, pa.kind, pa.event_date) lower(pa.email) AS email,
    pa.brand, pa.level, pa.kind, NULL::text AS focus, pa.event_date AS awarded_on, pa.place,
    NULL::text AS course_title, 'regfox'::text AS source
   FROM past_attendees pa
  WHERE pa.status = 'Completed'::text AND pa.event_date <= CURRENT_DATE
    AND pa.revoked_at IS NULL
    AND NOT (EXISTS ( SELECT 1
           FROM certificates ce
             JOIN registrations r ON r.id = ce.registration_id
             JOIN courses c ON c.id = ce.course_id
          WHERE lower(r.email) = lower(pa.email) AND c.brand::text = pa.brand
            AND NOT NULLIF(regexp_replace(COALESCE(c.level, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) IS DISTINCT FROM pa.level))
UNION ALL
 SELECT pc.email, pc.brand, NULLIF(pc.level, 'advanced'::text) AS level, pc.kind, NULL::text AS focus,
    pc.awarded_on, NULL::text AS place, NULL::text AS course_title, 'simplecert'::text AS source
   FROM past_certificates pc
  WHERE pc.revoked_at IS NULL;
