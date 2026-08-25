// netlify/functions/create-checkout.mjs
//
// POST { slug, option: "full" | "deposit" | "klarna", code?: "GROUP5" }
//   -> { url: "https://checkout.stripe.com/..." }
//
// Runs server-side only. The service key never reaches the browser,
// and the discounted price is recalculated here — never trusted from
// the page, which only ever sends the code itself.
//
// VAT: admission to a physical event is taxed where the VENUE is, not
// where the buyer is. So we look the course's country up in vat_rates
// and attach that fixed Stripe tax rate to the line item. We do NOT
// use automatic_tax, which would tax the buyer's country instead, and
// which cannot be combined with tax_rates anyway.
// Courses in countries with no vat_rates row are charged no tax.
//
// INVOICES: every purchase also creates a real numbered invoice with
// a PDF, not just a Stripe receipt. A receipt has no invoice number
// and no net/VAT breakdown, so a business buyer cannot put it in
// their books — which is exactly what a German gym owner asked for.
// Stripe numbers them sequentially and pulls the company address and
// VAT number off the account.
//
// The invoice is created silently: it sits against the customer for
// whoever asks, rather than emailing a formal document to every
// individual who buys a place for themselves.
//
// Switzerland is excluded (see NO_AUTO_INVOICE). An invoice asserts a
// VAT treatment in a way a receipt does not, and the Swiss position
// is unresolved, so those are raised by hand for now.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { priceWithDiscount } from "./validate-discount.mjs";

// Bump this whenever the wording at /agreements/ changes.
const WAIVER_VERSION = "2026-08-v1";

// Deposit is 25% unless the course carries its own deposit_cents.
const DEPOSIT_RATE = 0.25;

// The balance is taken from the saved card this many days before
// the course starts, so nobody attends without having paid.
const BALANCE_DAYS_BEFORE = 14;

// Stripe rejects a custom field label longer than this.
const LABEL_MAX = 50;

