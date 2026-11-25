// netlify/functions/mentorship-apply.mjs
//
// POST from /mentorship/apply/ (BirdBox Mentorship pre-registration,
// Nathan 25 Nov 2026; starts 4 Jan 2027).
//
// Saves the application, then opens Stripe Checkout in SETUP mode: the card
// is saved to hold their place and NOTHING is charged. When Stripe confirms,
// the webhook (onMentorshipCardSaved in netlify/lib/mentorship-apply.mjs)
// marks them "applied", makes their BirdBox login if needed and emails them
// and the office.
//
// A business can add its name and VAT number. EU numbers are checked with
// the EU register; a valid one from outside Ireland means reverse charge
// later (same rules as online courses). The number goes on the Stripe
// customer so every invoice shows it.

import { db, json } from "../lib/directory.mjs";
import { stripe, KIND, taxIdFor, viesCheck } from "../lib/mentorship-apply.mjs";

const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const list = (v, n = 12) => (Array.isArray(v) ? v.map((x) => clean(x, 60)).filter(Boolean).slice(0, n) : []);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const b = await req.json().catch(() => ({}));
  const email = clean(b.email, 200).toLowerCase();
  const first = clean(b.first_name, 80), last = clean(b.last_name, 80);
  const country = clean(b.country, 2).toUpperCase();
  if (!first || !last) return json({ error: "Please add your name." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Please check your email address." }, 400);
  if (!/^[A-Z]{2}$/.test(country)) return json({ error: "Please choose your country." }, 400);
  if (!b.agree_record || !b.agree_card) return json({ error: "Please tick both boxes to continue." }, 400);

  try {
    // Business details and VAT number
    let business = null, vat = null, vatChecked = null, reverse = false;
    if (b.business) {
      business = clean(b.business_name, 120);
      if (!business) return json({ error: "Add your business name, or untick the business box." }, 400);
      vat = taxIdFor(b.vat_number, country);
      if (vat && vat.eu) {
        const ok = await viesCheck(vat.prefix, vat.number);
        if (ok === false) return json({ error: "The EU VAT register doesn't recognise that VAT number. Check it, or leave it blank." }, 400);
        vatChecked = ok ? "valid" : "unchecked";
        reverse = vat.prefix !== "IE";
      }
    }

    const pref = UUID.test(String(b.preferred_mentor || "")) ? b.preferred_mentor : null;
    const answers = {
      role: clean(b.role, 60), years: clean(b.years, 20), gym: clean(b.gym, 160),
      help: list(b.help), why: clean(b.why, 1500), quals: clean(b.quals, 300),
      times: list(b.times), heard: clean(b.heard, 80),
    };

    // One live application per email: a second go updates it.
    const { data: existing } = await db.from("mentor_applications").select("id, status, stripe_customer_id")
      .ilike("email", email.replace(/[%_\\]/g, "\\$&")).not("status", "in", "(withdrawn,declined)").order("created_at", { ascending: false }).limit(1);
    const prev = existing?.[0];
    if (prev && prev.status !== "pending_card") {
      return json({ error: "You're already pre-registered with this email. Check your BirdBox account, or reply to your confirmation email." }, 409);
    }

    // Their Stripe customer (main Irish account), with the business VAT number on it
    let customerId = prev?.stripe_customer_id || null;
    const custFields = { email, name: business || `${first} ${last}`, address: { country }, preferred_locales: ["en"],
      metadata: { kind: KIND, person: `${first} ${last}` } };
    if (customerId) await stripe.customers.update(customerId, custFields);
    else customerId = (await stripe.customers.create(custFields)).id;
    if (vat && vat.type) {
      try { await stripe.customers.createTaxId(customerId, { type: vat.type, value: vat.value }); }
      catch (err) { if (!/already/i.test(err.message || "")) console.warn("mentorship-apply tax id:", err.message); }
    }

    const row = {
      email, first_name: first, last_name: last, phone: clean(b.phone, 40) || null, country, tz: clean(b.tz, 60) || null,
      answers, preferred_mentor: pref, business_name: business, vat_number: vat ? vat.value : null,
      vat_checked: vatChecked, reverse_charge: reverse, stripe_customer_id: customerId, status: "pending_card", updated_at: new Date().toISOString(),
    };
    let id = prev?.id;
    if (id) { const r = await db.from("mentor_applications").update(row).eq("id", id); if (r.error) throw r.error; }
    else { const r = await db.from("mentor_applications").insert(row).select("id").single(); if (r.error) throw r.error; id = r.data.id; }

    // Stripe's own page to save the card. Nothing is charged.
    const origin = new URL(req.url).origin;
    const meta = { kind: KIND, application_id: id, email };
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      currency: "eur",
      payment_method_types: ["card"],
      metadata: meta,
      setup_intent_data: { metadata: meta, description: "BirdBox Mentorship: card saved to hold your place (nothing charged)" },
      custom_text: { submit: { message: "Nothing is charged now. The €150 discovery call fee is only taken once your call is booked and confirmed." } },
      success_url: `${origin}/mentorship/welcome/?a=${id}`,
      cancel_url: `${origin}/mentorship/apply/?cancelled=1`,
    });
    return json({ url: session.url });
  } catch (err) {
    console.error("mentorship-apply", err);
    return json({ error: "Something went wrong. Please try again in a moment." }, 500);
  }
};
