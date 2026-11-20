-- Free hoodie with a live seminar booked 27 Nov - 30 Dec 2026 (Nathan,
-- 20 Nov 2026). One hoodie per seminar booking. The learner picks it in
-- BirdBox Learn and the order goes straight to Printful, paid from the
-- Printful wallet. Not for workshops, transfers, free places or places
-- paid with a course credit.
--
-- Only the website's server reads or writes this (no policies; anon and
-- logged-in users have no grant), like past_certificates.

create table public.hoodie_claims (
  id                uuid primary key default gen_random_uuid(),
  registration_id   uuid unique references public.registrations(id) on delete set null,  -- kept if the booking is deleted
  email             text not null,                -- the Learn login that claimed it
  sync_variant_id   bigint not null,              -- Printful store variant
  product_name      text not null,                -- as in the shop
  colour            text,
  size              text,
  recipient         jsonb not null,               -- name and delivery address sent to Printful
  status            text not null default 'pending' check (status in ('pending', 'ordered', 'failed')),
  printful_order_id bigint,
  printful_cost     text,                         -- what Printful charged, for the record
  error             text,
  created_at        timestamptz not null default now(),
  ordered_at        timestamptz
);

create index hoodie_claims_email on public.hoodie_claims (email);

alter table public.hoodie_claims enable row level security;
revoke all on public.hoodie_claims from anon, authenticated;

comment on table public.hoodie_claims is
  'Free hoodies claimed in BirdBox Learn for live seminars booked 27 Nov - 30 Dec 2026 (Nathan, 20 Nov 2026). Each row is one Printful order.';
