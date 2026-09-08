// netlify/functions/geo.mjs
//
// Tells the page which country the visitor is in, so consent.js knows
// whether it has to ask before the Meta pixel may run.
//
// Netlify works the country out at the edge from the connecting address.
// Nothing is stored, nothing is logged, and no third party is involved —
// which matters, because a lookup that itself needed consent would defeat
// the purpose.
//
// The answer is deliberately thin: a two-letter country code and a flag.
// No city, no region, no address. consent.js caches it for a week.

// Consent before tracking: EU 27, the rest of the EEA, the UK, and
// Switzerland. Kept in step with the same list in consent.js — if one
// changes, change both.
const ASK = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
  "IS", "LI", "NO",
  "GB", "CH",
]);

export default async (req, context) => {
  let code = null;

  try {
    const raw = context?.geo?.country?.code;
    if (raw && /^[A-Za-z]{2}$/.test(raw)) code = raw.toUpperCase();
  } catch (e) {
    code = null;
  }

  // No country means we treat them as European — consent.js does the same
  // if this request never arrives. Failing towards asking is the only safe
  // direction to fail in.
  const body = {
    country: code,
    consentRequired: code ? ASK.has(code) : true,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Per visitor, so it must never sit in a shared cache. The browser
      // holds its own copy in localStorage for a week instead.
      "Cache-Control": "no-store, private",
    },
  });
};
