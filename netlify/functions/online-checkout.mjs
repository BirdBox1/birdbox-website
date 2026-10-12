// netlify/functions/online-checkout.mjs
//
// Selling the online courses on birdboxcoaching.com, so people never
// have to buy on the LearnWorlds page. LearnWorlds only hosts the
// course; the money comes through our own Stripe.
//
//   GET  ?brand=tcc&level=1
//        -> { currency, country, prices: { EUR: 65000, ... }, languages, months: [3..8], vat }
//        What the sales page shows. The currency is picked from where
//        the visitor is (Netlify's geo lookup); they can change it.
//
//   POST { brand, level, language, currency, country, option: "full" | "plan", months, return_path }
//        -> { url }   the Stripe Checkout page
//
// After payment the Stripe webhook calls onOnlineSaleCompleted()
// below: it creates their academy account (or finds the one they
// have), enrols them in the course, emails them, and alerts the office.
// A brand new account gets LearnWorlds' own set-your-password email, so
// they log in and the course is already there.
//
// WHERE THINGS LIVE
//   Prices     course_prices, type 'online_course' — one row per
//              brand, level and currency. Edit a price there.
//   Courses    online_products — brand, level, language and the
//              LearnWorlds course id. Add a row to sell a new language;
//              it appears on the page by itself.
//   Sales      online_sales — one row per purchase.
//
// VAT: an online course is an electronically supplied service, taxed
// where the BUYER is. The buy box asks for their country (filled in
// from where they are browsing), and that country's rate from
// vat_rates is put on the line item, exclusive — added on top, the
// same as the seminars. No rate for the country (the US, Australia,
// Canada...) means no VAT. The country and the billing address are
// both kept on the sale as the two pieces of location evidence.
//
// PAYMENT OPTIONS
//   full   one card payment. (Klarna was removed in September 2026.)
//   plan   3 to 8 monthly card payments (buyer's choice), as a Stripe subscription
//          that cancels itself after the last one. Access is given on
//          the first payment. A failed payment alerts the office.
//
// SEMINAR OFFER (?offer=TOKEN)
//   Everyone who attended a live seminar gets a personal link in the
//   coach's follow-up email (online_offers, made by course-email-send).
//   It opens /offer/ at the seminar rate — 50% off the same brand and
//   level online course. The token is the proof they were there, so
//   nobody else can get the rate, and it is used once.
//   full   pay the discounted price once, by card.
//   plan   20% deposit today, then the rest over 2 to 6 monthly card
//          payments starting a month later. Access on the deposit.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { enrolById, isOnSite, LEARN_URL, learnStartLink } from "./learnworlds.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// The monthly plan lengths a buyer can choose. Change here and the
// page changes too.
const PLAN_CHOICES = [3, 4, 5, 6, 7, 8];
const PLAN_MONTHS = 3; // fallback only

// The seminar offer: deposit today, then the balance monthly.
const OFFER_PLAN_CHOICES = [2, 3, 4, 5, 6];
const OFFER_DEPOSIT_PERCENT = 20;

const KIND = "online_course_sale";
const ALERT_EMAIL = "info@birdboxcoaching.com";
const REPLY_TO = "info@birdboxcoaching.com";
const LMS_URL = "https://www.birdboxacademy.com";

const CURRENCIES = ["EUR", "GBP", "USD", "AUD", "CAD"];

// Europe pays in euro, the UK in pounds, Australia in AUD, Canada in
// CAD. Everyone else — the US and the rest of the world — in USD.
const EURO_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE", "IS", "LI", "NO", "CH", "AD", "MC", "SM", "VA", "ME",
  "AL", "BA", "MK", "RS", "XK", "MD", "UA",
]);
const GBP_COUNTRIES = new Set(["GB", "IM", "JE", "GG", "GI"]);

function currencyForCountry(code) {
  const c = String(code || "").toUpperCase();
  if (GBP_COUNTRIES.has(c)) return "GBP";
  if (c === "AU") return "AUD";
  if (c === "CA") return "CAD";
  if (EURO_COUNTRIES.has(c)) return "EUR";
  if (!c) return "EUR";
  return "USD";
}

