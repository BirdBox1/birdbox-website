-- The live -> online 50% offer for people whose Level 1 seminar
-- certificate was sent through SimpleCert in the last five years
-- (Nathan, 17 Nov 2026). Their offer hangs off the certificate, as a
-- booked seminar's hangs off the registration: one each, used once.

alter table public.online_offers alter column registration_id drop not null;
alter table public.online_offers
  add column past_certificate_id uuid references public.past_certificates(id) on delete cascade;
create unique index online_offers_past_certificate on public.online_offers (past_certificate_id);
alter table public.online_offers add constraint online_offers_has_source
  check (registration_id is not null or past_certificate_id is not null);
