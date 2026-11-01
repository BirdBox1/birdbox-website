// netlify/functions/learn-account.mjs
//
// The Programming and Receipts tabs of BirdBox Learn (Nathan, 1 Nov 2026).
// Signed in with the Learn login (Authorization: Bearer <token>), which is
// the same login as the Train app.
//
// GET  ?part=programming  -> { plans, blocks }
// GET  ?part=receipts     -> { receipts }
// POST { action: "portal", subscription }  -> { url }
// POST { action: "invoice", charge, company?, vat? }  -> { pdf, filename }
// GET  ?part=me           -> { known }   false: directory-only login
// GET  ?part=discounts    -> { discounts, name }   their Level 1 50% offers
// POST { action: "seminar_pass", brand }  -> { pass, url }
// POST { action: "online_offer", brand }  -> { url }
//
// Programming comes from the app's own records (schema train). Receipts are
// every successful payment on BirdBox's Stripe account made by a customer
// with this login's email: seminars, online courses, programming, blocks,
// T-shirts and gift cards alike. Nothing here changes a course, a plan or a
// payment; "portal" only opens Stripe's own page for one of their plans.

import Stripe from "stripe";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { randomBytes } from "node:crypto";
import { db, json, userFrom } from "../lib/directory.mjs";
import { knownToBirdBox } from "../lib/known.mjs";
import { BRANDS, discountsFor, lockedName, makePass, passUsed, PASS_PERCENT } from "../lib/learn-pass.mjs";

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

export default async (req, context) => {
  const user = await userFrom(req);
  if (!user) return json({ error: "Please log in again." }, 401);
  const email = String(user.email || "").trim().toLowerCase();

  try {
    if (req.method === "GET") {
      const part = new URL(req.url).searchParams.get("part");
      if (part === "programming") return json({ ...(await programming(user, email)),
        staff: await isStaff(user), shop: await shop(context), trial_ok: await trialOk(user, email) });
      if (part === "receipts") return json({ receipts: await receipts(email) });
      // a directory-only login (no BirdBox record yet) sees only their listing
      if (part === "me") return json({ known: (await isStaff(user)) || (await knownToBirdBox(email)) });
      if (part === "discounts") {
        const name = await lockedName(user, email);
        return json({ discounts: await discountsFor(user, email), percent: PASS_PERCENT,
          // a name already on a BirdBox certificate is the one every new certificate uses
          certificate_name: name?.from === "certificate" ? `${name.first} ${name.last}` : null });
      }
      return json({ error: "Which part?" }, 400);
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.action === "portal") return portal(user, email, String(body.subscription || ""));
      if (body.action === "invoice") return invoice(email, body);
      if (body.action === "seminar_pass") return seminarPass(user, email, String(body.brand || ""));
      if (body.action === "online_offer") return onlineOffer(user, email, String(body.brand || ""));
      return json({ error: "Unknown action" }, 400);
    }
    return json({ error: "Use GET or POST" }, 405);
  } catch (e) {
    console.error("learn-account:", e.message);
    return json({ error: "Something went wrong. Try again in a minute, or write to info@birdboxcoaching.com." }, 500);
  }
};

// The free fortnight is only for someone who has never had programming
// with us: no plan, block or trial, ever (the app's start_trial refuses
// anyone else too).
async function trialOk(user, email) {
  const a = await athleteOf(user, email);
  if (!a) return true;
  const { data: me } = await train().from("athletes").select("trial_started_at").eq("id", a.id).maybeSingle();
  if (me?.trial_started_at) return false;
  const { count: e } = await train().from("enrolments").select("id", { count: "exact", head: true }).eq("athlete_id", a.id);
  const { count: p } = await train().from("purchases").select("id", { count: "exact", head: true }).eq("athlete_id", a.id);
  return !(e || p);
}

async function isStaff(user) {
  const { data } = await db.from("staff").select("id").eq("id", user.id).eq("active", true).maybeSingle();
  return !!data;
}