const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "");

export default async (req, context) => {
  try {
    if (req.method === "GET") {
      const params = new URL(req.url).searchParams;
      if (params.get("preview")) return await previewOffer(params.get("preview"), context);
      const token = params.get("offer");
      return token ? await seminarOffer(token, context) : await offer(req, context);
    }
    if (req.method === "POST") {
      const body = await req.json();
      if (body.preview) {
        return json({ error: "This is a preview, so it cannot take a payment. Attendees pay from their own link." }, 409);
      }
      return body.offer ? await seminarCheckout(req, body) : await checkout(req, body);
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("online-checkout failed:", err);
    return json({ error: err.message || "Could not start checkout" }, 500);
  }
};

// ---------------------------------------------------------------
// what the page shows
// ---------------------------------------------------------------

async function loadOffer(brand, level) {
  const { data: priceRows, error: pErr } = await supabase
    .from("course_prices")
    .select("brand, type, level, currency, price_cents")
    .eq("brand", brand)
    .eq("type", "online_course");
  if (pErr) throw new Error("Could not load prices: " + pErr.message);

  const prices = {};
  for (const r of priceRows || []) {
    const cur = String(r.currency || "").toUpperCase();
    if (digits(r.level) === digits(level) && CURRENCIES.includes(cur) && r.price_cents > 0) {
      prices[cur] = r.price_cents;
    }
  }

  const { data: prodRows, error: lErr } = await supabase
    .from("online_products")
    .select("brand, level, language, label, lw_course_id, sort")
    .eq("brand", brand)
    .eq("active", true);
  if (lErr) throw new Error("Could not load languages: " + lErr.message);

  const products = (prodRows || [])
    .filter((r) => digits(r.level) === digits(level) && r.lw_course_id)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.label).localeCompare(String(b.label)));

  return { prices, products };
}

async function offer(req, context) {
  const url = new URL(req.url);
  const brand = String(url.searchParams.get("brand") || "").toLowerCase();
  const level = digits(url.searchParams.get("level"));
  if (!brand || !level) return json({ error: "Missing brand or level" }, 400);

  const { prices, products } = await loadOffer(brand, level);

  let country = null;
  try { country = context?.geo?.country?.code || null; } catch (e) { country = null; }
  country = country ? String(country).toUpperCase() : null;

  const vat = await vatList();
  let currency = currencyForCountry(country);
  if (!prices[currency]) currency = prices.EUR ? "EUR" : Object.keys(prices)[0] || null;

  // True when every language of this course has moved to birdboxcoaching.com/learn/.
  const onSiteAll = products.length ? (await Promise.all(products.map((p) => isOnSite(p.lw_course_id)))).every(Boolean) : false;

  return json({
    currency,
    prices,
    on_site: onSiteAll,
    languages: products.map((p) => ({ language: p.language, label: p.label })),
    months: PLAN_CHOICES,
    country,
    vat,
  }, 200, { "Cache-Control": "no-store" });
}

// Every VAT rate we hold, as { code, rate, id }.
async function vatList() {
  const { data } = await supabase
    .from("vat_rates")
    .select("code, rate, stripe_tax_rate_id");
  return (data || [])
    .map((r) => {
      const raw = Number(r.rate) || 0;
      return {
        code: String(r.code || "").toUpperCase(),
        rate: raw <= 1 ? Math.round(raw * 10000) / 100 : raw,
        id: r.stripe_tax_rate_id || null,
      };
    })
    .filter((r) => r.code && r.rate > 0 && r.id && r.id.startsWith("txr_"));
}

// ---------------------------------------------------------------
// start the Stripe Checkout
// ---------------------------------------------------------------

