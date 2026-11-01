// netlify/functions/move-send.mjs
//
// The CoachRx move email (Nathan, 1 Nov 2026). Each athlete Barney
// invited (train.move_offers, loaded from his sheet) gets one email from
// BirdBox, with Barney copied, and a button to their own page
// (/learn/?move=CODE). There one tap emails them a login link, and once
// in they see their offer: their price, Tier 2 where offered, and the
// free trial only for someone not paying CoachRx now.
//
// Admin only. Nothing goes out without one of these being asked for:
//
//   POST { list: true }                 -> { offers }   everyone, for the portal
//   POST { preview: email }             -> { subject, text }   nothing sent
//   POST { test: email, to }            -> that person's email, sent to "to"
//                                          only; their status is not changed
//   POST { send: true, emails? }        -> up to 10 of those still "ready"
//                                          (or just the emails listed) are
//                                          sent and marked "emailed";
//                                          { sent, failed, remaining }

import { createClient } from "@supabase/supabase-js";
import { senderFor, sendEmail } from "./course-email-send.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const train = supabase.schema("train");

const SITE = (process.env.SITE_URL || "https://birdboxcoaching.com").replace(/\/+$/, "");
const BARNEY = process.env.MOVE_CC || "barney@birdboxcoaching.com";
const MOVE_DAY = "Monday 9 November";
const BATCH = 10;
const APP_STORE = "https://apps.apple.com/app/id6806654607";
const PLAY_STORE = "https://play.google.com/store/apps/details?id=com.birdboxcoaching.programming";

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return json({ error: "Not signed in" }, 401);
    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth || !auth.user) return json({ error: "Your session has expired — sign in again." }, 401);

    const { data: me } = await supabase
      .from("staff")
      .select("id, full_name, email, role, active")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (!me || !me.active) return json({ error: "Not a member of staff" }, 403);
    if (me.role !== "admin") return json({ error: "Only an admin can do this" }, 403);

    const b = await request.json();
    if (b.list) {
      const { data, error } = await train.from("move_offers")
        .select("email, first_name, last_name, offer, price_cents, free_until, coachrx_status, notes, status, emailed_at, moved_at, moved_tier, upgrade_until")
        .order("last_name");
      if (error) throw new Error(error.message);
      return json({ offers: data || [] });
    }
    if (b.preview) {
      const o = await offer(b.preview);
      return o ? json(write(o)) : json({ error: "No offer for that email." }, 404);
    }
    if (b.test) {
      const o = await offer(b.test);
      if (!o) return json({ error: "No offer for that email." }, 404);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.to || ""))) return json({ error: "Say who the test goes to." }, 400);
      const m = write(o);
      const r = await sendEmail({ to: b.to, sender: SENDER, subject: "[Test] " + m.subject, text: m.text, copyOffice: false });
      return r.ok ? json({ sent: true, to: b.to }) : json({ error: "The email did not send: " + r.error }, 502);
    }
    if (b.send === true) return json(await sendBatch(b.emails));
    return json({ error: "Nothing asked for." }, 400);
  } catch (err) {
    console.error("move-send failed:", err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

// From BirdBox, not from whoever pressed the button
const SENDER = senderFor({ full_name: "BirdBox Coaching", email: "info@birdboxcoaching.com" });

async function offer(email) {
  const { data } = await train.from("move_offers")
    .select("*").eq("email", String(email).trim().toLowerCase()).maybeSingle();
  return data;
}

async function sendBatch(emails) {
  let q = train.from("move_offers").select("*").eq("status", "ready").order("created_at").limit(BATCH);
  if (Array.isArray(emails) && emails.length) q = q.in("email", emails.map((e) => String(e).trim().toLowerCase()));
  const { data: list, error } = await q;
  if (error) throw new Error(error.message);

  const sent = [], failed = [];
  for (const o of list || []) {
    const m = write(o);
    const r = await sendEmail({ to: o.email, sender: SENDER, subject: m.subject, text: m.text,
      copyOffice: false, cc: [BARNEY] });
    if (!r.ok) { failed.push({ email: o.email, error: r.error }); continue; }
    await train.from("move_offers").update({ status: "emailed", emailed_at: new Date().toISOString() }).eq("id", o.id);
    sent.push(o.email);
  }
  const { count } = await train.from("move_offers").select("id", { count: "exact", head: true }).eq("status", "ready");
  return { sent, failed, remaining: count || 0 };
}

// The email, written for this one person's offer
function write(o) {
  const price = euro(o.price_cents);
  const t3 = 12000 - Math.max(0, 3500 - o.price_cents);
  const offerLine = {
    t2_offer: `Your price is ${price} a month, VAT included. For the same ${price} you can choose Tier 2, which adds the premium community and feedback through it. Your price stays for as long as you keep your plan.`,
    t1_promised: `You keep your price of ${price} a month, VAT included, for as long as you keep your plan.`,
    t1_only: `Your price is ${price} a month, VAT included, for as long as you keep your plan.`,
  }[o.offer];
  const payLine = o.free_until
    ? `You have already paid CoachRx up to ${day(o.free_until)}, so nothing is charged on BirdBox Train until then. Your CoachRx payments stop on ${MOVE_DAY}; nothing more is taken there.`
    : "Your first payment is taken when you join. You can take the two-week free trial instead, but if you do, the offer above is no longer available and after the two weeks you will see the normal prices.";
  // on €35 Tier 3 is the normal €120, so only Tier 2 is offered later
  const upLine = o.offer === "t1_only" ? null
    : t3 < 12000
      ? `For 40 days after you join you can also move up a tier at a reduced price, from the same page: Tier 2 (blog + community) for €35, or Tier 3 (blog + 1:1 feedback from a coach) for ${euro(t3)} a month.`
      : "If you start on Tier 1, you can still move to Tier 2 for €35 at any time in your first 40 days, from the same page.";

  const text = [
    `Hi ${o.first_name || "there"},`,
    `As Barney mentioned, your programming is moving from CoachRx to our own app, BirdBox Train, on ${MOVE_DAY}. It is the same programming from the same coaches, with your videos and your training history in one place.`,
    offerLine,
    payLine,
    upLine,
    `[[BUTTON: See my offer | ${SITE}/learn/?move=${o.code}]]`,
    "The button opens BirdBox Learn. Tap \"Email me my login link\" and we send a link to this email address. It takes you straight to your offer: choose your plan and add your card.",
    "Then download the BirdBox Train app and sign in with this same email:",
    `[[BUTTON: App Store | ${APP_STORE}]]`,
    `[[BUTTON: Google Play | ${PLAY_STORE}]]`,
    "Any questions, just reply to this email. Barney is copied in.",
    "Nathan and Barney\nBirdBox Coaching",
  ].filter(Boolean).join("\n\n");

  return { subject: "Your programming is moving to BirdBox Train", text };
}

function euro(cents) {
  return "€" + (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));
}

function day(d) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-IE", { day: "numeric", month: "long", timeZone: "UTC" });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