// Venue countries that get no automatic invoice, by ISO code.
// Delete an entry once its VAT position is settled and every seminar
// there starts invoicing itself. Nothing else needs changing.
const NO_AUTO_INVOICE = ["CH"];

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const slug = body.slug;
    const option = body.option || "full";
    const code = body.code ? String(body.code).trim() : null;

    if (!slug) return json({ error: "Missing slug" }, 400);
    if (!["full", "deposit", "klarna"].includes(option)) {
      return json({ error: "Unknown payment option" }, 400);
    }

    // ---- look up the course ------------------------------------
    const { data: course, error } = await supabase
      .from("courses")
      .select("id, brand, type, level, language, title, summary, slug, price_cents, deposit_cents, currency, capacity, status, starts_at, city, country, grants_online_course")
      .eq("slug", slug)
      .single();

    if (error || !course) return json({ error: "Course not found" }, 404);

    if (course.status !== "published") {
      return json({ error: "This course is not open for registration" }, 409);
    }

    // ---- seats left (advisory: the DB trigger is the real gate) --
    const { count } = await supabase
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .eq("course_id", course.id)
      .not("payment_status", "in", '("refunded","failed")');

    if (count !== null && count >= course.capacity) {
      return json({ error: "This course is full" }, 409);
    }

    // ---- what the third checkout question should be -------------
    // Stripe allows three custom fields and two are already spoken
    // for by the participant's name. So a course that gives away an
    // online course asks which language they want it in; every other
    // course keeps asking about the prerequisite.
    const languages = course.grants_online_course
      ? await languagesFor(course)
      : [];

    const prerequisite = languages.length ? null : await prerequisiteFor(course);

    // ---- VAT for the venue's country ---------------------------
    const vat = await vatForCourse(course);

    // ---- price, after any discount -----------------------------
    let full = course.price_cents;
    let discountCents = 0;
    let appliedCode = null;
    let deposit = course.deposit_cents || Math.round(full * DEPOSIT_RATE);

    if (code) {
      const priced = await priceWithDiscount(course, code);
      if (priced.error) return json({ error: priced.error }, 409);
      full = priced.total;
      discountCents = priced.discount;
      deposit = priced.deposit;
      appliedCode = priced.row.code;
    }

    // Klarna cannot save a card, so it is full payment only.
    // Klarna pays us upfront and carries the customer's credit risk.
    const payingNow = option === "deposit" ? deposit : full;
    const balance = option === "deposit" ? full - deposit : 0;

    if (option === "deposit" && balance <= 0) {
      return json({ error: "Deposit is not available on this course" }, 409);
    }

    // Balance date: BALANCE_DAYS_BEFORE ahead of the start, but never
    // in the past — a late booking is charged the next day instead.
    let balanceDueAt = null;
    if (balance > 0) {
      const due = new Date(course.starts_at);
      due.setDate(due.getDate() - BALANCE_DAYS_BEFORE);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      balanceDueAt = (due > tomorrow ? due : tomorrow).toISOString();
    }

    const currency = course.currency.toLowerCase();
    const money = (cents) =>
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: course.currency,
        maximumFractionDigits: 0,
      }).format(cents / 100);

    const lineName =
      option === "deposit" ? `${course.title} — deposit` : course.title;

    const notes = [];
    if (option === "deposit") {
      notes.push(
        `Deposit. The remaining ${money(balance)} is charged automatically ${BALANCE_DAYS_BEFORE} days before the course.`
      );
    }
    if (appliedCode) {
      notes.push(`Code ${appliedCode} applied — ${money(discountCents)} off.`);
    }
    // Prices are quoted "+ VAT" on the site, so say what is being added.
    // Built from the rate, not from vat_rates.label — the labels
    // already read "VAT 19%", which would double the percentage.
    if (vat) {
      notes.push(`VAT at ${vat.percentText} is added at checkout.`);
    }
    if (!notes.length && course.summary) notes.push(course.summary);

    const origin = req.headers.get("origin") || process.env.SITE_URL;

    // ---- the questions we ask at checkout ----------------------
    const customFields = [
      {
        key: "firstname",
        label: { type: "custom", custom: "Participant first name" },
        type: "text",
        optional: false,
      },
      {
        key: "lastname",
        label: { type: "custom", custom: "Participant last name" },
        type: "text",
        optional: false,
      },
    ];

    // Which language they want their free online course in. No option
    // is pre-selected — a default here would be clicked past, and the
    // wrong language means unenrolling and losing their progress.
    if (languages.length) {
      customFields.push({
        key: "lwlanguage",
        label: {
          type: "custom",
          custom: clip("Language for your free online course"),
        },
        type: "dropdown",
        optional: false,
        dropdown: {
          options: languages.map((l) => ({
            label: clip(l.label || l.language),
            value: l.language,
          })),
        },
      });
    }

    // A prerequisite cannot be enforced, but it can be declared —
    // which gives us a record and flags anyone who needs approving.
    // Only asked where the language question is not.
    if (prerequisite) {
      customFields.push({
        key: "prereq",
        label: {
          type: "custom",
          custom: clip(`Completed ${prerequisite} within 5 years?`),
        },
        type: "dropdown",
        optional: false,
        dropdown: {
          options: [
            { label: "Yes", value: "yes" },
            { label: "Not yet - please contact me", value: "no" },
          ],
        },
      });
    }

    // ---- the line item, with the venue's tax rate if we have one -
    const lineItem = {
      quantity: 1,
      price_data: {
        currency,
        unit_amount: payingNow,
        product_data: {
          name: lineName,
          description: notes.join(" ") || undefined,
        },
      },
    };

    // Fixed tax rate, exclusive — added on top of the quoted price.
    // Omitted entirely outside the EU and UK, which is deliberate:
    // Australia and Canada are unresolved and stay untaxed for now.
    if (vat) {
      lineItem.tax_rates = [vat.stripe_tax_rate_id];
    }

    // ---- build the Checkout session ----------------------------
    const session = {
      mode: "payment",

      // Klarna gets its own session; card sessions stay card-only so
      // the three choices on the page stay distinct.
      payment_method_types: option === "klarna" ? ["klarna"] : ["card"],

      // always create a Stripe Customer — without one there is no
      // saved card, and the balance cannot be charged later
      customer_creation: "always",

      consent_collection: {
        terms_of_service: "required",
      },
      custom_text: {
        terms_of_service_acceptance: {
          message:
            "I have read and agree to the BirdBox Coaching terms of sale and the assumption of risk and waiver of liability.",
        },
      },

      custom_fields: customFields,

      line_items: [lineItem],

      payment_intent_data: {
        description: `${course.brand.toUpperCase()} — ${course.title}`,
      },

      phone_number_collection: { enabled: true },
      billing_address_collection: "required",

      // everything the webhook needs to write the registration row
      metadata: {
        course_id: course.id,
        course_slug: course.slug,
        brand: course.brand,
        waiver_version: WAIVER_VERSION,
        payment_option: option,
        amount_paid_cents: String(payingNow),
        balance_cents: String(balance),
        balance_due_at: balanceDueAt || "",
        full_price_cents: String(course.price_cents),
        discount_code: appliedCode || "",
        discount_cents: String(discountCents),
        prerequisite: prerequisite || "",

        // The webhook reads this to decide whether to enrol anyone in
        // LearnWorlds. Blank means no free online course.
        grants_online_course: course.grants_online_course ? "yes" : "",
        online_languages: languages.map((l) => l.language).join(","),

        // VAT is recorded on the session so the registration row and
        // any later balance charge can reuse exactly the same rate.
        vat_country: vat ? vat.code : "",
        vat_rate_id: vat ? vat.stripe_tax_rate_id : "",
        vat_percent: vat ? String(vat.percent) : "",
      },

      success_url: `${origin}/registration-complete/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/c/${course.slug}/`,
    };

    // ---- the invoice -------------------------------------------
    // Created automatically for every venue country except those on
    // NO_AUTO_INVOICE. The participant's name goes in the description
    // so an invoice for a coach booked by their gym owner names the
    // right person, not the cardholder — but the custom fields are
    // only known after payment, so this carries the course and the
    // buyer sorts the rest.
    const venueCountry = (course.country || "").trim().toUpperCase();
    if (!NO_AUTO_INVOICE.includes(venueCountry)) {
      session.invoice_creation = {
        enabled: true,
        invoice_data: {
          description:
            option === "deposit"
              ? `Deposit — ${course.title}`
              : course.title,
          metadata: {
            course_id: course.id,
            course_slug: course.slug,
            payment_option: option,
            discount_code: appliedCode || "",
          },
        },
      };
    }

    // Only card payments can be saved for the balance charge.
    if (option !== "klarna") {
      session.payment_intent_data.setup_future_usage = "off_session";
    }

    if (option === "deposit") {
      const plusVat = vat ? " plus VAT" : "";
      session.custom_text.submit = {
        message: `You are paying a deposit of ${money(deposit)}${plusVat}. The remaining ${money(balance)}${plusVat} will be charged to this card ${BALANCE_DAYS_BEFORE} days before the course starts.`,
      };
    }

    const created = await stripe.checkout.sessions.create(session);
    return json({ url: created.url });
  } catch (err) {
    // Stripe's own message is far more useful than a generic one when
    // a field is malformed, so pass it back rather than swallowing it.
    console.error("create-checkout failed:", err);
    return json({ error: err.message || "Could not start checkout" }, 500);
  }
};