async function checkout(req, body) {
  const brand = String(body.brand || "").toLowerCase();
  const level = digits(body.level);
  const language = String(body.language || "");
  const currency = String(body.currency || "").toUpperCase();
  const option = body.option === "plan" ? "plan" : "full";
  const country = String(body.country || "").toUpperCase();
  const months = option === "plan" ? parseInt(body.months, 10) : 1;
  if (!/^[A-Z]{2}$/.test(country)) return json({ error: "Choose your country" }, 400);
  if (option === "plan" && !PLAN_CHOICES.includes(months)) return json({ error: "Choose how many monthly payments" }, 400);

  if (!brand || !level) return json({ error: "Missing course" }, 400);
  if (!CURRENCIES.includes(currency)) return json({ error: "Choose a currency" }, 400);

  const { prices, products } = await loadOffer(brand, level);
  const product = products.find((p) => p.language === language) || (products.length === 1 ? products[0] : null);
  if (!product) return json({ error: "Choose a language" }, 400);

  const price = prices[currency];
  if (!price) return json({ error: `This course is not on sale in ${currency}` }, 400);

  // The rate for the buyer's country, or none.
  const vatRow = (await vatList()).find((v) => v.code === country) || null;

  const origin = new URL(req.url).origin;
  const back = typeof body.return_path === "string" && body.return_path.startsWith("/") && !body.return_path.startsWith("//")
    ? body.return_path : "/";

  const each = Math.round(price / months);
  const name = product.label;

  const metadata = {
    kind: KIND,
    brand,
    level,
    language: product.language,
    lw_course_id: product.lw_course_id,
    label: product.label,
    currency,
    option,
    price_cents: String(price),
    months: String(months),
    country,
    vat_percent: vatRow ? String(vatRow.rate) : "0",
  };

  const lineItem = {
    quantity: 1,
    price_data: {
      currency: currency.toLowerCase(),
      unit_amount: option === "plan" ? each : price,
      product_data: {
        name: option === "plan" ? `${name} — ${months} monthly payments` : name,
        description: "Online course. Instant access — your login details are emailed as soon as you have paid.",
      },
    },
  };
  if (option === "plan") lineItem.price_data.recurring = { interval: "month" };
  if (vatRow) lineItem.tax_rates = [vatRow.id];

  const session = {
    // The buyer picked their currency on our page; Stripe's Adaptive
    // Pricing would offer them another one (CHF, say) on top. Off.
    adaptive_pricing: { enabled: false },
    mode: option === "plan" ? "subscription" : "payment",
    payment_method_types: ["card"],
    line_items: [lineItem],
    billing_address_collection: "required",
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      terms_of_service_acceptance: {
        message:
          "I agree to the BirdBox Coaching terms of sale. I ask for access to start straight away, " +
          "and understand that I lose my right to cancel and the course is non-refundable once access has been given.",
      },
    },
    metadata,
    success_url: `${origin}/online-welcome/?session_id={CHECKOUT_SESSION_ID}${(await isOnSite(product.lw_course_id)) ? "&site=1" : ""}`,
    cancel_url: `${origin}${back}`,
  };

  if (option === "plan") {
    session.subscription_data = {
      description: `${name} — ${months} monthly payments`,
      metadata,
    };
    session.custom_text.submit = {
      message:
        `You are paying the first of ${months} monthly payments today. The other ` +
        `${months - 1} are taken from this card on the same day each month, then the plan ends by itself.`,
    };
  } else {
    session.customer_creation = "always";
    session.invoice_creation = {
      enabled: true,
      invoice_data: { description: name, metadata: { kind: KIND, label: name } },
    };
    session.payment_intent_data = { description: name };
  }

  const created = await stripe.checkout.sessions.create(session);
  return json({ url: created.url });
}

// ---------------------------------------------------------------
// the seminar offer: a personal link from the follow-up email
// ---------------------------------------------------------------

async function findOffer(token) {
  const t = String(token || "").trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return null;
  const { data } = await supabase
    .from("online_offers")
    .select("id, token, registration_id, brand, level, discount_percent, opened_at, redeemed_at, " +
            "registrations ( first_name, last_name, email, attended, status )")
    .eq("token", t)
    .maybeSingle();
  if (!data || !data.registrations) return null;
  // Only somebody who actually turned up. A later "did not attend"
  // or a cancellation takes the offer away again.
  const r = data.registrations;
  if (r.attended !== true || (r.status || "active") !== "active") return null;
  return data;
}

