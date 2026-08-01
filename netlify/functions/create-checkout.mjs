// netlify/functions/create-checkout.mjs
//
// POST { slug: "tgc-l1-dublin-oct" }  ->  { url: "https://checkout.stripe.com/..." }
//
// Runs server-side only. The service key never reaches the browser.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Bump this whenever the wording at /agreements/ changes.
// It is stored against every registration so you can always tell
// which version a given participant agreed to.
const WAIVER_VERSION = "2026-08-v1";

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
    const { slug } = await req.json();
    if (!slug) return json({ error: "Missing slug" }, 400);

    // ---- look up the course ------------------------------------
    const { data: course, error } = await supabase
      .from("courses")
      .select("id, brand, title, summary, slug, price_cents, currency, capacity, status, starts_at, city, country")
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

    const origin = req.headers.get("origin") || process.env.SITE_URL;

    // ---- create the Checkout session ---------------------------
    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      // always create a Stripe Customer — without one there is no
      // saved card, and deposits / instalments cannot be charged later
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
            currency: course.currency.toLowerCase(),
            unit_amount: course.price_cents,
            product_data: {
              name: course.title,
              description: course.summary || undefined,
            },
          },
        },
      ],

      // save the card so deposits / instalments can be charged later
      payment_intent_data: {
        setup_future_usage: "off_session",
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
      },

      success_url: `${origin}/registration-complete/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/${course.brand}/${course.slug}/`,
    });

    return json({ url: session.url });
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