// Place of supply for admission to a physical event is the venue's
// country. Returns null when we have no rate for it, which means no
// tax is charged — the current behaviour everywhere outside EU/UK.
async function vatForCourse(course) {
  const code = (course.country || "").trim().toUpperCase();
  if (!code) return null;

  const { data, error } = await supabase
    .from("vat_rates")
    .select("country, code, rate, stripe_tax_rate_id, label")
    .eq("code", code)
    .maybeSingle();

  if (error || !data || !data.stripe_tax_rate_id) return null;

  // rate may be stored as 19 or as 0.19 — treat anything at or below
  // 1 as a fraction so both spellings give 19%.
  const raw = Number(data.rate);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const percent = raw <= 1 ? raw * 100 : raw;

  return {
    code: data.code,
    country: data.country,
    stripe_tax_rate_id: data.stripe_tax_rate_id,
    percent,
    percentText: `${Number(percent.toFixed(2))}%`,
    label: data.label || "VAT",
  };
}

// The languages the free online course is available in, for this
// brand and level. Returns an empty list if nothing is set up, which
// means no question is asked and nothing is given away — a missing
// row should never block a sale.
async function languagesFor(course) {
  const lvl = String(course.level == null ? "" : course.level).replace(/\D/g, "");
  if (!lvl) return [];

  const { data, error } = await supabase
    .from("learnworlds_products")
    .select("language, label, product_id, active, level, brand")
    .eq("brand", course.brand)
    .eq("active", true);

  if (error) {
    console.error("Could not load online course languages:", error.message);
    return [];
  }

  return (data || [])
    .filter((r) => String(r.level || "").replace(/\D/g, "") === lvl && r.product_id)
    .sort((a, b) => String(a.label || a.language).localeCompare(String(b.label || b.language)));
}

// Matches the same loose level/language rules the course page uses.
async function prerequisiteFor(course) {
  if (course.type === "workshop") return null;

  const { data } = await supabase
    .from("course_templates")
    .select("level, language, prerequisites")
    .eq("brand", course.brand)
    .eq("type", course.type);

  if (!data || !data.length) return null;

  const lvl = (v) => String(v == null ? "" : v).replace(/\D/g, "");
  const match = data.find((t) => lvl(t.level) === lvl(course.level)) || data[0];

  const pre = (match.prerequisites || "").trim();
  if (!pre || pre.toLowerCase() === "none") return null;
  return pre;
}

function clip(text) {
  return text.length <= LABEL_MAX ? text : text.slice(0, LABEL_MAX - 1) + "?";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
