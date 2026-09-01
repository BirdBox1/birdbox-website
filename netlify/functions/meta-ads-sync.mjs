/* netlify/functions/meta-ads-sync.mjs
 *
 * Fills in what each advert has actually cost, once a night.
 *
 * It never scans an ad account. It reads course_adverts, takes the Meta
 * ids an admin has pasted in, and asks about those specifically. An
 * advert that is not recorded against a course is never queried, so
 * anything running for online courses, merch or anything else stays
 * invisible to the portal.
 *
 * The two ad accounts sit in different business portfolios, and a
 * system user token only reaches its own portfolio. So there are two
 * tokens and each object is tried against both — whichever answers is
 * the right one. Fewer moving parts than recording which advert lives
 * where, and it keeps working if an account is ever moved.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://yvdmazpxtpuvidlcifnq.supabase.co";

// Pinned rather than floating: v19 sunset in May 2026 and an
// unversioned call would move under us without warning.
const GRAPH = "https://graph.facebook.com/v25.0";

// Lifetime, not the last week. The panel shows what a seminar's
// advertising has cost in total, which is the number that sits against
// what the seminar took.
const RANGE = "maximum";

const serviceKey = () =>
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  null;

const money = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const whole = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

// One object, one token. Returns the numbers, or says why not.
async function insights(objectId, token) {
  const url = `${GRAPH}/${encodeURIComponent(objectId)}/insights` +
    `?date_preset=${RANGE}` +
    `&fields=spend,impressions,clicks,account_currency` +
    `&access_token=${encodeURIComponent(token)}`;

  let res, body;
  try {
    res = await fetch(url);
    body = await res.json();
  } catch (err) {
    return { ok: false, retry: true, error: "Could not reach Meta: " + err.message };
  }

  if (body && body.error) {
    const code = body.error.code;
    // 190 is a bad token, 100/803 is an object this token cannot see.
    // Both mean "try the other token", not "give up".
    const wrongToken = code === 190 || code === 100 || code === 803 || code === 200;
    return { ok: false, retry: wrongToken, error: body.error.message || "Meta refused the request" };
  }

  if (!res.ok) {
    return { ok: false, retry: true, error: `Meta returned ${res.status}` };
  }

  // No rows means the advert has never delivered — not an error. Zero
  // spend is the honest answer, and it stops a brand new advert
  // looking like a broken one.
  const row = (body && body.data && body.data[0]) || {};

  return {
    ok: true,
    spend_cents: money(row.spend) ?? 0,
    impressions: whole(row.impressions),
    clicks: whole(row.clicks),
    currency: row.account_currency || null,
  };
}

export default async () => {
  const key = serviceKey();
  if (!key) {
    return new Response(JSON.stringify({
      error: "No Supabase service key. Expected SUPABASE_SERVICE_ROLE_KEY " +
             "(or SUPABASE_SERVICE_KEY) in the Netlify environment.",
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const tokens = [
    { name: "birdbox", value: process.env.META_ADS_TOKEN },
    { name: "tgc", value: process.env.META_ADS_TOKEN_TGC },
  ].filter((t) => t.value);

  if (!tokens.length) {
    return new Response(JSON.stringify({
      error: "No Meta tokens. Expected META_ADS_TOKEN and META_ADS_TOKEN_TGC.",
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const db = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false },
  });

  const { data: rows, error } = await db
    .from("course_adverts")
    .select("id, label, meta_object_id, currency")
    .not("meta_object_id", "is", null);

  if (error) {
    return new Response(JSON.stringify({ error: "Could not read adverts: " + error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const now = new Date().toISOString();
  let synced = 0, failed = 0;
  const problems = [];

  for (const advert of rows || []) {
    let result = null;
    let lastError = "no token could read it";

    for (const token of tokens) {
      const attempt = await insights(advert.meta_object_id, token.value);
      if (attempt.ok) { result = attempt; break; }
      lastError = attempt.error;
      if (!attempt.retry) break;   // a real failure, not the wrong token
    }

    if (!result) {
      failed++;
      problems.push(`${advert.label || advert.meta_object_id}: ${lastError}`);
      await db.from("course_adverts").update({
        sync_error: lastError,
        synced_at: now,
        updated_at: now,
      }).eq("id", advert.id);
      continue;
    }

    const patch = {
      spend_cents: result.spend_cents,
      impressions: result.impressions,
      clicks: result.clicks,
      synced_at: now,
      sync_error: null,
      updated_at: now,
    };

    // Meta knows which currency the account bills in, and it is a
    // better source than whatever was picked from a dropdown months
    // ago. Only overwritten when Meta actually says.
    if (result.currency) patch.currency = result.currency;

    const { error: upErr } = await db.from("course_adverts")
      .update(patch).eq("id", advert.id);

    if (upErr) {
      failed++;
      problems.push(`${advert.label || advert.meta_object_id}: ${upErr.message}`);
    } else {
      synced++;
    }
  }

  return new Response(JSON.stringify({
    checked: (rows || []).length,
    synced,
    failed,
    problems: problems.slice(0, 20),
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

// Every night at 03:10 UTC — after the day has closed in the Americas,
// before anybody in Europe opens the portal.
export const config = {
  schedule: "10 3 * * *",
};
