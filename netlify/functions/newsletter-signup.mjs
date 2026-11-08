// netlify/functions/newsletter-signup.mjs
//
// The "Join Coaches Worldwide" box at the foot of the home, TGC and TCC pages
// (Nathan, 8 Nov 2026: Sarah found it had never saved anything).
//
// POST { email, brand, page, website }   ("website" is a hidden trap field)
//   -> { ok: true } once the email is saved
//
// Saved to public.interest_signups, the same table as the TEC, TWC, quiz,
// trial and programming forms. Its database trigger (brevo_sync) sends each
// new row to the Supabase function brevo-sync, which adds the person in
// Brevo to General, their brand's list (TGC or TCC; home = General only)
// and their region's list. So this needs no Brevo key of its own.
//
// Country comes from where the visit came from (Netlify's geo lookup), so
// the region list is right without asking.
//
// One row per brand and email (unique index). Someone already on that
// brand's list is told thanks and nothing changes.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// brevo-sync knows these; anything else counts as the home page
const BRANDS = new Set(["tgc", "tcc"]);

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Please enter a valid email address." }, 400); }

  // a bot filling every field: say thanks, save nothing
  if (String(body.website || "").trim()) return json({ ok: true });

  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  if (!EMAIL.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  const brand = BRANDS.has(body.brand) ? body.brand : "home";
  const page = String(body.page || "").slice(0, 100);
  const country = context?.geo?.country?.code || null;

  const { error } = await supabase.from("interest_signups").insert({
    email,
    brand,
    country,
    source: `newsletter ${page}`.trim(),
    lang: "en", // the box is on English pages; Brevo emails use this
  });
  if (error && error.code !== "23505") {
    console.error("newsletter-signup save:", error.message);
    return json({ error: "Sorry, that didn't save. Please try again in a minute." }, 500);
  }
  // 23505: already signed up for this brand, so already in Brevo
  return json({ ok: true });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
