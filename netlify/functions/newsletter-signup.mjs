// netlify/functions/newsletter-signup.mjs
//
// The "Join Coaches Worldwide" box at the foot of the home, TGC and TCC pages
// (Nathan, 8 Nov 2026: Sarah found it had never saved anything).
//
// POST { email, brand, page, website }   ("website" is a hidden trap field)
//   -> { ok: true } once the email is saved
//
// 1. Saved first to public.email_signups, so nobody is lost if Brevo is down
//    or not set up yet. One row per email (lower-cased, unique index).
// 2. Then added to the Brevo list in BREVO_NEWSLETTER_LIST_ID, using
//    BREVO_API_KEY. synced_at or sync_error records how that went.
//
// Unsubscribing stays with Brevo: someone who unsubscribed there and signs up
// here again is added back to the list but stays blocked from emails until
// they choose otherwise in Brevo.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// the table allows these brands; the home page saves with none
const BRANDS = new Set(["tgc", "tcc", "tec", "twc"]);
const CONSENT = "Join Coaches Worldwide: get updates, resources, and exclusive offers.";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Please enter a valid email address." }, 400); }

  // a bot filling every field: say thanks, save nothing
  if (String(body.website || "").trim()) return json({ ok: true });

  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  if (!EMAIL.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  const brand = BRANDS.has(body.brand) ? body.brand : null;
  const page = String(body.page || "").slice(0, 100);

  // 1. save it
  const { data: row, error } = await supabase.from("email_signups")
    .insert({ email, brand, source: `footer ${page}`.trim(), consent: true, consent_text: CONSENT })
    .select("id").single();
  let id = row?.id;
  if (error) {
    if (error.code !== "23505") {
      console.error("newsletter-signup save:", error.message);
      return json({ error: "Sorry, that didn't save. Please try again in a minute." }, 500);
    }
    // already signed up: try Brevo again below, in case it failed last time
    const { data: old } = await supabase.from("email_signups").select("id").eq("email", email).maybeSingle();
    id = old?.id;
  }

  // 2. Brevo
  const key = process.env.BREVO_API_KEY;
  const list = Number(process.env.BREVO_NEWSLETTER_LIST_ID);
  if (!key || !list) {
    console.warn("newsletter-signup: Brevo not set up, saved only");
    if (id) await supabase.from("email_signups").update({ sync_error: "Brevo not set up" }).eq("id", id);
    return json({ ok: true });
  }
  try {
    const r = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, listIds: [list], updateEnabled: true }),
    });
    const ok = r.ok || r.status === 204;
    const why = ok ? null : `Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`;
    if (why) console.error("newsletter-signup:", why);
    if (id) await supabase.from("email_signups")
      .update(ok ? { synced_at: new Date().toISOString(), sync_error: null } : { sync_error: why })
      .eq("id", id);
  } catch (err) {
    console.error("newsletter-signup Brevo:", err.message || err);
    if (id) await supabase.from("email_signups").update({ sync_error: String(err.message || err).slice(0, 200) }).eq("id", id);
  }
  // saved either way, so the person is told it worked
  return json({ ok: true });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
