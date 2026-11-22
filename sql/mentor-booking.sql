-- Mentor portal: calendar and booking (Nathan, 22 Nov 2026).
--
-- Four new tables, all new, nothing existing is changed. They are kept
-- apart from programming and the seminar portal: Row Level Security is on
-- with NO policies, so the browser can never read or write them directly.
-- Everything goes through netlify/functions/mentor-calendar.mjs, which
-- checks the person is an admin (only Nathan and Michaela while the
-- mentor portal is being built).
--
-- Times: a mentor's weekly pattern is stored as weekday + minutes in the
-- mentor's own time zone (mentor_settings.tz). Bookings are real moments
-- (timestamptz), so a mentee anywhere sees them in their own time.

-- One row per mentor: time zone and booking rules.
create table if not exists public.mentor_settings (
  staff_id         uuid primary key references public.staff(id) on delete cascade,
  tz               text    not null default 'Europe/Dublin',
  weekly_minutes   integer not null default 30  check (weekly_minutes between 15 and 120),
  opening_minutes  integer not null default 60  check (opening_minutes between 15 and 180),
  buffer_minutes   integer not null default 10  check (buffer_minutes between 0 and 60),
  notice_hours     integer not null default 12  check (notice_hours between 0 and 168),
  max_per_day      integer not null default 4   check (max_per_day between 1 and 12),
  updated_at       timestamptz not null default now()
);

-- The weekly pattern of bookable time. 0 = Monday … 6 = Sunday.
create table if not exists public.mentor_availability (
  id         bigint generated always as identity primary key,
  staff_id   uuid     not null references public.staff(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),
  start_min  smallint not null check (start_min between 0 and 1439),
  end_min    smallint not null check (end_min between 1 and 1440),
  check (end_min > start_min)
);
create index if not exists mentor_availability_staff on public.mentor_availability (staff_id);

-- Days off (holidays, seminars): nothing can be booked on these dates.
create table if not exists public.mentor_time_off (
  id         bigint generated always as identity primary key,
  staff_id   uuid not null references public.staff(id) on delete cascade,
  starts_on  date not null,
  ends_on    date not null,
  reason     text,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists mentor_time_off_staff on public.mentor_time_off (staff_id, starts_on);

-- The calls themselves.
create table if not exists public.mentor_bookings (
  id             uuid primary key default gen_random_uuid(),
  mentor_id      uuid not null references public.staff(id),
  mentorship_id  uuid references public.learn_mentorships(id) on delete set null,
  mentee_name    text,
  mentee_email   text,
  kind           text not null check (kind in ('opening', 'weekly')),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  status         text not null default 'booked' check (status in ('booked', 'cancelled', 'done', 'missed')),
  record         boolean not null default false,
  transcribe     boolean not null default false,
  room_url       text,
  note           text,
  booked_by      uuid references public.staff(id),
  cancel_reason  text,
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists mentor_bookings_mentor_time on public.mentor_bookings (mentor_id, starts_at);
create index if not exists mentor_bookings_mentorship  on public.mentor_bookings (mentorship_id, starts_at);
-- A mentor can't have two live calls starting at the same moment.
create unique index if not exists mentor_bookings_no_double
  on public.mentor_bookings (mentor_id, starts_at) where status = 'booked';

-- Locked: no policies, so only the server (service role) can touch them.
alter table public.mentor_settings     enable row level security;
alter table public.mentor_availability enable row level security;
alter table public.mentor_time_off     enable row level security;
alter table public.mentor_bookings     enable row level security;

-- And no browser role holds any rights on them at all.
revoke all on public.mentor_settings, public.mentor_availability, public.mentor_time_off, public.mentor_bookings from anon, authenticated;

-- APPLIED 22 Nov 2026 with Nathan's yes (migrations mentor_booking and
-- mentor_booking_revoke_browser).

-- To undo (nothing else depends on these yet):
--   drop table public.mentor_bookings, public.mentor_time_off,
--              public.mentor_availability, public.mentor_settings;