// What they could join (Nathan, 1 Nov 2026), in their own currency as the
// app's checkout charges it. Only shown once programming is on sale; the
// page decides that. Prices come from the app's own price list.
const EUROPE = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "CH", "NO", "IS", "LI", "AD", "MC", "SM", "VA", "AL", "BA", "ME", "MK", "RS", "XK", "MD", "UA", "GI", "FO", "GL"]);
function currencyFor(country) {
  const c = String(country || "").toUpperCase();
  if (["GB", "IM", "JE", "GG"].includes(c)) return "gbp";
  if (c === "AU") return "aud";
  if (c === "CA") return "cad";
  if (EUROPE.has(c)) return "eur";
  return "usd";
}
// what each plan includes, as on the TGC programming page
const INCLUDES = {
  1: ["Blog programme", "Free community", "Weekly call"],
  2: ["Blog programme", "Premium community", "Group call", "Feedback via the community"],
  3: ["Blog programme", "Premium community", "Group call", "Written feedback from your coach"],
  4: ["Bespoke programme", "Premium community", "1:1 coach call", "Feedback written, by Loom or DM"],
  5: ["Bespoke programme", "Premium community", "1:1 coach call", "Feedback written, by Loom or DM"],
};
// the names on the TGC programming page; Tiers 4 and 5 are by application
const NAMES = { 4: "Bespoke 1:1, Skill Only", 5: "Full CF Programme, 1:1" };
// Grouped by course (TGC now; TCC, TEC and TWC programming later): a
// course appears as soon as its plans have prices or a block is on sale.
// Tiers 4 and 5 are BirdBox one-to-one coaching, not one course's.
async function shop(context) {
  const currency = currencyFor(context?.geo?.country?.code);
  const { data: prices } = await train().from("stripe_prices")
    .select("tier, label, amounts, tracks:track_id(brand)")
    .eq("active", true).in("tier", [1, 2, 3, 4, 5]).like("price_id", "price_%").order("tier");
  const plan = (p) => {
    const cur = p.amounts?.[currency] != null ? currency : "eur";
    return { tier: p.tier, name: NAMES[p.tier] || p.label, amount: p.amounts?.[cur] ?? null, currency: cur,
      includes: INCLUDES[p.tier] || [], apply: p.tier >= 4 };
  };
  const byBrand = new Map();
  const course = (b) => { if (!byBrand.has(b)) byBrand.set(b, { brand: b, plans: [], blocks: [] }); return byBrand.get(b); };
  for (const p of prices || []) if (p.tier <= 3) course(String(p.tracks?.brand || "tgc").toLowerCase()).plans.push(plan(p));
  const one_to_one = (prices || []).filter((p) => p.tier >= 4).map(plan);

  const { data: rate } = await train().from("block_rates").select("week_cents").eq("currency", currency).maybeSingle();
  const { data: tpls } = await train().from("tracks").select("id, name, brand, weeks, description, week_rate_cents")
    .eq("kind", "block").eq("is_template", true).eq("sale_status", "live").order("name");
  for (const t of tpls || []) {
    course(String(t.brand || "tgc").toLowerCase()).blocks.push({
      id: t.id, name: t.name, weeks: t.weeks || null, description: t.description || null,
      // without feedback, paid in full: the price everyone starts from
      from: (currency === "eur" ? (t.week_rate_cents || 995) : (rate?.week_cents || 995)) * (t.weeks || 1),
      currency,
    });
  }
  const order = ["tgc", "tcc", "tec", "twc"];
  const courses = [...byBrand.values()].sort((a, b) => (order.indexOf(a.brand) + 1 || 9) - (order.indexOf(b.brand) + 1 || 9));
  return { currency, courses, one_to_one };
}

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
    // given by BirdBox: a plan with no subscription behind it, not a trial
    const plan = { ...base, subscription: e.stripe_subscription_id || null, trial: !!e.is_trial,
      given: !e.stripe_subscription_id && !e.is_trial };
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

// A payment's items, VAT and invoice number, whichever way it was taken:
// a Stripe invoice (programming, monthly payments, most seminars), a
// checkout without one (one-off payments), or a bare payment (a block's
// 4-weekly payment, whose VAT the app recorded).
async function detailsOf(ch) {
  const inv = ch.invoice && typeof ch.invoice === "object" ? ch.invoice : null;
  const lines = [];
  if (inv) {
    for (const l of inv.lines?.data || []) {
      const taxes = l.tax_amounts || l.taxes || [];
      const tax = taxes.reduce((n, t) => n + (t.amount || 0), 0);
      const inclusive = taxes.some((t) => t.inclusive || t.tax_behavior === "inclusive");
      const after = l.amount - (l.discount_amounts || []).reduce((n, d) => n + (d.amount || 0), 0);
      lines.push({ what: l.description || "Item", net: inclusive ? after - tax : after, tax });
    }
  } else {
    const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
    if (pi) {
      const ss = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1, expand: ["data.line_items"] }).catch(() => null);
      for (const l of ss?.data?.[0]?.line_items?.data || []) {
        const qty = l.quantity && l.quantity > 1 ? ` × ${l.quantity}` : "";
        lines.push({ what: (l.description || "Item") + qty, net: l.amount_total - (l.amount_tax || 0), tax: l.amount_tax || 0 });
      }
      if (!lines.length) {
        const { data: p } = await db.schema("train").from("payments").select("tax_cents")
          .eq("stripe_invoice_id", pi).maybeSingle();
        const tax = p?.tax_cents || 0;
        lines.push({ what: ch.description || "Payment", net: ch.amount - tax, tax });
      }
    }
  }
  if (!lines.length) lines.push({ what: ch.description || "Payment", net: ch.amount, tax: 0 });
  return {
    what: inv?.description || lines[0].what.replace(/ × \d+$/, "") || ch.description || "Payment",
    lines,
    number: inv?.number || ch.receipt_number || ch.id.slice(-10).toUpperCase(),
    pdf: inv?.invoice_pdf || null,
  };
}

