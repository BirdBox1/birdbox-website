// netlify/functions/stripe-webhook.mjs
//
// Stripe calls this after a successful payment. It is the ONLY thing
// that writes registrations, and it uses the service key to do it.
//
// Signature verification is mandatory: without it anyone who finds the
// URL could POST fake registrations.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async (req) => {
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text(); // must be the raw string, not parsed JSON

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Bad webhook signature:", err.message);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return new Response("ok", { status: 200 }); // ignore everything else for now
  }

  const session = event.data.object;

  try {
    const full = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["customer_details", "payment_intent"],
    });

    const details = full.customer_details || {};
    const [firstName, ...rest] = (details.name || "").trim().split(" ");

    // Stripe reports the consent tick back on the session.
    // Only record a signature if it was actually accepted.
    const accepted = full.consent?.terms_of_service === "accepted";
    const signedAt = accepted
      ? new Date(full.created * 1000).toISOString()
      : null;

    const { error } = await supabase.from("registrations").insert({
      course_id: full.metadata.course_id,
      first_name: firstName || "—",
      last_name: rest.join(" ") || "—",
      email: details.email,
      phone: details.phone || null,
      country: details.address?.country || null,
      waiver_signed_at: signedAt,
      waiver_version: accepted ? full.metadata.waiver_version : null,
      payment_status: "paid_in_full",
      amount_paid_cents: full.amount_total,
      currency: (full.currency || "eur").toUpperCase(),
      stripe_customer_id: full.customer,
      stripe_session_id: full.id,
    });

    if (error) {
      // 23514 = the capacity trigger fired: paid but no seat.
      // Nothing to retry — this needs a human and a refund.
      console.error("REGISTRATION FAILED AFTER PAYMENT", {
        session: full.id,
        email: details.email,
        course: full.metadata.course_slug,
        error,
      });
      return new Response("logged", { status: 200 });
    }

    if (!accepted) {
      console.warn("Registration created without waiver acceptance", full.id);
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Webhook handler error:", err);
    // 500 makes Stripe retry — right for transient failures
    return new Response("error", { status: 500 });
  }
};

export const config = { path: "/api/stripe-webhook" };
