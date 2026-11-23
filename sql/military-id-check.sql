-- Military / police ID check (Nathan, 23 Nov 2026)
--
-- We no longer ask people to send proof of service before they get the
-- military or police discount. We trust them, and the coach checks
-- their military or police ID at registration on the day.
--
-- registrations.military_id_check marks everyone who needs that check.
-- A trigger sets it, so no checkout or invoice path can forget:
--   * they registered with a military code (a discount_codes row whose
--     label says Military or Police, or whose code starts MIL), or
--   * their place came from an invoice ticked "Military / police
--     discount" (invoices.military).
-- The portal roster shows "check military ID" for these people.

alter table public.invoices
  add column if not exists military boolean not null default false;

alter table public.registrations
  add column if not exists military_id_check boolean not null default false;

create or replace function public.set_military_id_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.military_id_check then
    return new;
  end if;

  if coalesce(new.discount_code, '') <> '' and exists (
    select 1 from public.discount_codes d
    where upper(d.code) = upper(new.discount_code)
      and (d.label ilike '%milit%' or d.label ilike '%police%' or d.code ilike 'MIL%')
  ) then
    new.military_id_check := true;
  elsif new.invoice_id is not null and exists (
    select 1 from public.invoices i where i.id = new.invoice_id and i.military
  ) then
    new.military_id_check := true;
  end if;

  return new;
end;
$$;

drop trigger if exists registrations_military_id_check on public.registrations;
create trigger registrations_military_id_check
  before insert or update of discount_code, invoice_id on public.registrations
  for each row execute function public.set_military_id_check();

-- Everyone already booked with a military code.
update public.registrations r
set military_id_check = true
where not r.military_id_check
  and coalesce(r.discount_code, '') <> ''
  and exists (
    select 1 from public.discount_codes d
    where upper(d.code) = upper(r.discount_code)
      and (d.label ilike '%milit%' or d.label ilike '%police%' or d.code ilike 'MIL%')
  );
