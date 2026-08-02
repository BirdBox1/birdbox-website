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
//
// It also sends the participant their confirmation email, but only
// for TCC and TGC seminars. Anything else — workshops, TEC, TWC —
// sends nothing, because the schedule and kit list below are only
// true for those two. Widen SENDS_CONFIRMATION when the copy for the
// others exists, not before.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const ALERT_EMAIL = "info@birdboxcoaching.com";
const REPLY_TO = "info@birdboxcoaching.com";

// Change this one line when the custom domain goes live.
const SITE_URL = process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app";

// Brands whose confirmation copy has been written and approved.
const SENDS_CONFIRMATION = ["tcc", "tgc"];

// Must match the BRAND table in c/index.html. The email is branded
// to the course, not to whichever brand was written first.
const BRAND = {
  tcc: { name: "The Coaches Course",       colour: "#2f7fd0" },
  tgc: { name: "The Gymnastics Course",    colour: "#9e2029" },
  tec: { name: "The Endurance Course",     colour: "#1c6b3f" },
  twc: { name: "The Weightlifting Course", colour: "#e8a317" },
};

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

  // ---- the confirmation email ----------------------------------
  // Never allowed to break the webhook: the seat is already booked
  // and the money is taken, so a failed send is logged and flagged,
  // not thrown.
  await sendConfirmation({
    courseId: meta.course_id,
    email: details.email,
    firstName,
    option,
    balanceCents,
  });

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
// the participant's confirmation
// ---------------------------------------------------------------
async function sendConfirmation({ courseId, email, firstName, option, balanceCents }) {
  if (!email) return;

  try {
    const { data: course } = await supabase
      .from("courses")
      .select("brand, level, type, title, venue_name, address, city, country, starts_at, ends_at, timezone")
      .eq("id", courseId)
      .single();

    if (!course) {
      console.warn("No course found for confirmation email", courseId);
      return;
    }

    const brandKey = String(course.brand || "").toLowerCase();
    const isSeminar = String(course.type || "").toLowerCase() !== "workshop";

    // Deliberately narrow. See the note at the top of this file.
    if (!SENDS_CONFIRMATION.includes(brandKey) || !isSeminar) {
      console.log("No confirmation copy for this course type — skipped", {
        courseId, brand: brandKey, type: course.type,
      });
      return;
    }

    const key = process.env.RESEND_API_KEY;
    if (!key) {
      console.warn("No RESEND_API_KEY — confirmation not sent to", email);
      return;
    }

    const brand = BRAND[brandKey] || { name: "BirdBox Coaching", colour: "#2f7fd0" };
    const accent = brand.colour;
    const levelDigits = String(course.level == null ? "" : course.level).replace(/\D/g, "");
    const courseName = brand.name + (levelDigits ? " — Level " + levelDigits : "");
    const dates = formatDates(course);
    const place = [course.city, course.country].filter(Boolean).join(", ");
    const fullAddress = addressLine(course);

    // Manuals only exist for Level 1 today. For anything else the
    // section is left out rather than linking to an empty page.
    const manualUrl = levelDigits === "1"
      ? SITE_URL + "/manuals/" + brandKey + "-l1/"
      : null;

    const bring = [
      "This confirmation email, printed or on your phone",
      "Government-issued photo ID",
      manualUrl ? "The course manual, with a pen — digital is fine, or print it if you prefer" : "A pen and something to write on",
      "Suitable clothes for training",
      "Snacks and fluids, and lunch if you are not going off site",
    ];
    if (brandKey === "tgc") bring.push("Gymnastics grips, if you use them");

    const balanceNote = option === "deposit" && balanceCents > 0
      ? "Your deposit is paid. The remaining balance will be charged automatically to the same card 14 days before the course."
      : null;

    const subject = "You're registered — " + courseName +
      (place ? ", " + place : "") + ", " + dates;

    const text = [
      "Hi " + firstName + ",",
      "",
      "Thank you for registering. Your confirmation is below.",
      "",
      courseName.toUpperCase(),
      dates,
      course.venue_name || "",
      fullAddress,
      "",
      "COURSE SCHEDULE",
      "9:00am to 5:00pm each day, with a one-hour lunch break.",
      "Please arrive at 8:30am on day one to check in.",
      "",
      manualUrl ? "READING MATERIAL" : null,
      manualUrl ? manualUrl : null,
      manualUrl ? "Choose your language on that page." : null,
      manualUrl ? "" : null,
      "WHAT TO BRING",
      ...bring.map((b) => "- " + b),
      "",
      balanceNote,
      balanceNote ? "" : null,
      "Any questions, just reply to this email or contact " + REPLY_TO + ".",
      "",
      "BirdBox Coaching Limited",
      "19 Baggot Street Lower, Dublin 2, D02 X658, Ireland",
    ].filter((line) => line !== null).join("\n");

    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a;max-width:560px;margin:0 auto;padding:8px 4px;">
  <p>Hi ${esc(firstName)},</p>
  <p>Thank you for registering. Your confirmation is below.</p>

  <div style="border-left:3px solid ${accent};padding:2px 0 2px 14px;margin:24px 0;">
    <div style="font-weight:700;font-size:18px;">${esc(courseName)}</div>
    <div style="font-size:17px;">${esc(dates)}</div>
    ${course.venue_name ? `<div style="margin-top:6px;">${esc(course.venue_name)}</div>` : ""}
    <div style="color:#666;">${esc(fullAddress)}</div>
  </div>

  <h3 style="font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#666;margin:28px 0 8px;">Course schedule</h3>
  <p style="margin:0;">9:00am to 5:00pm each day, with a one-hour lunch break.<br>
     Please arrive at <strong>8:30am on day one</strong> to check in.</p>

  ${manualUrl ? `
  <h3 style="font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#666;margin:28px 0 8px;">Reading material</h3>
  <p style="margin:0 0 12px;">Your course manual is available in several languages:</p>
  <p style="margin:0;">
    <a href="${manualUrl}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:5px;">Open your course manual</a>
  </p>
  <p style="color:#666;font-size:14px;margin:10px 0 0;">Choose your language on that page. Digital is fine, or print it if you prefer.</p>
  ` : ""}

  <h3 style="font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#666;margin:28px 0 8px;">What to bring</h3>
  <ul style="margin:0;padding-left:20px;">
    ${bring.map((b) => `<li style="margin-bottom:4px;">${esc(b)}</li>`).join("")}
  </ul>

  ${balanceNote ? `<p style="background:#f4f4f4;border-radius:5px;padding:12px 14px;margin:24px 0 0;font-size:15px;">${esc(balanceNote)}</p>` : ""}

  <p style="margin:28px 0 0;">Any questions, just reply to this email or contact
    <a href="mailto:${REPLY_TO}" style="color:${accent};">${REPLY_TO}</a>.</p>

  <p style="color:#888;font-size:13px;margin-top:32px;border-top:1px solid #e0e0e0;padding-top:16px;">
    BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland
  </p>
</div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.CONFIRM_FROM || process.env.ALERT_FROM || REPLY_TO,
        to: [email],
        reply_to: REPLY_TO,
        subject: subject,
        text: text,
        html: html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("Confirmation email rejected", res.status, body);
      await alert(
        "Confirmation email not delivered",
        `The confirmation to ${email} for ${courseName} was rejected by ` +
        `Resend (${res.status}). They are registered, but have not been ` +
        `told. Response: ${body}`
      );
    }
  } catch (err) {
    console.error("Could not send confirmation email", email, err);
  }
}

