-- BirdBox Mentorship pre-registration (Nathan, 25 Nov 2026). Starts 4 Jan 2027.
--
-- One new table, nothing existing changes. Locked like the mentor booking
-- tables: Row Level Security on, no policies and no browser rights, so only
-- the server (mentorship-apply, the Stripe webhook, and the admin/Learn
-- functions) can read or write it.
--
-- A row is made when someone fills in the form ("pending_card"). It becomes
-- "applied" when Stripe confirms their card is saved: nothing is charged.
-- Then: allocated (mentor chosen) → call_offered → call_booked (€150 taken)
-- → accepted (offer sent, subscription) / declined. "withdrawn" if they pull out.

create table if not exists public.mentor_applications (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null,
  user_id             uuid,                -- their BirdBox (Learn) login, made or found when the card is saved
  first_name          text,
  last_name           text,
  phone               text,
  country             text,
  tz                  text,
  answers             jsonb not null default '{}'::jsonb,  -- role, years, gym, help[], why, quals, times[], heard
  preferred_mentor    uuid references public.staff(id),
  mentor_id           uuid references public.staff(id),
  business_name       text,
  vat_number          text,
  vat_checked         text,                -- 'valid' | 'invalid' | 'unchecked' (EU register down) | null
  reverse_charge      boolean not null default false,
  stripe_customer_id  text,
  payment_method_id   text,
  status              text not null default 'pending_card'
                      check (status in ('pending_card','applied','allocated','call_offered','call_booked','accepted','declined','withdrawn')),
  starts_on           date not null default '2027-01-04',
  office_notes        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists mentor_applications_email  on public.mentor_applications (lower(email));
create index if not exists mentor_applications_status on public.mentor_applications (status, created_at);

alter table public.mentor_applications enable row level security;
revoke all on public.mentor_applications from anon, authenticated;

-- To undo (nothing else depends on it yet):
--   drop table public.mentor_applications;