const discounted = (cents, pct) => Math.round(cents * (100 - pct) / 100);

// What a coach's test email opens: the offer page as an attendee sees
// it, for /offer/?preview=tcc-1, with no person behind it.
const PREVIEW_COURSES = new Set(["tcc-1", "tgc-1"]);
async function previewOffer(code, context) {
  const c = String(code || "").toLowerCase();
  if (!PREVIEW_COURSES.has(c)) return json({ error: "There is no preview for that course." }, 404);
  const [brand, level] = c.split("-");
  return offerPayload({ brand, level, discount_percent: 50, registrations: { first_name: "", email: "" } },
    context, true);
}

async function seminarOffer(token, context) {
  const o = await findOffer(token);
  if (!o) return json({ error: "This link is not valid. Reply to your coach's email and we will sort it out." }, 404);
  if (o.redeemed_at) return json({ redeemed: true, first_name: o.registrations.first_name || "" });
  return offerPayload(o, context, false);
}

async function offerPayload(o, context, preview) {
  const { prices, products } = await loadOffer(o.brand, o.level);
  if (!products.length || !Object.keys(prices).length) {
    return json({ error: "This course is not on sale right now. Reply to your coach's email and we will help." }, 409);
  }

  const offerPrices = {};
  for (const [cur, cents] of Object.entries(prices)) {
    offerPrices[cur] = { full: cents, offer: discounted(cents, o.discount_percent) };
  }

  let country = null;
  try { country = context?.geo?.country?.code || null; } catch (e) { country = null; }
  country = country ? String(country).toUpperCase() : null;
  let currency = currencyForCountry(country);
  if (!offerPrices[currency]) currency = offerPrices.EUR ? "EUR" : Object.keys(offerPrices)[0];

  if (!preview && !o.opened_at) {
    await supabase.from("online_offers").update({ opened_at: new Date().toISOString() }).eq("id", o.id);
  }

  return json({
    preview,
    first_name: o.registrations.first_name || "",
    email: o.registrations.email || "",
    brand: o.brand,
    level: o.level,
    title: products[0].label.replace(/\s*\([^)]*\)\s*$/, ""),
    discount_percent: o.discount_percent,
    deposit_percent: OFFER_DEPOSIT_PERCENT,
    months: OFFER_PLAN_CHOICES,
    currency,
    prices: offerPrices,
    languages: products.map((p) => ({ language: p.language, label: p.label })),
    country,
    vat: await vatList(),
  }, 200, { "Cache-Control": "no-store" });
}

