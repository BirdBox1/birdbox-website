// netlify/lib/local-price.mjs
//
// Seminars priced in a local currency at a fixed reduction.
//
// Nathan, 11 Nov 2026: a seminar set up in South African rand is always
// 31% below its normal price, to allow for the exchange rate. The lead
// coach takes the same 31% off his fee. No box to tick: the currency
// is the switch.
//
// On such a course the reduced price IS the price:
//   - no discount codes (early bird, group of 5, military, ...), and
//     no Level 1 Online 50% pass. It is already the lowest price.
//   - free places still work: a 100% code (host places, places a gym
//     has paid for upfront) is a place, not a discount.
//   - a course credit is converted into rand. If it covers the reduced
//     price the place is free; if not, they pay the rest. Nothing is
//     carried over.
//   - gift cards in any currency are converted into rand. What the
//     card does not use stays on it, in its own currency.
//   - the deposit is 25% of the reduced price.
//   - monthly payments work as normal on the reduced price.
//
// The registration page (c/index.html, LOCAL_DISCOUNT) shows the
// normal price crossed out. Keep the two lists the same.

export const LOCAL_DISCOUNT = { ZAR: 31 };

export function localDiscountPercent(course) {
  return LOCAL_DISCOUNT[String(course?.currency || "").trim().toUpperCase()] || 0;
}

// The reduced price, rounded to a whole unit: R11,812 less 31% is
// R8,150.28, charged as R8,150.
export function reducedCents(listCents, percent) {
  return Math.round((listCents * (100 - percent)) / 100 / 100) * 100;
}

// The course as checkout should price it. price_cents becomes the
// reduced price and list_price_cents keeps the normal one. A fixed
// deposit is dropped so the 25% is worked out on the reduced price.
export function withLocalPrice(course) {
  const percent = localDiscountPercent(course);
  if (!course || !percent) return course;
  return {
    ...course,
    list_price_cents: course.price_cents,
    price_cents: reducedCents(course.price_cents, percent),
    deposit_cents: null,
    local_discount_percent: percent,
  };
}

// How many units of `to` one unit of `from` buys today, from the ECB
// reference rates (the same source the sales page uses). Throws if the
// rate cannot be had: better to refuse a credit than to guess its worth.
const rateCache = new Map();
export async function fxRate(from, to) {
  const f = String(from).toUpperCase();
  const t = String(to).toUpperCase();
  if (f === t) return 1;
  const key = f + t + new Date().toISOString().slice(0, 10);
  if (rateCache.has(key)) return rateCache.get(key);
  const r = await fetch(`https://api.frankfurter.app/latest?from=${f}&to=${t}`);
  if (!r.ok) throw new Error(`No exchange rate for ${f} to ${t}`);
  const d = await r.json();
  const rate = Number(d?.rates?.[t]);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`No exchange rate for ${f} to ${t}`);
  rateCache.set(key, rate);
  return rate;
}
