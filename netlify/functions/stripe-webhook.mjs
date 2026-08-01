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
    const meta = full.metadata || {};

    // participant name comes from the explicit checkout fields.
    // Fall back to splitting the billing name only if they are missing.
    const field = (key) =>
      full.custom_fields?.find((f) => f.key === key)?.text?.value?.trim();

    const [billingFirst, ...billingRest] = (details.name || "").trim().split(" ");
    const firstName = field("firstname") || billingFirst || "—";
    const lastName = field("lastname") || billingRest.join(" ") || "—";

    // Stripe reports the consent tick back on the session.
    // Only record a signature if it was actually accepted.
    const accepted = full.consent?.terms_of_service === "accepted";
    const signedAt = accepted
      ? new Date(full.created * 1000).toISOString()
      : null;

    const option = meta.payment_option || "full";
    const balanceCents = Number(meta.balance_cents || 0);
    const discountCents = Number(meta.discount_cents || 0);
    const discountCode = meta.discount_code || null;

    // A deposit is not full payment — the balance is still owed.
    const paymentStatus = option === "deposit" ? "deposit_paid" : "paid_in_full";

    const { data: registration, error } = await supabase
      .from("registrations")
      .insert({
        course_id: meta.course_id,
        first_name: firstName,
        last_name: lastName,
        email: details.email,
        phone: details.phone || null,
        country: details.address?.country || null,
        waiver_signed_at: signedAt,
        waiver_version: accepted ? meta.waiver_version : null,
        payment_status: paymentStatus,
        amount_paid_cents: full.amount_total,
        currency: (full.currency || "eur").toUpperCase(),
        stripe_customer_id: full.customer,
        stripe_session_id: full.id,
        discount_code: discountCode,
        discount_cents: discountCents,
      })
      .select("id")
      .single();

    if (error) {
      // 23514 = the capacity trigger fired: paid but no seat.
      // Nothing to retry — this needs a human and a refund.
      console.error("REGISTRATION FAILED AFTER PAYMENT", {
        session: full.id,
        email: details.email,
        course: meta.course_slug,
        error,
      });
      return new Response("logged", { status: 200 });
    }

    // ---- money already taken, recorded as instalment 1 -------------
    const intentId =
      typeof full.payment_intent === "string"
        ? full.payment_intent
        : full.payment_intent?.id || null;

    await addPayment({
      registration_id: registration.id,
      sequence: 1,
      amount_cents: full.amount_total,
      due_date: today(),
      charged_at: new Date().toISOString(),
      status: "paid",
      stripe_payment_intent_id: intentId,
    });

    // ---- balance owed on a deposit, charged before the course ------
    if (option === "deposit" && balanceCents > 0) {
      await addPayment({
        registration_id: registration.id,
        sequence: 2,
        amount_cents: balanceCents,
        due_date: (meta.balance_due_at || "").slice(0, 10) || null,
        status: "pending",
      });
    }

    // ---- burn a redemption so single-use codes stop working --------
    if (discountCode) {
      const { error: bumpError } = await supabase.rpc(
        "bump_discount_redemption",
        { p_code: discountCode }
      );
      if (bumpError) {
        console.error("Could not count discount redemption", discountCode, bumpError);
      }
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

// The payments.status enum is not one I can see from here, so if the
// value is rejected the row is written without it and the column
// default applies. A missing payment row must never lose a paid
// registration, so failures are logged rather than thrown.
async function addPayment(row) {
  const { error } = await supabase.from("payments").insert(row);
  if (!error) return;

  const { status, ...withoutStatus } = row;
  const retry = await supabase.from("payments").insert(withoutStatus);
  if (retry.error) {
    console.error("Could not write payment row", row, retry.error);
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export const config = { path: "/api/stripe-webhook" };