// The address field is typed by hand and often already contains the
// city and country. Only add what is missing, so we do not end up
// with "Kirchstraße 18, 80999 München, Germany, Munich, DE".
function addressLine(course) {
  const address = String(course.address || "").trim();
  const seen = address.toLowerCase();
  const parts = address ? [address] : [];
  for (const bit of [course.city, course.country]) {
    const value = String(bit || "").trim();
    if (!value) continue;
    if (seen.includes(value.toLowerCase())) continue;
    parts.push(value);
  }
  return parts.join(", ");
}

// Sunday 25 January 2026 · 25–26 July 2026 · 30 July – 1 August 2026
function formatDates(course) {
  const zone = course.timezone || "UTC";
  const long = { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: zone };
  const start = new Date(course.starts_at);
  const startStr = start.toLocaleDateString("en-GB", long);
  if (!course.ends_at) return startStr;

  const end = new Date(course.ends_at);
  const dayIn = (d) => d.toLocaleDateString("en-GB", { timeZone: zone });
  if (dayIn(start) === dayIn(end)) return startStr;

  const part = (d, opts) => d.toLocaleDateString("en-GB", { ...opts, timeZone: zone });
  const sameMonth =
    part(start, { month: "long", year: "numeric" }) ===
    part(end, { month: "long", year: "numeric" });

  if (sameMonth) {
    return part(start, { day: "numeric" }) + "–" +
           part(end, { day: "numeric", month: "long", year: "numeric" });
  }
  return part(start, { day: "numeric", month: "long" }) + " – " +
         part(end, { day: "numeric", month: "long", year: "numeric" });
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
