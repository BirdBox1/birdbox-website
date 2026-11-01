-- directory_qualifications says where each line comes from (Nathan,
-- 1 Nov 2026), so a RegFox match reads "on our seminar records" rather
-- than "certificate". The same view as past-attendees-regfox.sql, with a
-- source column added at the end: certificate, online or regfox.

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
 -- RegFox (Nathan, 1 Nov 2026)
 SELECT DISTINCT ON (lower(pa.email), pa.brand, pa.level, pa.kind, pa.event_date)
    lower(pa.email) AS email,
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
          WHERE lower(r.email) = lower(pa.email) AND c.brand::text = pa.brand
            AND NULLIF(regexp_replace(COALESCE(c.level, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) IS NOT DISTINCT FROM pa.level));
