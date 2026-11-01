-- Coach-to-coach Connect (Nathan, 1 Nov 2026): BirdBox coaches can message
-- each other from the Trainer Directory tab in BirdBox Learn. Each coach
-- can switch it off on their own listing; it is on unless they do.
-- Messages go through the existing contact requests (looking_for 'coach'),
-- so the same checks, queue and email apply. Nothing else changes.

alter table public.directory_profiles
  add column coach_connect boolean not null default true;

comment on column public.directory_profiles.coach_connect is
  'Let other BirdBox coaches contact me (Trainer Directory tab in BirdBox Learn)';
