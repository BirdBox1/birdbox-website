// netlify/lib/mentorship-apply.mjs
//
// BirdBox Mentorship pre-registration (Nathan, 25 Nov 2026; starts 4 Jan 2027).
// Shared by netlify/functions/mentorship-apply.mjs (the form) and the Stripe
// webhook (when their card is saved).
//
// Pre-registering saves a card and charges NOTHING. The €150 discovery call
// fee is only taken once the call is booked and confirmed (a later step).

import Stripe from "stripe";
import { db, sendMail, OFFICE, esc } from "./directory.mjs";
import { learnStartLink } from "../functions/learnworlds.mjs";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
export const KIND = "mentorship-apply";
export const isMentorshipApply = (obj) => obj?.metadata?.kind === KIND;

// ---------- business VAT numbers (same rules as online courses) ----------
export const EU_VAT_PREFIXES = new Set(["AT","BE","BG","CY","CZ","DE","DK","EE","EL","ES","FI","FR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","XI"]);
const euPrefix = (country) => (country === "GR" ? "EL" : country);
export function taxIdFor(raw, country) {
  const v = String(raw || "").toUpperCase().replace(/[\s.\-]/g, "");
  if (!v) return null;
  const has = /^[A-Z]{2}/.test(v);
  let prefix = has ? v.slice(0, 2) : euPrefix(String(country || "").toUpperCase());
  if (prefix === "GR") prefix = "EL";
  const number = has ? v.slice(2) : v;
  const value = prefix + number;
  if (EU_VAT_PREFIXES.has(prefix)) return { type: "eu_vat", value, number, eu: true, prefix };
  if (prefix === "GB") return { type: "gb_vat", value, number, eu: false, prefix };
  return { type: null, value: String(raw).trim(), number, eu: false, prefix };
}
// The EU's own register. true = valid, false = not valid, null = no answer.
export async function viesCheck(prefix, number) {
  try {
    const res = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${prefix}/vat/${encodeURIComponent(number)}`,
      { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const j = await res.json();
    if (j.isValid === true) return true;
    if (j.userError && j.userError !== "VALID" && j.userError !== "INVALID") return null;
    return false;
  } catch (err) { console.warn("VIES check failed", prefix, err.message); return null; }
}

// ---------- when Stripe says the card is saved ----------
// checkout.session.completed with mode "setup" and metadata.kind = KIND.
export async function onMentorshipCardSaved(session) {
  const id = session.metadata?.application_id;
  if (!id) return;
  const { data: app } = await db.from("mentor_applications").select("*").eq("id", id).maybeSingle();
  if (!app) { console.error("mentorship-apply: no application", id); return; }
  if (app.status !== "pending_card") return; // already done (Stripe can send twice)

  // The saved card becomes their default, ready for the €150 later.
  let pm = null;
  const siId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (siId) {
    const si = await stripe.setupIntents.retrieve(siId);
    pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id || null;
    if (pm && app.stripe_customer_id) await stripe.customers.update(app.stripe_customer_id, { invoice_settings: { default_payment_method: pm } });
  }

  // Their BirdBox login: made now if they don't have one (Nathan, 25 Nov).
  // An existing login is fine: Learn finds the application by their email.
  let userId = null;
  const made = await db.auth.admin.createUser({ email: app.email, email_confirm: true, user_metadata: { first_name: app.first_name, last_name: app.last_name } });
  if (made.data?.user) userId = made.data.user.id;
  else if (made.error && !/already|registered|exists/i.test(made.error.message || "")) console.error("mentorship-apply createUser:", made.error.message);

  await db.from("mentor_applications").update({ status: "applied", payment_method_id: pm, user_id: userId, updated_at: new Date().toISOString() }).eq("id", id);
  await Promise.all([welcomeEmail(app), officeEmail(app)]);
}

async function welcomeEmail(app) {
  const link = learnStartLink(app.email, 30);
  const text = [
    `Hi ${app.first_name || "there"},`,
    `You're pre-registered for BirdBox Mentorship, starting Monday 4 January 2027.`,
    `Nothing has been charged. Your card is saved to hold your place.`,
    `What happens next:`,
    `1. We match you with your mentor.`,
    `2. Your mentor offers you times for your discovery call (60 to 90 minutes). The €150 fee is only taken once your call is booked.`,
    `3. After the call you get your written Discovery Report, and if mentorship is the right fit we invite you to continue.`,
    `You can see all of this in your BirdBox account: ${link}`,
    `Any questions, just reply to this email.`,
    `BirdBox Coaching`,
  ].join("\n\n");
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#16181b;max-width:560px">
    <p>Hi ${esc(app.first_name || "there")},</p>
    <p><b>You're pre-registered for BirdBox Mentorship</b>, starting Monday 4 January 2027.</p>
    <p style="background:#eef4fb;border-radius:8px;padding:10px 14px"><b>Nothing has been charged.</b> Your card is saved to hold your place.</p>
    <p><b>What happens next</b></p>
    <ol style="padding-left:20px"><li>We match you with your mentor.</li><li>Your mentor offers you times for your discovery call (60 to 90 minutes). The €150 fee is only taken once your call is booked.</li><li>After the call you get your written Discovery Report, and if mentorship is the right fit we invite you to continue.</li></ol>
    <p><a href="${esc(link)}" style="display:inline-block;background:#2f7fd0;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:7px">Open my BirdBox account</a></p>
    <p>Any questions, just reply to this email.</p><p>BirdBox Coaching</p></div>`;
  return sendMail({ to: app.email, subject: "You're pre-registered for BirdBox Mentorship", text, html });
}

async function officeEmail(app) {
  const a = app.answers || {};
  let mentor = "No preference";
  if (app.preferred_mentor) { const { data } = await db.from("staff").select("full_name").eq("id", app.preferred_mentor).maybeSingle(); mentor = data?.full_name || mentor; }
  const lines = [
    `${app.first_name} ${app.last_name} (${app.email}) has pre-registered for BirdBox Mentorship. Card saved, nothing charged.`,
    `Country: ${app.country || "-"} · time zone ${app.tz || "-"}${app.phone ? " · " + app.phone : ""}`,
    `Role: ${a.role || "-"} · coaching ${a.years || "-"} years${a.gym ? " · " + a.gym : ""}`,
    `Help with: ${(a.help || []).join(", ") || "-"}`,
    a.why ? `In their words: "${a.why}"` : "",
    `Preferred mentor: ${mentor} · best times: ${(a.times || []).join(", ") || "-"}`,
    app.business_name ? `Business: ${app.business_name}${app.vat_number ? " · VAT " + app.vat_number + " (" + (app.vat_checked || "-") + ")" : ""}` : "",
    `Next: allocate a mentor in the mentor portal (New mentees).`,
  ].filter(Boolean);
  return sendMail({ to: OFFICE, subject: `New mentorship pre-registration: ${app.first_name} ${app.last_name}`, text: lines.join("\n\n"), html: lines.map((l) => `<p>${esc(l)}</p>`).join("") });
}
