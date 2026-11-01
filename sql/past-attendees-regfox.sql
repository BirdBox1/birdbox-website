-- Past seminar attendees from RegFox, for the Trainer Directory
-- (Nathan, 1 Nov 2026).
--
-- Both RegFox accounts we still have (100004 and 180628) were exported:
-- every registration from 2021 to 2026, abandoned checkouts left out.
-- Course names agreed with Nathan: any BirdBox course ("BB", "BirdBox",
-- and the old city-only pages) is TCC Level 1, "BB L2" is TCC Level 2,
-- and a "TGC" page with no level is TGC Level 1.
--
-- A coach whose email has a COMPLETED registration for a course counts as
-- having done it: it joins directory_qualifications, the same list our
-- certificates and online courses are in, so the directory verifies it
-- with no office check (option b). Cancelled and pending registrations
-- are kept for the office to see, but verify nothing.
--
-- Only the website's server can read this (no policies; anon and
-- logged-in users have no grant), like directory_qualifications.

create table public.past_attendees (
  id            bigint generated always as identity primary key,
  source        text not null default 'regfox',
  account       text not null,                 -- RegFox account number
  form_id       bigint not null,               -- RegFox page
  seminar       text not null,                 -- the RegFox page name
  brand         text not null check (brand in ('tgc', 'tcc')),
  level         text,                          -- '1', '2', or null (workshop)
  kind          text not null default 'seminar' check (kind in ('seminar', 'workshop')),
  event_date    date,
  place         text,                          -- from the page name
  status        text not null,                 -- Completed, Canceled, Pending ...
  name          text,
  email         text not null,
  company       text,
  country       text,                          -- billing country
  registered_on date,
  loaded_at     timestamptz not null default now()
);

create index past_attendees_email on public.past_attendees (lower(email));
create unique index past_attendees_one on public.past_attendees (source, account, form_id, lower(email), coalesce(name, ''));

alter table public.past_attendees enable row level security;
revoke all on public.past_attendees from anon, authenticated;

comment on table public.past_attendees is
  'Past seminar registrations from RegFox (both accounts, 2021-2026). Completed ones count as qualifications in directory_qualifications.';

-- directory_qualifications: the same view as before, with RegFox's
-- completed registrations added at the end. A seminar already covered by
-- one of our own certificates for that email is not listed twice, and a
-- seminar that has not happened yet counts for nothing.
create or replace view public.directory_qualifications with (security_invoker = false) as
 SELECT lower(r.email) AS email,
    c.brand::text AS brand,
    NULLIF(regexp_replace(COALESCE(c.level, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) AS level,
        CASE
            WHEN c.type = 'workshop'::course_type THEN 'workshop'::text
            ELSE 'seminar'::text
        END AS kind,
    c.workshop_focus AS focus,
    ce.awarded_on,
    NULLIF(concat_ws(', '::text, NULLIF(c.city, ''::text), NULLIF(c.country, ''::text)), ''::text) AS place,
    NULL::text AS course_title
   FROM certificates ce
     JOIN registrations r ON r.id = ce.registration_id
     JOIN courses c ON c.id = ce.course_id
  WHERE r.email IS NOT NULL
UNION ALL
 SELECT lower(lc.email) AS email,
    l.brand,
    NULLIF(regexp_replace(COALESCE(l.level, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) AS level,
    'online'::text AS kind,
    NULL::text AS focus,
    lc.awarded_on,
    NULL::text AS place,
    COALESCE(NULLIF(l.cert_title, ''::text), l.title) AS course_title
   FROM learn_certificates lc
     JOIN learn_courses l ON l.id = lc.course_id
  WHERE lc.email IS NOT NULL
UNION ALL
 SELECT lower(e.email) AS email,
    l.brand,
    NULLIF(regexp_replace(COALESCE(l.level, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) AS level,
    'online'::text AS kind,
    NULL::text AS focus,
    e.lw_completed_at::date AS awarded_on,
    NULL::text AS place,
    COALESCE(NULLIF(l.cert_title, ''::text), l.title) AS course_title
   FROM learn_enrolments e
     JOIN learn_courses l ON l.id = e.course_id
  WHERE e.lw_completed_at IS NOT NULL AND e.email IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM learn_certificates lc
          WHERE lc.course_id = e.course_id AND lower(lc.email) = lower(e.email)))
UNION ALL
 SELECT lower(u.email::text) AS email,
    l.brand,
    NULLIF(regexp_replace(COALESCE(l.level, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) AS level,
    'online'::text AS kind,
    NULL::text AS focus,
    COALESCE(a.completed_at, a.updated_at)::date AS awarded_on,
    NULL::text AS place,
    COALESCE(NULLIF(l.cert_title, ''::text), l.title) AS course_title
   FROM learn_attempts a
     JOIN auth.users u ON u.id = a.user_id
     JOIN learn_courses l ON l.id = a.course_id
  WHERE (a.success_status = 'passed'::text OR COALESCE(a.success_status, ''::text) <> 'failed'::text AND a.completion_status = 'completed'::text) AND u.email IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM learn_certificates lc
          WHERE lc.course_id = a.course_id AND lc.user_id = a.user_id))
UNION ALL
 -- RegFox (Nathan, 1 Nov 2026)
 SELECT DISTINCT ON (lower(pa.email), pa.brand, pa.level, pa.kind, pa.event_date)
    lower(pa.email) AS email,
    pa.brand,
    pa.level,
    pa.kind,
    NULL::text AS focus,
    pa.event_date AS awarded_on,
    pa.place,
    NULL::text AS course_title
   FROM past_attendees pa
  WHERE pa.status = 'Completed'::text AND pa.event_date <= CURRENT_DATE AND NOT (EXISTS ( SELECT 1
           FROM certificates ce
             JOIN registrations r ON r.id = ce.registration_id
             JOIN courses c ON c.id = ce.course_id
          WHERE lower(r.email) = lower(pa.email) AND c.brand::text = pa.brand
            AND NULLIF(regexp_replace(COALESCE(c.level, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) IS NOT DISTINCT FROM pa.level));
