// netlify/functions/stripe-webhook.mjs
//
// Stripe calls this after a payment. It is the ONLY thing that writes
// registrations, and it uses the service key to do it.
//
// On a deposit it also creates the invoice for the balance, dated
// BALANCE_DAYS_BEFORE the course. Stripe finalises and charges that
// invoice on the day, retries failures on its own schedule, and
// emails the customer a hosted link to fix a dead card. Nothing here
// runs on a timer.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const ALERT_EMAIL = "info@birdboxcoaching.com";

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

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(event.data.object);
        break;
      case "invoice.paid":
        await onInvoicePaid(event.data.object);
        break;
      case "invoice.payment_failed":
        await onInvoiceFailed(event.data.object);
        break;
      case "invoice.marked_uncollectible":
      case "invoice.overdue":
        await onInvoiceGivenUp(event.data.object);
        break;
      default:
        break; // ignore everything else
    }
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Webhook handler error:", event.type, err);
    // 500 makes Stripe retry — right for transient failures
    return new Response("error", { status: 500 });
  }
};

// ---------------------------------------------------------------
// a purchase completed
// ---------------------------------------------------------------
async function onCheckoutCompleted(session) {
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
  const accepted = full.consent?.terms_of_service === "accepted";
  const signedAt = accepted ? new Date(full.created * 1000).toISOString() : null;

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
    await alert(
      "Payment taken but registration failed",
      `${firstName} ${lastName} (${details.email}) paid for ${meta.course_slug} ` +
      `but no registration row was created. Stripe session ${full.id}. ` +
      `This probably needs a refund.`
    );
    return;
  }

  const intent =
    typeof full.payment_intent === "string" ? null : full.payment_intent;
  const intentId = typeof full.payment_intent === "string"
    ? full.payment_intent
    : intent?.id || null;

  // money already taken, recorded as instalment 1
  await addPayment({
    registration_id: registration.id,
    sequence: 1,
    amount_cents: full.amount_total,
    due_date: today(),
    charged_at: new Date().toISOString(),
    status: "paid",
    stripe_payment_intent_id: intentId,
  });

  // burn a redemption so single-use codes stop working
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

  // ---- the balance, if this was a deposit ----------------------
  if (option !== "deposit" || balanceCents <= 0) return;

  const dueIso = meta.balance_due_at;
  const finaliseAt = Math.floor(new Date(dueIso).getTime() / 1000);

  const paymentMethod =
    intent?.payment_method ||
    (intentId
      ? (await stripe.paymentIntents.retrieve(intentId)).payment_method
      : null);

  try {
    const invoice = await stripe.invoices.create({
      customer: full.customer,
      collection_method: "charge_automatically",
      default_payment_method: paymentMethod || undefined,
      // Stripe finalises and charges on this date — no cron of ours.
      automatically_finalizes_at: finaliseAt,
      currency: full.currency,
      description: `Balance for ${meta.course_slug}`,
      metadata: {
        registration_id: registration.id,
        course_id: meta.course_id,
        course_slug: meta.course_slug,
        sequence: "2",
      },
    });

    await stripe.invoiceItems.create({
      customer: full.customer,
      invoice: invoice.id,
      amount: balanceCents,
      currency: full.currency,
      description: `Remaining balance — ${meta.course_slug}`,
    });

    await addPayment({
      registration_id: registration.id,
      sequence: 2,
      amount_cents: balanceCents,
      due_date: (dueIso || "").slice(0, 10) || null,
      status: "pending",
      stripe_invoice_id: invoice.id,
    });
  } catch (err) {
    // The deposit is already taken, so never fail the whole webhook —
    // but somebody has to know the balance was not scheduled.
    console.error("Could not schedule balance invoice", registration.id, err);
    await addPayment({
      registration_id: registration.id,
      sequence: 2,
      amount_cents: balanceCents,
      due_date: (dueIso || "").slice(0, 10) || null,
      status: "pending",
      last_error: "Invoice not created: " + (err.message || "unknown"),
    });
    await alert(
      "Balance invoice not scheduled",
      `${firstName} ${lastName} (${details.email}) paid a deposit for ` +
      `${meta.course_slug}, but the balance invoice could not be created. ` +
      `It will need setting up by hand. Error: ${err.message}`
    );
  }
}

// ---------------------------------------------------------------
// the balance was collected
// ---------------------------------------------------------------
async function onInvoicePaid(invoice) {
  const registrationId = invoice.metadata?.registration_id;
  if (!registrationId) return;

  await supabase
    .from("payments")
    .update({
      status: "paid",
      charged_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("stripe_invoice_id", invoice.id);

  await supabase
    .from("registrations")
    .update({ payment_status: "paid_in_full" })
    .eq("id", registrationId);
}

// ---------------------------------------------------------------
// an attempt failed — Stripe will keep retrying
// ---------------------------------------------------------------
async function onInvoiceFailed(invoice) {
  const reason =
    invoice.last_finalization_error?.message ||
    "Card declined — Stripe will retry";

  await supabase
    .from("payments")
    .update({ last_error: reason })
    .eq("stripe_invoice_id", invoice.id);
}

// ---------------------------------------------------------------
// Stripe has given up retrying
// ---------------------------------------------------------------
async function onInvoiceGivenUp(invoice) {
  const registrationId = invoice.metadata?.registration_id;
  if (!registrationId) return;

  await supabase
    .from("payments")
    .update({
      status: "failed",
      last_error: "All retries exhausted — balance unpaid",
    })
    .eq("stripe_invoice_id", invoice.id);

  const { data: reg } = await supabase
    .from("registrations")
    .select("first_name, last_name, email")
    .eq("id", registrationId)
    .single();

  const who = reg
    ? `${reg.first_name} ${reg.last_name} (${reg.email})`
    : `registration ${registrationId}`;

  await alert(
    "Course balance unpaid — action needed",
    `${who} paid a deposit for ${invoice.metadata?.course_slug} but the ` +
    `balance has failed every retry and is still unpaid.\n\n` +
    `Amount outstanding: ${(invoice.amount_due / 100).toFixed(2)} ` +
    `${(invoice.currency || "").toUpperCase()}\n` +
    `Stripe invoice: ${invoice.id}\n\n` +
    `They have not been removed from the course — contact them or remove ` +
    `them manually.`
  );
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

// Sends only if RESEND_API_KEY is set. Until an email provider is
// wired up this logs instead, so nothing silently breaks.
async function alert(subject, body) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("ALERT (no email provider configured):", subject, body);
    return;
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
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
