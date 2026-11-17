-- Certificates we issued through SimpleCert, before BirdBox Learn
-- (Nathan, 17 Nov 2026).
--
-- Both SimpleCert accounts were exported on 17 Nov 2026:
--   thegymnasticscourse          -> TGC Level 1, Level 2 and the old
--                                   Advanced course (Jul 2019 - Aug 2026)
--   birdboxcoachingdevelopment   -> BirdBox Coaching Development, now TCC:
--                                   Level 1 seminar and the online course
--                                   (Sep 2021 - Jul 2026)
-- One row per person per course and date (scripts/simplecert-import).
-- The PDF they were sent is kept in the private past-certificates bucket,
-- so they can download it again from BirdBox Learn after SimpleCert goes.
--
-- Only the website's server reads this (no policies; anon and logged-in
-- users have no grant), like past_attendees.

create table public.past_certificates (
  id               uuid primary key default gen_random_uuid(),
  source           text not null,                 -- simplecert-tgc, simplecert-birdbox
  source_id        bigint not null,               -- SimpleCert recipient id
  email            text not null,                 -- lower case
  participant_name text not null,
  brand            text not null check (brand in ('tgc', 'tcc')),
  level            text not null check (level in ('1', '2', 'advanced')),
  kind             text not null check (kind in ('seminar', 'online')),
  awarded_on       date not null,                 -- the date printed on it
  printed_date     text,                          -- exactly as printed
  batch_title      text,                          -- the SimpleCert batch
  sent_status      text,
  pdf_path         text,                          -- in past-certificates; null when SimpleCert had lost it
  loaded_at        timestamptz not null default now(),
  unique (source, source_id)
);

create index past_certificates_email on public.past_certificates (email);

alter table public.past_certificates enable row level security;
revoke all on public.past_certificates from anon, authenticated;

comment on table public.past_certificates is
  'Certificates issued through SimpleCert (TGC 2019-2026, BirdBox Coaching Development/TCC 2021-2026), with the PDF in the past-certificates bucket. Shown in BirdBox Learn and counted in directory_qualifications.';

insert into storage.buckets (id, name, public)
values ('past-certificates', 'past-certificates', false)
on conflict (id) do nothing;

-- directory_qualifications: as before, with the SimpleCert certificates
-- added at the end (source 'simplecert', verified as a certificate). The
-- old TGC Advanced course has no level number, so it lists as TGC.
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
    NULL::text AS course_title,
    'certificate'::text AS source
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
    COALESCE(NULLIF(l.cert_title, ''::text), l.title) AS course_title,
    'online'::text AS source
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
    COALESCE(NULLIF(l.cert_title, ''::text), l.title) AS course_title,
    'online'::text AS source
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
    COALESCE(NULLIF(l.cert_title, ''::text), l.title) AS course_title,
    'online'::text AS source
   FROM learn_attempts a
     JOIN auth.users u ON u.id = a.user_id
     JOIN learn_courses l ON l.id = a.course_id
  WHERE (a.success_status = 'passed'::text OR COALESCE(a.success_status, ''::text) <> 'failed'::text AND a.completion_status = 'completed'::text) AND u.email IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM learn_certificates lc
          WHERE lc.course_id = a.course_id AND lc.user_id = a.user_id))
UNION ALL
 SELECT DISTINCT ON ((lower(pa.email)), pa.brand, pa.level, pa.kind, pa.event_date) lower(pa.email) AS email,
    pa.brand,
    pa.level,
    pa.kind,
    NULL::text AS focus,
    pa.event_date AS awarded_on,
    pa.place,
    NULL::text AS course_title,
    'regfox'::text AS source
   FROM past_attendees pa
  WHERE pa.status = 'Completed'::text AND pa.event_date <= CURRENT_DATE AND NOT (EXISTS ( SELECT 1
           FROM certificates ce
             JOIN registrations r ON r.id = ce.registration_id
             JOIN courses c ON c.id = ce.course_id
          WHERE lower(r.email) = lower(pa.email) AND c.brand::text = pa.brand AND NOT NULLIF(regexp_replace(COALESCE(c.level, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) IS DISTINCT FROM pa.level))
UNION ALL
 -- SimpleCert (Nathan, 17 Nov 2026)
 SELECT pc.email,
    pc.brand,
    NULLIF(pc.level, 'advanced') AS level,
    pc.kind,
    NULL::text AS focus,
    pc.awarded_on,
    NULL::text AS place,
    NULL::text AS course_title,
    'simplecert'::text AS source
   FROM past_certificates pc;
