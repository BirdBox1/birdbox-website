// netlify/functions/learn-account.mjs
//
// The Programming and Receipts tabs of BirdBox Learn (Nathan, 1 Nov 2026).
// Signed in with the Learn login (Authorization: Bearer <token>), which is
// the same login as the Train app.
//
// GET  ?part=programming  -> { plans, blocks }
// GET  ?part=receipts     -> { receipts }
// POST { action: "portal", subscription }  -> { url }
//
// Programming comes from the app's own records (schema train). Receipts are
// every successful payment on BirdBox's Stripe account made by a customer
// with this login's email: seminars, online courses, programming, blocks,
// T-shirts and gift cards alike. Nothing here changes a course, a plan or a
// payment; "portal" only opens Stripe's own page for one of their plans.

import Stripe from "stripe";
import { db, json, userFrom } from "../lib/directory.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const RETURN_URL = "https://www.birdboxcoaching.com/learn/#programming";
const train = () => db.schema("train");

// the plan names the buyer saw (train.stripe_prices labels)
const TIER = {
  1: "TGC Athlete Programming",
  2: "TGC Athlete + Community",
  3: "TGC Athlete + 1:1 Feedback",
  4: "BirdBox Bespoke 1:1",
  5: "BirdBox Full Programme 1:1",
  6: "Block",
  7: "Block with feedback",
};

export default async (req) => {
  const user = await userFrom(req);
  if (!user) return json({ error: "Please log in again." }, 401);
  const email = String(user.email || "").trim().toLowerCase();

  try {
    if (req.method === "GET") {
      const part = new URL(req.url).searchParams.get("part");
      if (part === "programming") return json(await programming(user, email));
      if (part === "receipts") return json({ receipts: await receipts(email) });
      return json({ error: "Which part?" }, 400);
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.action === "portal") return portal(user, email, String(body.subscription || ""));
      return json({ error: "Unknown action" }, 400);
    }
    return json({ error: "Use GET or POST" }, 405);
  } catch (e) {
    console.error("learn-account:", e.message);
    return json({ error: "Something went wrong. Try again in a minute, or write to info@birdboxcoaching.com." }, 500);
  }
};

// their athlete record in the app: by login, then by email
async function athleteOf(user, email) {
  const { data: byId } = await train().from("athletes").select("id, email").eq("id", user.id).maybeSingle();
  if (byId) return byId;
  const { data: byEmail } = await train().from("athletes").select("id, email").ilike("email", email).limit(1);
  return byEmail?.[0] || null;
}

async function programming(user, email) {
  const a = await athleteOf(user, email);
  if (!a) return { plans: [], blocks: [] };

  const { data: enr } = await train().from("enrolments")
    .select("id, tier, status, start_date, end_date, stripe_subscription_id, is_trial, coach_id, tracks(name, brand)")
    .eq("athlete_id", a.id)
    .in("status", ["consulting", "active", "past_due", "paused"])
    .order("created_at", { ascending: false });

  const coachIds = [...new Set((enr || []).map((e) => e.coach_id).filter(Boolean))];
  const coaches = new Map();
  if (coachIds.length) {
    const { data } = await db.from("staff").select("id, full_name").in("id", coachIds);
    for (const s of data || []) coaches.set(s.id, s.full_name);
  }

  const plans = [];
  const blocks = [];
  for (const e of enr || []) {
    const base = {
      name: e.is_trial ? "Two-week free trial" : TIER[e.tier] || e.tracks?.name || "Programming",
      programme: e.tracks?.name || null,
      brand: String(e.tracks?.brand || "tgc").toLowerCase(),
      coach: coaches.get(e.coach_id) || null,
      started: e.start_date,
      ends: e.end_date,
      status: e.status,
    };
    if (e.tier === 6 || e.tier === 7) { blocks.push(base); continue; }
    const plan = { ...base, subscription: e.stripe_subscription_id || null, trial: !!e.is_trial };
    if (e.stripe_subscription_id) {
      try {
        const s = await stripe.subscriptions.retrieve(e.stripe_subscription_id);
        const item = s.items?.data?.[0];
        const end = item?.current_period_end || s.current_period_end;
        plan.next_payment = !s.cancel_at_period_end && end ? new Date(end * 1000).toISOString().slice(0, 10) : null;
        plan.ends_on = s.cancel_at_period_end && end ? new Date(end * 1000).toISOString().slice(0, 10) : null;
        plan.amount = item?.price?.unit_amount ?? null;
        plan.currency = s.currency || item?.price?.currency || "eur";
        plan.manage = true;
      } catch (x) { plan.manage = false; }
    }
    plans.push(plan);
  }

  // blocks waiting for their start date are not enrolments yet
  const { data: waiting } = await train().from("purchases")
    .select("weeks, status, purchased_at, tpl:tracks!purchases_template_id_fkey(name, brand)")
    .eq("athlete_id", a.id).eq("status", "awaiting_start");
  for (const p of waiting || []) {
    blocks.push({ name: p.tpl?.name || "Block", programme: p.tpl?.name || null,
      brand: String(p.tpl?.brand || "tgc").toLowerCase(), coach: null,
      started: null, ends: null, status: "awaiting_start", weeks: p.weeks });
  }
  return { plans, blocks };
}

// every Stripe customer with this email: the list is exact about case, so
// Stripe's search (which is not) is asked as well
async function customersOf(email) {
  const seen = new Map();
  for await (const c of stripe.customers.list({ email, limit: 100 })) seen.set(c.id, c);
  try {
    const found = await stripe.customers.search({ query: `email:'${email.replace(/'/g, "\\'")}'`, limit: 100 });
    for (const c of found.data || []) seen.set(c.id, c);
  } catch (x) {}
  return [...seen.values()];
}

async function receipts(email) {
  const out = [];
  for (const c of await customersOf(email)) {
    const charges = await stripe.charges.list({ customer: c.id, limit: 100, expand: ["data.invoice"] });
    for (const ch of charges.data || []) {
      if (ch.status !== "succeeded" || !ch.paid) continue;
      const inv = ch.invoice && typeof ch.invoice === "object" ? ch.invoice : null;
      const line = inv?.lines?.data?.[0]?.description || null;
      out.push({
        date: new Date(ch.created * 1000).toISOString(),
        what: inv?.description || line || ch.description || ch.calculated_statement_descriptor || "Payment",
        amount: ch.amount,
        refunded: ch.amount_refunded || 0,
        currency: ch.currency,
        number: inv?.number || ch.receipt_number || null,
        receipt: ch.receipt_url || null,
        invoice: inv?.invoice_pdf || null,
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// Stripe's own page for one of their plans: change plan, card, or cancel
async function portal(user, email, subId) {
  const a = await athleteOf(user, email);
  if (!a || !/^sub_\w+$/.test(subId)) return json({ error: "That plan could not be found." }, 404);
  const { data: mine } = await train().from("enrolments").select("id")
    .eq("athlete_id", a.id).eq("stripe_subscription_id", subId).limit(1);
  if (!mine?.length) return json({ error: "That plan could not be found." }, 404);
  const s = await stripe.subscriptions.retrieve(subId);
  const session = await stripe.billingPortal.sessions.create({
    customer: typeof s.customer === "string" ? s.customer : s.customer.id,
    return_url: RETURN_URL,
  });
  return json({ url: session.url });
}