async function chargesOf(email) {
  const out = [];
  for (const c of await customersOf(email)) {
    const charges = await stripe.charges.list({ customer: c.id, limit: 100, expand: ["data.invoice"] });
    for (const ch of charges.data || []) if (ch.status === "succeeded" && ch.paid) out.push(ch);
  }
  return out;
}

async function receipts(email) {
  const out = [];
  for (const ch of await chargesOf(email)) {
    const d = await detailsOf(ch);
    out.push({
      id: ch.id,
      date: new Date(ch.created * 1000).toISOString(),
      what: d.what,
      amount: ch.amount,
      refunded: ch.amount_refunded || 0,
      currency: ch.currency,
      number: d.number,
      receipt: ch.receipt_url || null,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- the BirdBox invoice (Nathan, 1 Nov 2026) ----------
//
// For a payment already made: BirdBox's name, address and VAT number, the
// buyer, each item with its VAT, and "paid". Made the same each time from
// Stripe, so nothing is stored. A business can add its own name and VAT
// number; the VAT shown is what was charged and cannot change afterwards.

// the BirdBox logo for light pages, from the website itself; an invoice
// still downloads without it if it cannot be fetched
const LOGO_URL = (process.env.URL || "https://www.birdboxcoaching.com") + "/brand/birdBox.png";
let logoBytes = null;
async function logo() {
  if (!logoBytes) {
    const r = await fetch(LOGO_URL).catch(() => null);
    if (r && r.ok) logoBytes = new Uint8Array(await r.arrayBuffer());
  }
  return logoBytes;
}

const BIRDBOX = ["BirdBox Coaching Limited", "19 Baggot Street Lower", "Dublin 2, D02 X658", "Ireland", "VAT IE4429982WH"];

// the built-in fonts cover Western European letters; others lose accents
// or become "?" so the page still opens
const WIN = new Set([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"]);
const LOOKS = { "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "Ħ": "H", "ħ": "h", "ı": "i", "ŀ": "l", "Ŀ": "L" };
const plain = (t) => [...String(t ?? "")].map((ch) => {
  const c = ch.codePointAt(0);
  if (LOOKS[ch]) return LOOKS[ch];
  if ((c >= 32 && c < 127) || (c >= 160 && c < 256) || WIN.has(ch)) return ch;
  const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /^[\x20-\x7e]+$/.test(base) ? base : c === 10 ? " " : "?";
}).join("");

async function invoice(email, body) {
  const id = String(body.charge || "");
  if (!/^(ch|py)_\w+$/.test(id)) return json({ error: "That payment could not be found." }, 404);
  const mine = (await chargesOf(email)).find((c) => c.id === id);
  if (!mine) return json({ error: "That payment could not be found." }, 404);
  const company = plain(String(body.company || "").replace(/\s+/g, " ").trim().slice(0, 100));
  const vat = plain(String(body.vat || "").replace(/\s+/g, "").toUpperCase().slice(0, 20));

  const d = await detailsOf(mine);
  const cur = (mine.currency || "eur").toUpperCase();
  // a space after the symbol: in Helvetica the euro sign touches the figure
  const money = (c) => new Intl.NumberFormat("en-IE", { style: "currency", currency: cur }).format((c || 0) / 100)
    .replace(/^([^\d-]+)/, "$1 ").replace(/\s+/g, " ");
  const country = (code) => { try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code); } catch (x) { return code; } };
  const day = (t) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const b = mine.billing_details || {};
  const cust = mine.customer && typeof mine.customer === "object" ? mine.customer : null;
  const a = b.address || cust?.address || {};
  const to = [company || null, b.name || cust?.name || null, vat ? "VAT " + vat : null,
    a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(" "), a.state, a.country ? country(a.country) : null,
    b.email || email].filter(Boolean).map(plain);

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.08, 0.07);
  const text = (t, x, y, size = 10, bold = false) => page.drawText(plain(t), { x, y, size, font: bold ? fb : f, color: ink });
  const right = (t, x, y, size = 10, bold = false) => {
    const w = (bold ? fb : f).widthOfTextAtSize(plain(t), size);
    text(t, x - w, y, size, bold);
  };
  const rule = (y) => page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.6, color: ink });
  const fit = (t, max, size) => { let s2 = plain(t); while (s2.length > 3 && f.widthOfTextAtSize(s2, size) > max) s2 = s2.slice(0, -2); return s2 === plain(t) ? s2 : s2 + "…"; };

  let y = 790;
  const png = await logo();
  if (png) {
    try {
      const img = await doc.embedPng(png);
      const h = 64, w = h * img.width / img.height;
      page.drawImage(img, { x: 50, y: 754, width: w, height: h });
    } catch (x) {}
  }
  text("INVOICE", png ? 122 : 50, y - 10, 22, true);
  right(d.number, 545, y, 12, true);
  right("Date " + day(mine.created), 545, y - 16, 9);

  y = 725;
  text("From", 50, y, 9, true);
  text("To", 320, y, 9, true);
  BIRDBOX.forEach((l, i) => text(l, 50, y - 14 - i * 13));
  to.forEach((l, i) => text(fit(l, 225, 10), 320, y - 14 - i * 13));
  y = y - 14 - Math.max(BIRDBOX.length, to.length) * 13 - 24;

  text("Description", 50, y, 9, true);
  right("Before VAT", 395, y, 9, true);
  right("VAT", 470, y, 9, true);
  right("Total", 545, y, 9, true);
  y -= 6; rule(y); y -= 16;
  let net = 0, tax = 0;
  for (const l of d.lines) {
    const rate = l.net ? Math.round((l.tax / l.net) * 1000) / 10 : 0;
    text(fit(l.what, 245, 10), 50, y);
    right(money(l.net), 395, y);
    right(l.tax ? money(l.tax) + " (" + rate + "%)" : "0", 470, y);
    right(money(l.net + l.tax), 545, y);
    net += l.net; tax += l.tax; y -= 16;
  }
  y -= 2; rule(y); y -= 18;
  text("Total before VAT", 320, y); right(money(net), 545, y); y -= 15;
  text("VAT", 320, y); right(money(tax), 545, y); y -= 17;
  text("Total", 320, y, 12, true); right(money(net + tax), 545, y, 12, true); y -= 22;
  text(`Paid in full by card on ${day(mine.created)}. Thank you.`, 50, y, 10, true); y -= 14;
  if (mine.amount_refunded) { text(`${money(mine.amount_refunded)} has since been refunded.`, 50, y, 10); y -= 14; }
  if (!tax) { text("No VAT was charged on this payment.", 50, y, 9); y -= 14; }

  text("BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland · VAT IE4429982WH", 50, 60, 8);
  text("Questions about this invoice: info@birdboxcoaching.com", 50, 48, 8);

  const bytes = await doc.save();
  return json({ pdf: Buffer.from(bytes).toString("base64"), filename: `BirdBox invoice ${d.number}.pdf` });
}

// ---------- the Level 1 discounts (Nathan, 1 Nov 2026) ----------

// online -> live: a one-day pass for their own booking, in their name
async function seminarPass(user, email, brand) {
  if (!BRANDS.includes(brand)) return json({ error: "That discount could not be found." }, 404);
  const mine = (await discountsFor(user, email)).find((d) => d.kind === "seminar" && d.brand === brand);
  if (!mine || await passUsed(email, brand)) return json({ error: "That discount could not be found." }, 404);
  const name = await lockedName(user, email);
  if (!name || !name.first || !name.last) {
    return json({ error: "We need your full name on record first. Write to info@birdboxcoaching.com and we will set it up." }, 409);
  }
  const pass = makePass({ user: user.id, email, first: name.first, last: name.last, brand });
  return json({ pass, url: `/${brand}/level-1/#map` });
}

// live -> online: their personal offer link, made now if the seminar's
// follow-up never made one (as the portal's "Send 50% link" does)
async function onlineOffer(user, email, brand) {
  if (!BRANDS.includes(brand)) return json({ error: "That discount could not be found." }, 404);
  const mine = (await discountsFor(user, email)).find((d) => d.kind === "online" && d.brand === brand);
  if (!mine) return json({ error: "That discount could not be found." }, 404);
  let { data: offer } = await db.from("online_offers").select("id, token, redeemed_at")
    .eq("registration_id", mine.registration_id).maybeSingle();
  if (offer?.redeemed_at) return json({ error: "You have already used this discount." }, 409);
  if (!offer) {
    const { data: reg } = await db.from("registrations").select("course_id").eq("id", mine.registration_id).maybeSingle();
    await db.from("online_offers").upsert({
      token: randomBytes(18).toString("base64url"), registration_id: mine.registration_id,
      course_id: reg?.course_id || null, brand, level: "1", discount_percent: PASS_PERCENT,
    }, { onConflict: "registration_id", ignoreDuplicates: true });
    ({ data: offer } = await db.from("online_offers").select("id, token, redeemed_at")
      .eq("registration_id", mine.registration_id).maybeSingle());
  }
  if (!offer?.token) return json({ error: "Your link could not be made. Write to info@birdboxcoaching.com." }, 500);
  return json({ url: `/offer/?t=${offer.token}` });
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