async function seminarCheckout(req, body) {
  const o = await findOffer(body.offer);
  if (!o) return json({ error: "This link is not valid." }, 404);
  if (o.redeemed_at) return json({ error: "This offer has already been used." }, 409);

  const language = String(body.language || "");
  const currency = String(body.currency || "").toUpperCase();
  const option = body.option === "plan" ? "plan" : "full";
  const country = String(body.country || "").toUpperCase();
  const months = option === "plan" ? parseInt(body.months, 10) : 1;
  if (!/^[A-Z]{2}$/.test(country)) return json({ error: "Choose your country" }, 400);
  if (option === "plan" && !OFFER_PLAN_CHOICES.includes(months)) return json({ error: "Choose how many monthly payments" }, 400);
  if (!CURRENCIES.includes(currency)) return json({ error: "Choose a currency" }, 400);

  const { prices, products } = await loadOffer(o.brand, o.level);
  const product = products.find((p) => p.language === language) || (products.length === 1 ? products[0] : null);
  if (!product) return json({ error: "Choose a language" }, 400);
  if (!prices[currency]) return json({ error: `This course is not on sale in ${currency}` }, 400);

  const price = discounted(prices[currency], o.discount_percent);
  const deposit = option === "plan" ? Math.round(price * OFFER_DEPOSIT_PERCENT / 100) : 0;
  const each = option === "plan" ? Math.round((price - deposit) / months) : 0;
  const vatRow = (await vatList()).find((v) => v.code === country) || null;
  const origin = new URL(req.url).origin;
  const name = `${product.label} — seminar rate (${o.discount_percent}% off)`;

  const metadata = {
    kind: KIND,
    brand: o.brand,
    level: o.level,
    language: product.language,
    lw_course_id: product.lw_course_id,
    label: product.label,
    currency,
    option,
    price_cents: String(price),
    months: String(months),
    country,
    vat_percent: vatRow ? String(vatRow.rate) : "0",
    offer_id: o.id,
    deposit_cents: String(deposit),
  };

  const item = (amount, title, recurring) => {
    const li = {
      quantity: 1,
      price_data: {
        currency: currency.toLowerCase(),
        unit_amount: amount,
        product_data: { name: title },
      },
    };
    if (recurring) li.price_data.recurring = { interval: "month" };
    if (vatRow) li.tax_rates = [vatRow.id];
    return li;
  };

  const session = {
    // The buyer picked their currency on our page; Stripe's Adaptive
    // Pricing would offer them another one (CHF, say) on top. Off.
    adaptive_pricing: { enabled: false },
    mode: option === "plan" ? "subscription" : "payment",
    payment_method_types: ["card"],
    customer_email: o.registrations.email || undefined,
    billing_address_collection: "required",
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      terms_of_service_acceptance: {
        message:
          "I agree to the BirdBox Coaching terms of sale. I ask for access to start straight away, " +
          "and understand that I lose my right to cancel and the course is non-refundable once access has been given.",
      },
    },
    metadata,
    success_url: `${origin}/online-welcome/?session_id={CHECKOUT_SESSION_ID}${(await isOnSite(product.lw_course_id)) ? "&site=1" : ""}`,
    cancel_url: `${origin}/offer/?t=${encodeURIComponent(o.token)}`,
  };

  if (option === "plan") {
    // The deposit is a one-off item charged today. The monthly price
    // starts a month later, by a one-month trial on the subscription:
    // Stripe charges one-off items at checkout even during a trial, so
    // today's payment is the deposit alone. (Checkout refuses
    // billing_cycle_anchor + proration_behavior "none" with one-off
    // items, which is how this was first written.)
    const firstMonthly = new Date();
    firstMonthly.setUTCMonth(firstMonthly.getUTCMonth() + 1);
    session.line_items = [
      item(each, `${name} — ${months} monthly payments`, true),
      item(deposit, `${name} — ${OFFER_DEPOSIT_PERCENT}% deposit`, false),
    ];
    session.subscription_data = {
      description: `${name} — ${OFFER_DEPOSIT_PERCENT}% deposit, then ${months} monthly payments`,
      trial_end: Math.floor(firstMonthly.getTime() / 1000),
      metadata,
    };
    session.custom_text.submit = {
      message:
        `Today you pay the ${OFFER_DEPOSIT_PERCENT}% deposit and get access straight away. ` +
        `The rest is ${months} monthly payments from this card, starting a month from today, then the plan ends by itself.`,
    };
  } else {
    session.line_items = [item(price, name, false)];
    session.customer_creation = "always";
    session.invoice_creation = {
      enabled: true,
      invoice_data: { description: name, metadata: { kind: KIND, label: name } },
    };
    session.payment_intent_data = { description: name };
  }

  const created = await stripe.checkout.sessions.create(session);
  return json({ url: created.url });
}

// ---------------------------------------------------------------
// called by stripe-webhook.mjs
// ---------------------------------------------------------------

export function isOnlineSale(session) {
  return !!(session && session.metadata && session.metadata.kind === KIND);
}

// The metadata of the plan a subscription invoice belongs to, if any.
// Stripe moved this field in 2025, so both places are checked.
export function onlinePlanMeta(invoice) {
  const m =
    invoice?.parent?.subscription_details?.metadata ||
    invoice?.subscription_details?.metadata ||
    null;
  return m && m.kind === KIND ? m : null;
}

