// netlify/functions/create-checkout.mjs
//
// POST { slug: "tgc-l1-dublin-oct", option: "full" | "deposit" | "klarna" }
//   -> { url: "https://checkout.stripe.com/..." }
//
// Runs server-side only. The service key never reaches the browser.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Bump this whenever the wording at /agreements/ changes.
// It is stored against every registration so you can always tell
// which version a given participant agreed to.
const WAIVER_VERSION = "2026-08-v1";

// Deposit is 25% unless the course carries its own deposit_cents.
const DEPOSIT_RATE = 0.25;

// The balance is taken from the saved card this many days before
// the course starts, so nobody attends without having paid.
const BALANCE_DAYS_BEFORE = 14;

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

    if (!slug) return json({ error: "Missing slug" }, 400);
    if (!["full", "deposit", "klarna"].includes(option)) {
      return json({ error: "Unknown payment option" }, 400);
    }

    // ---- look up the course ------------------------------------
    const { data: course, error } = await supabase
      .from("courses")
      .select("id, brand, title, summary, slug, price_cents, deposit_cents, currency, capacity, status, starts_at, city, country")
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

    // ---- work out what is being charged now --------------------
    const full = course.price_cents;
    const deposit = course.deposit_cents || Math.round(full * DEPOSIT_RATE);

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
      option === "deposit"
        ? `${course.title} — deposit`
        : course.title;

    const lineDescription =
      option === "deposit"
        ? `Deposit. The remaining ${money(balance)} is charged automatically ${BALANCE_DAYS_BEFORE} days before the course.`
        : course.summary || undefined;

    const origin = req.headers.get("origin") || process.env.SITE_URL;

    // ---- build the Checkout session ----------------------------
    const session = {
      mode: "payment",

      // Klarna gets its own session; card sessions stay card-only so
      // the three choices on the page stay distinct.
      payment_method_types: option === "klarna" ? ["klarna"] : ["card"],

      // always create a Stripe Customer — without one there is no
      // saved card, and the balance cannot be charged later
      customer_creation: "always",

      // required tick box, linked to the Terms of service URL set in
      // Stripe → Settings → Business → Public details
      consent_collection: {
        terms_of_service: "required",
      },
      custom_text: {
        terms_of_service_acceptance: {
          message:
            "I have read and agree to the BirdBox Coaching terms of sale and the assumption of risk and waiver of liability.",
        },
      },

      // the person attending is not always the person paying, and a
      // billing name cannot be split reliably — so ask outright
      custom_fields: [
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
      ],

      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: payingNow,
            product_data: {
              name: lineName,
              description: lineDescription,
            },
          },
        },
      ],

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
        full_price_cents: String(full),
      },

      success_url: `${origin}/registration-complete/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/c/${course.slug}/`,
    };

    // Only card payments can be saved for the balance charge.
    if (option !== "klarna") {
      session.payment_intent_data.setup_future_usage = "off_session";
    }

    if (option === "deposit") {
      session.custom_text.submit = {
        message: `You are paying a deposit of ${money(deposit)}. The remaining ${money(balance)} will be charged to this card ${BALANCE_DAYS_BEFORE} days before the course starts.`,
      };
    }

    const created = await stripe.checkout.sessions.create(session);
    return json({ url: created.url });
  } catch (err) {
    console.error("create-checkout failed:", err);
    return json({ error: "Could not start checkout" }, 500);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