// checkout.session.completed. Safe to run twice.
export async function onOnlineSaleCompleted(session) {
  const full = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["customer_details"],
  });
  const meta = full.metadata || {};
  const details = full.customer_details || {};
  const email = details.email || full.customer_email || null;
  const parts = String(details.name || "").trim().split(/\s+/);
  const first = parts.shift() || "";
  const last = parts.join(" ");
  const paid = full.payment_status === "paid" || full.payment_status === "no_payment_required";

  // One row per checkout. A second delivery finds it and stops if the
  // enrolment already went through.
  const { data: existing } = await supabase
    .from("online_sales").select("*").eq("stripe_session_id", full.id).maybeSingle();

  let row = existing;
  if (!row) {
    const { data, error } = await supabase.from("online_sales").insert({
      stripe_session_id: full.id,
      stripe_customer_id: typeof full.customer === "string" ? full.customer : null,
      stripe_subscription_id: typeof full.subscription === "string" ? full.subscription : null,
      email,
      first_name: first || null,
      last_name: last || null,
      country: details.address?.country || null,
      brand: meta.brand || null,
      level: meta.level || null,
      language: meta.language || null,
      lw_course_id: meta.lw_course_id || null,
      label: meta.label || null,
      option: meta.option || "full",
      months: parseInt(meta.months, 10) || 1,
      currency: meta.currency || String(full.currency || "").toUpperCase(),
      price_cents: parseInt(meta.price_cents, 10) || null,
      amount_paid_cents: full.amount_total ?? null,
      tax_cents: full.total_details?.amount_tax ?? null,
      status: paid ? "paid" : "pending",
      offer_id: meta.offer_id || null,
      deposit_cents: parseInt(meta.deposit_cents, 10) || null,
    }).select("*").single();
    if (error) throw new Error("online_sales: " + error.message);
    row = data;
  }
  // A seminar offer is used once, as soon as it is paid for.
  if (paid && row.offer_id) {
    await supabase.from("online_offers")
      .update({ redeemed_at: new Date().toISOString(), online_sale_id: row.id })
      .eq("id", row.offer_id).is("redeemed_at", null);
  }
  if (row.learnworlds_status === "enrolled") return;

  if (!paid) {
    await alert("Online course checkout not paid yet",
      `${email} completed checkout for ${meta.label} but Stripe reports it as ${full.payment_status}. ` +
      `They have NOT been enrolled. Check Stripe.`);
    return;
  }

  // The plan stops itself after the last payment. No credit is made
  // for the final part-month.
  if (row.stripe_subscription_id && row.option === "plan") {
    try {
      const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
      const months = row.months || PLAN_MONTHS;
      // The first monthly payment: the end of the trial on a seminar
      // offer plan (deposit first), otherwise the start of the plan.
      const anchor = new Date((sub.trial_end || sub.billing_cycle_anchor) * 1000);
      const end = new Date(anchor);
      end.setUTCMonth(end.getUTCMonth() + months - 1);
      end.setUTCDate(end.getUTCDate() + 15);
      await stripe.subscriptions.update(row.stripe_subscription_id, {
        cancel_at: Math.floor(end.getTime() / 1000),
        proration_behavior: "none",
      });
    } catch (err) {
      console.error("Could not set the plan end date", err);
      await alert("Online course plan — END DATE NOT SET",
        `The monthly plan for ${email} (${meta.label}) could not be set to stop after ${row.months} payments:\n\n` +
        `${err.message}\n\nOpen the subscription in Stripe and set it to cancel after the last payment.`);
    }
  }

  const result = await enrolById({
    email,
    firstName: first,
    lastName: last,
    productId: row.lw_course_id,
    productType: "course",
    justification: `Bought on birdboxcoaching.com (${row.option === "plan" ? "monthly plan" : "paid in full"})`,
  });

  await supabase.from("online_sales").update({
    learnworlds_status: result.status,
    learnworlds_user_id: result.userId || null,
    learnworlds_enrolled_at: result.status === "enrolled" ? new Date().toISOString() : null,
    learnworlds_error: result.error || null,
    user_was_created: result.status === "enrolled" ? !!result.userWasCreated : null,
  }).eq("id", row.id);

  const money = `${((full.amount_total || 0) / 100).toFixed(2)} ${String(full.currency || "").toUpperCase()}`;
  const how = (row.option === "plan"
    ? (row.deposit_cents ? `${OFFER_DEPOSIT_PERCENT}% deposit, then ${row.months} monthly payments`
                         : `first of ${row.months} monthly payments`)
    : "paid in full") + (row.offer_id ? ", seminar rate" : "");

  if (result.status !== "enrolled") {
    await alert("Online course SOLD but NOT enrolled",
      `${first} ${last} (${email}) bought ${row.label} on the website (${how}, ${money}), ` +
      `but the academy enrolment failed:\n\n${result.error}\n\n` +
      `Enrol them by hand in LearnWorlds, or send them an online course invoice marked paid.`);
    return;
  }

  const welcomed = await sendWelcome({ email, first, label: row.label, isNew: !!result.userWasCreated, onSite: !!result.onSite });
  if (welcomed) {
    await supabase.from("online_sales").update({ welcome_sent_at: new Date().toISOString() }).eq("id", row.id);
  }

  await alert("Online course sold",
    `${first} ${last} (${email}) bought ${row.label} on the website — ${how}, ${money}. ` +
    (result.onSite
      ? "The course is on birdboxcoaching.com/learn/ — they have been emailed how to log in."
      : result.userWasCreated
        ? "A new academy account was created and they have been sent the set-your-password email."
        : "They already had an academy account; the course has been added to it.") +
    "\n\nNothing to do.");
}

// invoice.payment_failed on a monthly plan.
export async function onOnlinePlanFailed(invoice) {
  const meta = onlinePlanMeta(invoice);
  if (!meta) return;
  await alert("Online course plan — payment failed",
    `A monthly payment for ${meta.label} failed.\n\n` +
    `Customer: ${invoice.customer_name || ""} ${invoice.customer_email || ""}\n` +
    `Amount: ${((invoice.amount_due || 0) / 100).toFixed(2)} ${String(invoice.currency || "").toUpperCase()}\n` +
    `Stripe invoice: ${invoice.number || invoice.id}\n\n` +
    `Stripe will retry and email them a link to update their card. If it keeps failing, ` +
    `decide whether to remove their course access in LearnWorlds.`);
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

async function sendWelcome({ email, first, label, isNew, onSite }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !email) return false;

  const lines = [
    `Hi ${first || "there"},`,
    "",
    `Thank you — your payment has come through and ${label} is now in your account.`,
    "",
  ];
  if (onSite) {
    lines.push(
      "Your course is on our website. Tap this link to open it — the first time, it sets up your account and logs you straight in:",
      "",
      learnStartLink(email),
      "",
      "The course is waiting under My courses. Once you are in, set a password so you can log in any time.",
      `Later, log in at ${LEARN_URL} with this email address: ${email}`,
      "",
      "Any problems getting in, just reply to this email.",
      "",
      "BirdBox Coaching",
    );
  } else if (isNew) {
    lines.push(
      "We have set up your BirdBox Academy account for you. You will get a separate email from",
      "BirdBox Academy with a link to set your password (check spam if it has not arrived in a",
      "few minutes). Once your password is set, log in and the course is already there waiting:",
    );
  } else {
    lines.push(
      "You already have a BirdBox Academy account, so the course has been added to it. Log in",
      "with your usual email and password:",
    );
  }
  if (!onSite) lines.push(
    LMS_URL,
    "",
    `Log in with this email address: ${email}`,
    "",
    "Any problems getting in, just reply to this email.",
    "",
    "BirdBox Coaching",
  );

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.CONFIRM_FROM || process.env.ALERT_FROM || REPLY_TO,
        to: [email],
        reply_to: REPLY_TO,
        subject: `You're in — ${label}`,
        text: lines.join("\n"),
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("Could not send online course welcome", err);
    return false;
  }
}

async function alert(subject, body) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("ALERT:", subject, body); return; }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.ALERT_FROM || "alerts@birdboxcoaching.com",
        to: [ALERT_EMAIL],
        subject: "[BirdBox] " + subject,
        text: body,
      }),
    });
  } catch (err) {
    console.error("Could not send alert email:", err);
  }
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}
