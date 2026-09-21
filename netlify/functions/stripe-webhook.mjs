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
// for TCC and TGC. Anything else — TEC, TWC —
// sends nothing, because the schedule and kit list below are only
// true for those two. Widen SENDS_CONFIRMATION when the copy for the
// others exists, not before.
//
// Where a course grants a free online course, the participant is
// also enrolled in LearnWorlds before the confirmation goes out, so
// the LearnWorlds emails land first and ours can refer to them.
//
// It also notices when somebody tries to register and does not get
// through — a declined card, or a checkout they walked away from.
// Those are written to abandoned_checkouts, and a separate hourly
// function offers them a hand an hour later if they have not come
// back on their own. Most of them do come back when asked.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { grantOnlineCourse } from "./learnworlds.mjs";

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

// Where participants log in to their online courses.
const LMS_URL = "https://www.birdboxacademy.com";

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
      case "checkout.session.expired":
        // A payment-plan deposit page left unpaid is not an abandoned
        // booking — the payer can open their plan link again.
        if (event.data.object.metadata?.kind === "plan_deposit") break;
        await onCheckoutAbandoned(event.data.object);
        break;
      case "payment_intent.payment_failed":
        if (event.data.object.metadata?.kind === "plan_deposit") break;
        await onPaymentFailed(event.data.object);
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
  // A payment-plan deposit from the portal. It creates nobody — the
  // payer names people afterwards — so it must never reach the
  // website booking code below.
  if (session.metadata?.kind === "plan_deposit") {
    await onPlanDepositPaid(session);
    return;
  }
  const full = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["customer_details", "payment_intent"],
  });

  const details = full.customer_details || {};
  const meta = full.metadata || {};

  // participant name comes from the explicit checkout fields.
  // Fall back to splitting the billing name only if they are missing.
  const field = (key) =>
    full.custom_fields?.find((f) => f.key === key)?.text?.value?.trim();

  // Dropdown answers live somewhere different from text answers.
  const choice = (key) =>
    full.custom_fields?.find((f) => f.key === key)?.dropdown?.value || null;

  const [billingFirst, ...billingRest] = (details.name || "").trim().split(" ");
  const firstName = field("firstname") || billingFirst || "—";
  const lastName = field("lastname") || billingRest.join(" ") || "—";

  // Which language they chose for their free online course.
  const onlineLanguage = choice("lwlanguage");

  // Stripe reports the consent tick back on the session.
  const accepted = full.consent?.terms_of_service === "accepted";
  const signedAt = accepted ? new Date(full.created * 1000).toISOString() : null;

  const option = meta.payment_option || "full";
  const balanceCents = Number(meta.balance_cents || 0);
  const discountCents = Number(meta.discount_cents || 0);
  const discountCode = meta.discount_code || null;

  // A deposit is not full payment — the balance is still owed.
  const paymentStatus = option === "deposit" ? "deposit_paid" : "paid_in_full";

  // Cheaper than relying on the constraint, and it keeps the log
  // honest: a redelivered event stops here rather than looking like a
  // failure further down.
  {
    const { data: already } = await supabase
      .from("registrations")
      .select("id")
      .eq("stripe_session_id", full.id)
      .maybeSingle();
    if (already) {
      console.log("Session already handled, nothing to do", { session: full.id });
      return;
    }
  }

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
      learnworlds_language: onlineLanguage,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = this session is already registered. Stripe redelivers an
    // event whenever a handler returns 500, and the unique index on
    // stripe_session_id then refuses the second insert. That is the
    // retry working exactly as intended, not a person who paid and got
    // nothing — so it must not raise an alarm telling somebody to
    // refund a participant who is correctly on the course.
    if (error.code === "23505") {
      console.log("Already registered, ignoring retry", { session: full.id });
      return;
    }

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

  // Burn a redemption so single-use codes stop working. The course has
  // to go with it: every seminar now carries its own EB10, and the old
  // one-argument version counted a single sale against every row
  // sharing the code — one Munich registration would have exhausted
  // the count on all of them.
  if (discountCode) {
    const { error: bumpError } = await supabase.rpc(
      "bump_discount_redemption",
      { p_code: discountCode, p_course_id: meta.course_id }
    );
    if (bumpError) {
      console.error("Could not count discount redemption", discountCode, bumpError);
    }
  }

  // They may have been declined earlier and come back on their own.
  // Close off anything outstanding for them on this course, so the
  // hourly chase does not write to somebody who has already paid.
  //
  // Matched on email and course rather than session id, because a
  // retry usually starts a new checkout altogether.
  if (details.email) {
    const { error: recoverError } = await supabase
      .from("abandoned_checkouts")
      .update({ recovered_at: new Date().toISOString() })
      .eq("course_id", meta.course_id)
      .ilike("email", details.email)
      .is("recovered_at", null);

    if (recoverError) {
      console.error("Could not close the abandoned record", recoverError.message);
    }
  }

  if (!accepted) {
    console.warn("Registration created without waiver acceptance", full.id);
  }

  // ---- the free online course, where the course grants one ------
  // Runs before the confirmation email so the LearnWorlds password
  // and enrolment emails arrive first. Like everything else after
  // the money is taken, a failure is recorded and flagged rather
  // than thrown.
  const online = await maybeEnrol({
    registrationId: registration.id,
    meta,
    email: details.email,
    firstName,
    lastName,
    language: onlineLanguage,
  });

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
    online,
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
      // auto_advance must be on, or Stripe rejects the date outright.
      auto_advance: true,
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
// the free online course
// ---------------------------------------------------------------
// Returns null when this course grants nothing, so the confirmation
// email can leave the section out entirely.
async function maybeEnrol({ registrationId, meta, email, firstName, lastName, language }) {
  if (meta.grants_online_course !== "yes") return null;

  const { data: course } = await supabase
    .from("courses")
    .select("brand, level, title")
    .eq("id", meta.course_id)
    .single();

  if (!course) return null;

  // They should never reach payment without choosing, since the
  // dropdown is mandatory — but if the field were ever removed, this
  // records the gap rather than silently enrolling them in English.
  if (!language) {
    await supabase.from("registrations").update({
      learnworlds_status: "failed",
      learnworlds_error: "No language was chosen at checkout",
    }).eq("id", registrationId);

    await alert(
      "Online course not granted — no language chosen",
      `${firstName} ${lastName} (${email}) registered for ${meta.course_slug} ` +
      `but no language came through, so they have not been enrolled. ` +
      `Grant it by hand from the portal.`
    );
    return { status: "failed" };
  }

  const result = await grantOnlineCourse(supabase, {
    email,
    firstName,
    lastName,
    brand: course.brand,
    level: course.level,
    language,
    justification: `Included free with ${course.title}`,
  });

  await supabase.from("registrations").update({
    learnworlds_status: result.status,
    learnworlds_user_id: result.userId || null,
    learnworlds_enrolled_at: result.status === "enrolled" ? new Date().toISOString() : null,
    learnworlds_error: result.error || null,
  }).eq("id", registrationId);

  if (result.status !== "enrolled") {
    console.error("LearnWorlds enrolment failed", registrationId, result.error);
    await alert(
      "Online course access not granted",
      `${firstName} ${lastName} (${email}) paid for ${meta.course_slug} and ` +
      `is owed free access to the online course, but the enrolment failed.\n\n` +
      `Reason: ${result.error}\n\n` +
      `They are registered for the seminar and their payment is fine. ` +
      `Grant the online course by hand from the portal.`
    );
  }

  return result;
}

// ---------------------------------------------------------------
// the balance was collected
// ---------------------------------------------------------------
async function onInvoicePaid(invoice) {
  // An invoice sent from the portal for a block of places. Checked
  // first, because it also carries a course_id and would otherwise be
  // filed as a host payment below.
  if (invoice.metadata?.portal_invoice_id) {
    if (invoice.metadata.kind === "plan_instalment") await onPlanInstalmentPaid(invoice);
    else await onGroupInvoicePaid(invoice);
    return;
  }

  const registrationId = invoice.metadata?.registration_id;

  // An invoice carrying a course rather than a registration is money
  // that arrived outside the checkout — a gym prepaying for a block of
  // places, most often. It belongs to the course, not to any one
  // person on it, so it is recorded separately and never touched by
  // the refund or cancellation paths that walk `payments`.
  if (!registrationId) {
    const courseId = invoice.metadata?.course_id;
    if (!courseId) return;

    const line = (invoice.lines?.data && invoice.lines.data[0]) || {};

    // Stripe reports the total including tax; the portal stores prices
    // net, so the two are kept apart rather than added together.
    const tax = invoice.tax ?? invoice.total_tax_amounts?.[0]?.amount ?? null;
    const gross = invoice.amount_paid ?? invoice.total ?? 0;
    const net = tax == null ? gross : gross - tax;

    const spaces = parseInt(invoice.metadata?.spaces, 10);

    const { error } = await supabase
      .from("course_payments")
      .upsert({
        course_id: courseId,
        kind: invoice.metadata?.kind || "host_invoice",
        description: invoice.metadata?.description || line.description || null,
        payer_name: invoice.customer_name || null,
        payer_email: invoice.customer_email || null,
        amount_cents: net,
        vat_cents: tax,
        currency: (invoice.currency || "eur").toUpperCase(),
        spaces: Number.isFinite(spaces) ? spaces : null,
        stripe_invoice_id: invoice.id,
        status: "paid",
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "stripe_invoice_id" });

    // Stripe retries on a 500, and an upsert on the invoice id means a
    // retry cannot record the same money twice.
    if (error) throw new Error("course_payments: " + error.message);
    return;
  }

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
// payment plans sent from the portal
// ---------------------------------------------------------------
// The payer agrees on /plan/, pays the deposit through Stripe
// Checkout, and their card is saved. From here Stripe charges each
// instalment on its date by itself — every one is created now as a
// draft that Stripe finalises and charges automatically, the same way
// website deposit bookings charge their balance.

function dueStamp(isoDate) {
  // 09:00 UTC on the due day, so it lands in working hours in Europe.
  return Math.floor(new Date(isoDate + "T09:00:00Z").getTime() / 1000);
}

async function onPlanDepositPaid(session) {
  const id = session.metadata.portal_invoice_id;
  const { data: row, error } = await supabase
    .from("invoices")
    .select("*, courses ( title, brand )")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("invoices: " + error.message);
  if (!row) { console.warn("Plan deposit for unknown invoice", id); return; }

  // Stripe can send the same event twice, or again if this run is slow.
  // Claiming the plan first means only one run ever schedules the
  // instalments.
  if (row.plan_state !== "awaiting_deposit") return;
  const { data: claimed } = await supabase
    .from("invoices")
    .update({ plan_state: "active", status: "paid" })
    .eq("id", row.id)
    .eq("plan_state", "awaiting_deposit")
    .select("id");
  if (!claimed || !claimed.length) return;

  const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ["payment_intent"] });
  const intent = full.payment_intent;
  const paymentMethod = intent && typeof intent === "object" ? intent.payment_method : null;
  const customer = full.customer || row.stripe_customer_id;

  // Future instalments are charged to this card without the customer
  // present, which is what they agreed to on the plan page.
  if (customer && paymentMethod) {
    try {
      await stripe.customers.update(customer, { invoice_settings: { default_payment_method: paymentMethod } });
    } catch (err) {
      console.error("Could not set default card", err.message);
    }
  }

  let taxRateId = null;
  if (row.vat_country && Number(row.vat_rate) > 0) {
    const { data: vr } = await supabase
      .from("vat_rates").select("stripe_tax_rate_id").eq("code", row.vat_country).maybeSingle();
    taxRateId = vr && vr.stripe_tax_rate_id ? vr.stripe_tax_rate_id : null;
  }

  const course = (row.courses && row.courses.title) || "course";
  const schedule = Array.isArray(row.schedule) ? row.schedule.map((x) => ({ ...x })) : [];
  const problems = [];

  for (const item of schedule) {
    if (item.kind === "deposit") {
      item.status = "paid";
      item.paid_at = new Date().toISOString();
      item.paid_cents = full.amount_total;
      continue;
    }
    try {
      const inv = await stripe.invoices.create({
        customer,
        collection_method: "charge_automatically",
        default_payment_method: paymentMethod || undefined,
        auto_advance: true,
        automatically_finalizes_at: dueStamp(item.due_date),
        currency: String(row.currency).toLowerCase(),
        default_tax_rates: taxRateId ? [taxRateId] : [],
        description: `Instalment ${item.n} of ${row.instalments} — ${course}`,
        metadata: {
          portal_invoice_id: row.id,
          course_id: row.course_id,
          kind: "plan_instalment",
          n: String(item.n),
        },
      });
      await stripe.invoiceItems.create({
        customer,
        invoice: inv.id,
        amount: item.net_cents,
        currency: String(row.currency).toLowerCase(),
        description: `${course} — instalment ${item.n} of ${row.instalments} (${row.places} place${row.places === 1 ? "" : "s"})`,
      });
      item.stripe_invoice_id = inv.id;
      item.status = "scheduled";
    } catch (err) {
      console.error("Could not schedule instalment", item.n, err);
      item.status = "not_scheduled";
      item.error = err.message;
      problems.push(`Instalment ${item.n} (${item.due_date}): ${err.message}`);
    }
  }

  const { data: saved, error: upErr } = await supabase
    .from("invoices")
    .update({
      status: "paid",
      plan_state: "active",
      paid_at: new Date().toISOString(),
      paid_cents: full.amount_total || 0,
      payment_method_id: paymentMethod,
      stripe_customer_id: customer,
      schedule,
    })
    .eq("id", row.id)
    .select("payer_name, business_name, payer_email, places, names_token, names_emailed_at, courses ( title, brand )")
    .single();
  if (upErr) throw new Error("invoices: " + upErr.message);

  // One place: the payer is the participant, so they are registered
  // now. The names page they land on then shows them as registered.
  let registered = false;
  if (row.places === 1 && !saved.names_emailed_at) {
    registered = await registerPayer({ ...row, plan_state: "active", paid_cents: full.amount_total || 0 });
    if (registered) await supabase.from("invoices").update({ names_emailed_at: new Date().toISOString() }).eq("id", row.id);
  }

  // The Checkout success page takes them straight to the names form;
  // this email is the copy they can come back to.
  let emailed = !!saved.names_emailed_at || registered;
  if (!emailed) {
    emailed = await sendNamesForm(saved, { number: "", id: session.id });
    if (emailed) await supabase.from("invoices").update({ names_emailed_at: new Date().toISOString() }).eq("id", row.id);
  }

  const who = row.business_name || row.payer_name;
  await alert(
    problems.length ? "Payment plan started — SOME INSTALMENTS NOT SCHEDULED" : "Payment plan started",
    `${who} paid the deposit of ${((full.amount_total || 0) / 100).toFixed(2)} ${String(row.currency).toUpperCase()} ` +
    `for ${row.places} place${row.places === 1 ? "" : "s"} on ${course}. ` +
    `${row.instalments} monthly instalment${row.instalments === 1 ? "" : "s"} follow.\n\n` +
    (registered ? `${row.payer_name} has been registered and sent their confirmation.`
      : emailed ? "They have been sent the form to name each person."
      : "The names form email did NOT send — copy the form link from the portal.") +
    (problems.length ? "\n\nThese instalments could not be set up in Stripe and need doing by hand:\n" + problems.join("\n") : "")
  );
}

async function onPlanInstalmentPaid(invoice) {
  const id = invoice.metadata.portal_invoice_id;
  const n = Number(invoice.metadata.n);
  const { data: row, error } = await supabase
    .from("invoices")
    .select("id, places, currency, instalments, paid_cents, schedule, plan_state, payer_name, business_name, courses ( title )")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("invoices: " + error.message);
  if (!row) return;

  const schedule = Array.isArray(row.schedule) ? row.schedule.map((x) => ({ ...x })) : [];
  const item = schedule.find((x) => x.n === n && x.kind !== "deposit");
  if (!item || item.status === "paid") return; // retry of an event already handled

  const amount = invoice.amount_paid || 0;
  item.status = "paid";
  item.paid_at = new Date().toISOString();
  item.paid_cents = amount;
  delete item.error;

  const done = schedule.filter((x) => x.kind !== "deposit").every((x) => x.status === "paid");

  await supabase.from("invoices").update({
    schedule,
    paid_cents: (row.paid_cents || 0) + amount,
    plan_state: done ? "completed" : (row.plan_state === "failed" ? "active" : row.plan_state),
  }).eq("id", row.id);

  // Everyone named so far gets their share of this payment.
  const { data: regs } = await supabase
    .from("registrations").select("id, amount_paid_cents").eq("invoice_id", row.id);
  const share = Math.round(amount / row.places);
  for (const r of regs || []) {
    const patch = { amount_paid_cents: (r.amount_paid_cents || 0) + share };
    if (done) patch.payment_status = "paid_in_full";
    await supabase.from("registrations").update(patch).eq("id", r.id);
  }

  if (done) {
    await alert(
      "Payment plan completed",
      `${row.business_name || row.payer_name} has paid the final instalment for ` +
      `${(row.courses && row.courses.title) || "a course"}. Everyone on it is now paid in full.`
    );
  }
}

async function onPlanInstalmentFailed(invoice) {
  // Stripe retries a failed card several times. The payer and the
  // office are told once, on the first failure, not on every retry.
  if ((invoice.attempt_count || 0) > 1) return;

  const id = invoice.metadata.portal_invoice_id;
  const n = Number(invoice.metadata.n);
  const { data: row } = await supabase
    .from("invoices")
    .select("id, schedule, payer_name, business_name, payer_email, instalments, currency, courses ( title, brand )")
    .eq("id", id).maybeSingle();
  if (!row) return;

  const schedule = Array.isArray(row.schedule) ? row.schedule.map((x) => ({ ...x })) : [];
  const item = schedule.find((x) => x.n === n && x.kind !== "deposit");
  if (item) { item.status = "retrying"; item.error = "Card declined — Stripe is retrying"; }
  await supabase.from("invoices").update({ schedule }).eq("id", row.id);

  const course = (row.courses && row.courses.title) || "your course";
  const amount = `${((invoice.amount_due || 0) / 100).toFixed(2)} ${String(row.currency).toUpperCase()}`;
  const link = invoice.hosted_invoice_url;
  const first = String(row.payer_name || "").trim().split(/\s+/)[0] || "there";

  const key = process.env.RESEND_API_KEY;
  if (key && row.payer_email) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.CONFIRM_FROM || process.env.ALERT_FROM || REPLY_TO,
          to: [row.payer_email],
          reply_to: REPLY_TO,
          subject: `Payment not taken — ${course}`,
          text: [
            `Hi ${first},`,
            "",
            `We tried to take instalment ${n} of ${row.instalments} (${amount}) for ${course}, but the card was declined.`,
            "",
            "We will try again automatically over the next few days. To pay now, or to use a different card:",
            link || "(reply to this email and we will send you a link)",
            "",
            "Any questions, just reply to this email.",
            "",
            "BirdBox Coaching",
          ].join("\n"),
        }),
      });
    } catch (err) {
      console.error("Could not email payer about failed instalment", err);
    }
  }

  await alert(
    "Payment plan instalment failed",
    `Instalment ${n} of ${row.instalments} (${amount}) for ${row.business_name || row.payer_name} ` +
    `(${row.payer_email}) on ${course} was declined. They have been emailed a link to pay or change card; ` +
    `Stripe will keep retrying.` + (link ? `\n\n${link}` : "")
  );
}

async function onPlanInstalmentGivenUp(invoice) {
  const id = invoice.metadata.portal_invoice_id;
  const n = Number(invoice.metadata.n);
  const { data: row } = await supabase
    .from("invoices")
    .select("id, schedule, payer_name, business_name, payer_email, instalments, currency, courses ( title )")
    .eq("id", id).maybeSingle();
  if (!row) return;

  const schedule = Array.isArray(row.schedule) ? row.schedule.map((x) => ({ ...x })) : [];
  const item = schedule.find((x) => x.n === n && x.kind !== "deposit");
  if (item && item.status === "paid") return;
  if (item) { item.status = "failed"; item.error = "All retries failed"; }
  await supabase.from("invoices").update({ schedule, plan_state: "failed" }).eq("id", row.id);

  await alert(
    "Payment plan instalment UNPAID",
    `Stripe has stopped retrying instalment ${n} of ${row.instalments} ` +
    `(${((invoice.amount_due || 0) / 100).toFixed(2)} ${String(row.currency).toUpperCase()}) ` +
    `for ${row.business_name || row.payer_name} (${row.payer_email}) on ` +
    `${(row.courses && row.courses.title) || "a course"}. This needs chasing by hand.` +
    (invoice.hosted_invoice_url ? `\n\nPay link: ${invoice.hosted_invoice_url}` : "")
  );
}

// The email that sends a payer their plan link, from the portal.
export async function sendPlanEmail(row, course) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !row.names_token || !row.payer_email) return false;

  const brandKey = String(course.brand || "").toLowerCase();
  const accent = (BRAND[brandKey] || {}).colour || "#2f7fd0";
  const link = `${SITE_URL.replace(/\/+$/, "")}/plan/?t=${row.names_token}`;
  const first = String(row.payer_name || "").trim().split(/\s+/)[0] || "there";
  const cur = String(row.currency).toUpperCase();
  const m = (c) => `${cur} ${(c / 100).toFixed(2)}`;
  const n = row.places;

  const text = [
    `Hi ${first},`,
    "",
    `Here is your payment plan for ${n} place${n === 1 ? "" : "s"} on ${course.title}: ` +
    `${m(row.total_cents)} in total — a deposit of ${m(row.deposit_cents)} today, then ` +
    `${row.instalments} monthly payment${row.instalments === 1 ? "" : "s"}.`,
    "",
    "Open the link to see the full schedule, agree to the plan and pay the deposit:",
    link,
    "",
    "Your places are confirmed as soon as the deposit is paid.",
    "",
    "Any questions, just reply to this email.",
    "",
    "BirdBox Coaching",
  ].join("\n");

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#16181b;font-size:16px;line-height:1.55;">
  <p>Hi ${esc(first)},</p>
  <p>Here is your payment plan for ${n} place${n === 1 ? "" : "s"} on <strong>${esc(course.title)}</strong>:
  <strong>${esc(m(row.total_cents))}</strong> in total — a deposit of ${esc(m(row.deposit_cents))} today, then
  ${row.instalments} monthly payment${row.instalments === 1 ? "" : "s"}.</p>
  <p style="margin:28px 0;"><a href="${link}" style="background:${accent};color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:6px;display:inline-block;">See the plan and pay the deposit</a></p>
  <p>Your places are confirmed as soon as the deposit is paid.</p>
  <p>Any questions, just reply to this email.</p>
  <p>BirdBox Coaching</p>
  <p style="color:#888;font-size:13px;margin-top:32px;border-top:1px solid #e0e0e0;padding-top:16px;">
    BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland
  </p>
</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.CONFIRM_FROM || process.env.ALERT_FROM || REPLY_TO,
        to: [row.payer_email],
        reply_to: REPLY_TO,
        subject: `Your payment plan — ${course.title}`,
        text, html,
      }),
    });
    if (!res.ok) { console.error("Plan email rejected", res.status, await res.text()); return false; }
    return true;
  } catch (err) {
    console.error("Could not send plan email", err);
    return false;
  }
}

// ---------------------------------------------------------------
// a portal invoice for a block of places was paid
// ---------------------------------------------------------------
// Only the invoice is marked paid. People are added against it in the
// portal afterwards, and each gets their confirmation as they are
// added. Safe to run twice: a retry just writes the same values.
async function onGroupInvoicePaid(invoice) {
  const id = invoice.metadata.portal_invoice_id;

  const { data: row, error } = await supabase
    .from("invoices")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      total_cents: invoice.amount_paid ?? invoice.total ?? null,
      last_error: null,
    })
    .eq("id", id)
    .select("id, course_id, kind, plan_state, paid_cents, total_cents, currency, unit_price_cents, vat_rate, discount_code, discount_percent, discount_amount_cents, payer_name, business_name, payer_email, places, names_token, names_emailed_at, courses ( title, brand )")
    .maybeSingle();

  if (error) throw new Error("invoices: " + error.message);
  if (!row) {
    console.warn("Paid portal invoice has no row", { id, invoice: invoice.id });
    return;
  }

  // One place: the payer is the participant. Register them straight
  // away instead of asking them to fill in a form for themselves.
  if (row.places === 1 && !row.names_emailed_at) {
    const done = await registerPayer(row);
    if (done) {
      await supabase.from("invoices").update({ names_emailed_at: new Date().toISOString() }).eq("id", id);
      await alert(
        "Invoice paid — registered",
        `${row.payer_name} paid invoice ${invoice.number || invoice.id} for 1 place on ` +
        `${(row.courses && row.courses.title) || "a course"} and has been registered and sent their confirmation.`
      );
      return;
    }
  }

  const who = row.business_name || row.payer_name;
  const course = (row.courses && row.courses.title) || "a course";
  const paidLine =
    `${who} has paid invoice ${invoice.number || invoice.id} for ${row.places} ` +
    `place${row.places === 1 ? "" : "s"} on ${course}: ` +
    `${((invoice.amount_paid || 0) / 100).toFixed(2)} ${(invoice.currency || "").toUpperCase()}.`;

  // Stripe can deliver the same event twice; the payer gets one email.
  if (row.names_emailed_at) return;

  const sent = await sendNamesForm(row, invoice);
  if (sent) {
    await supabase.from("invoices").update({ names_emailed_at: new Date().toISOString() }).eq("id", id);
    await alert(
      "Invoice paid",
      paidLine + "\n\n" +
      `${row.payer_email} has been emailed the form to name each person. ` +
      `Everyone is registered and sent their confirmation as they are named — ` +
      `nothing to do unless they ask for help.`
    );
  } else {
    await alert(
      "Invoice paid — names form NOT sent",
      paidLine + "\n\n" +
      `The email asking ${row.payer_email} to name the participants did not send. ` +
      `Open the course in the portal → Admin → Participant invoices, and either ` +
      `copy the form link to them yourself or add each person.`
    );
  }
}

// Registers the payer themselves on a one-place invoice or plan, the
// same way the names form would. Returns false (and the names form is
// used instead) if their name cannot be split into first and last, the
// course is full, or anything else stops it.
async function registerPayer(row) {
  const parts = String(row.payer_name || "").trim().split(/\s+/);
  const first = parts.shift() || "";
  const last = parts.join(" ");
  if (!first || !last || !row.payer_email) return false;

  const { count } = await supabase
    .from("registrations").select("id", { count: "exact", head: true }).eq("invoice_id", row.id);
  if ((count || 0) > 0) return true;

  const isPlan = row.kind === "plan";
  const vatFactor = 1 + (Number(row.vat_rate) || 0) / 100;
  const discountEach = row.discount_amount_cents
    ? Math.round(row.discount_amount_cents * vatFactor)
    : Math.round((row.unit_price_cents || 0) * (Number(row.discount_percent) || 0) / 100 * vatFactor);

  const { error } = await supabase.from("registrations").insert({
    course_id: row.course_id,
    first_name: first,
    last_name: last,
    email: row.payer_email,
    status: "active",
    source: "manual",
    source_note: isPlan ? "Payment plan — " + row.payer_name : "Invoice — " + row.payer_name,
    payment_status: isPlan && row.plan_state !== "completed" ? "deposit_paid" : "paid_in_full",
    amount_paid_cents: (isPlan ? row.paid_cents : row.total_cents) || 0,
    currency: String(row.currency || "EUR").toUpperCase(),
    discount_code: row.discount_code || null,
    discount_cents: discountEach,
    invoice_id: row.id,
  });
  if (error) {
    console.error("Could not register payer", error);
    return false;
  }

  await sendConfirmation({
    courseId: row.course_id,
    email: row.payer_email,
    firstName: first,
    option: "full",
    balanceCents: 0,
    online: null,
  });
  return true;
}

// The email to whoever paid, with the link to the names form.
export async function sendNamesForm(row, invoice) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !row.names_token || !row.payer_email) return false;

  const brandKey = String((row.courses && row.courses.brand) || "").toLowerCase();
  const accent = (BRAND[brandKey] || {}).colour || "#2f7fd0";
  const course = (row.courses && row.courses.title) || "the course";
  const link = `${SITE_URL.replace(/\/+$/, "")}/invoice-names/?t=${row.names_token}`;
  const first = String(row.payer_name || "").trim().split(/\s+/)[0] || "there";
  const n = row.places;

  const text = [
    `Hi ${first},`,
    "",
    `Thank you — your payment for ${n} place${n === 1 ? "" : "s"} on ${course} has been received.`,
    "",
    `Please tell us who is coming. For each person we need their name as it should appear on their certificate, their email and a phone number:`,
    link,
    "",
    `Each person is registered and emailed their confirmation as soon as you submit. If you do not have every name yet, fill in the ones you have and use the same link again later.`,
    "",
    "Any questions, just reply to this email.",
    "",
    "BirdBox Coaching",
  ].join("\n");

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#16181b;font-size:16px;line-height:1.55;">
  <p>Hi ${esc(first)},</p>
  <p>Thank you — your payment for ${n} place${n === 1 ? "" : "s"} on <strong>${esc(course)}</strong> has been received.</p>
  <p>Please tell us who is coming. For each person we need their name as it should appear on their certificate, their email and a phone number.</p>
  <p style="margin:28px 0;"><a href="${link}" style="background:${accent};color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:6px;display:inline-block;">Name your participants</a></p>
  <p>Each person is registered and emailed their confirmation as soon as you submit. If you do not have every name yet, fill in the ones you have and use the same link again later.</p>
  <p>Any questions, just reply to this email.</p>
  <p>BirdBox Coaching</p>
  <p style="color:#888;font-size:13px;margin-top:32px;border-top:1px solid #e0e0e0;padding-top:16px;">
    Invoice ${esc(invoice.number || "")} · BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland
  </p>
</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.CONFIRM_FROM || process.env.ALERT_FROM || REPLY_TO,
        to: [row.payer_email],
        reply_to: REPLY_TO,
        subject: `Who is coming? Name your participants — ${course}`,
        text,
        html,
      }),
    });
    if (!res.ok) {
      console.error("Names form email rejected", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Could not send names form email", err);
    return false;
  }
}

async function onGroupInvoiceOverdue(invoice) {
  const id = invoice.metadata.portal_invoice_id;
  const { data: row } = await supabase
    .from("invoices")
    .select("payer_name, business_name, payer_email, status, courses ( title )")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.status === "paid" || row.status === "void") return;

  await alert(
    "Invoice overdue",
    `Invoice ${invoice.number || invoice.id} to ${row.business_name || row.payer_name} ` +
    `(${row.payer_email}) for ${(row.courses && row.courses.title) || "a course"} is past its due date ` +
    `and unpaid: ${((invoice.amount_due || 0) / 100).toFixed(2)} ${(invoice.currency || "").toUpperCase()}.`
  );
}

// ---------------------------------------------------------------
// an attempt failed — Stripe will keep retrying
// ---------------------------------------------------------------
async function onInvoiceFailed(invoice) {
  if (invoice.metadata?.kind === "plan_instalment") {
    await onPlanInstalmentFailed(invoice);
    return;
  }
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
  if (invoice.metadata?.portal_invoice_id) {
    if (invoice.metadata.kind === "plan_instalment") await onPlanInstalmentGivenUp(invoice);
    else await onGroupInvoiceOverdue(invoice);
    return;
  }

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
// somebody tried and did not get through
// ---------------------------------------------------------------
//
// Two ways it happens. A card is declined at the last step — which is
// the common one, and the person is right there wanting to pay. Or
// the checkout expires because they walked away.
//
// Neither creates a registration, so without this there is no record
// anywhere on our side that they ever tried. Nothing is emailed from
// here: the hourly function waits to see whether they come back on
// their own first, because most people retry within minutes and an
// email in that window is just noise.

async function onCheckoutAbandoned(session) {
  await recordAbandoned(session, "the checkout expired");
}

// A payment intent carries no metadata of its own — no course, and
// often no email — so the checkout session it belongs to has to be
// found first. Two ways, because either can come back empty.
async function onPaymentFailed(intent) {
  let session = null;

  // The session id is on the intent itself on current API versions,
  // which is quicker and more reliable than searching for it.
  const reference = intent.payment_details?.order_reference;
  if (typeof reference === "string" && reference.startsWith("cs_")) {
    try {
      session = await stripe.checkout.sessions.retrieve(reference);
    } catch (err) {
      console.error("Could not read session", reference, err.message);
    }
  }

  // Older intents, and anything where that field is absent.
  if (!session) {
    try {
      const found = await stripe.checkout.sessions.list({
        payment_intent: intent.id,
        limit: 1,
      });
      session = found.data[0] || null;
    } catch (err) {
      console.error("Could not find a session for", intent.id, err.message);
    }
  }

  // A balance invoice failing is not somebody abandoning a checkout —
  // that has its own handling and its own retries.
  if (!session) {
    console.log("Payment failed with no checkout session — ignored", intent.id);
    return;
  }

  const why = intent.last_payment_error?.message ||
              intent.last_payment_error?.code ||
              "the payment was declined";

  // The session may have no email on it if they never got that far,
  // but the card they tried usually carries one.
  const fallbackEmail =
    intent.receipt_email ||
    intent.last_payment_error?.payment_method?.billing_details?.email ||
    null;

  await recordAbandoned(session, why, fallbackEmail);
}

async function recordAbandoned(session, reason, fallbackEmail) {
  const details = session.customer_details || {};
  const meta = session.metadata || {};

  const email = (details.email || session.customer_email || fallbackEmail || "").trim();

  // Say why rather than returning in silence. A record that never
  // appears is indistinguishable from a webhook that never fired,
  // and that difference cost an hour once already.
  if (!email) {
    console.log("Abandoned checkout has no email address — nothing to write to", session.id);
    return;
  }
  if (!meta.course_id) {
    console.log("Abandoned checkout carries no course — not one of ours", session.id);
    return;
  }

  const field = (key) =>
    session.custom_fields?.find((f) => f.key === key)?.text?.value?.trim();

  const [billingFirst, ...billingRest] = (details.name || "").trim().split(" ");
  const firstName = field("firstname") || billingFirst || null;
  const lastName = field("lastname") || billingRest.join(" ") || null;

  console.log("Recording abandoned checkout", {
    session: session.id, email, course: meta.course_slug || meta.course_id, reason,
  });

  // They may have tried twice and got through the second time, or
  // registered on another card. Either way there is nothing to chase.
  //
  // Only a registration that actually holds a place counts. A row
  // sitting at pending has not been paid for, so somebody in that
  // state whose card just failed is exactly who this is for — and a
  // cancelled or refunded one is not a place either.
  const { data: already } = await supabase
    .from("registrations")
    .select("id, payment_status")
    .eq("course_id", meta.course_id)
    .ilike("email", email)
    .eq("status", "active")
    .in("payment_status", ["paid_in_full", "deposit_paid"])
    .limit(1);

  if (already && already.length) {
    console.log("They already hold a place — nothing to chase", session.id);
    return;
  }

  // Keyed on the session, so a card retried three times leaves one
  // record rather than three.
  const { error } = await supabase.from("abandoned_checkouts").upsert({
    stripe_session_id: session.id,
    course_id: meta.course_id,
    email,
    first_name: firstName,
    last_name: lastName,
    abandoned_at: new Date().toISOString(),
  }, { onConflict: "stripe_session_id" });

  if (error) {
    console.error("Could not record the abandoned checkout", session.id, error.message);
    return;
  }

  console.log("Abandoned checkout recorded", {
    session: session.id, email, course: meta.course_slug, reason,
  });
}

// ---------------------------------------------------------------
// the participant's confirmation
// ---------------------------------------------------------------
// Exported so a free registration — a host claiming their place — gets
// exactly the same confirmation as anyone who paid. Two copies of this
// email would drift apart within a month.
// Returns "sent", "skipped" (no copy for this brand) or "failed", so
// the portal can say what happened. The checkout ignores the result.
export async function sendConfirmation({ courseId, email, firstName, option, balanceCents, online }) {
  if (!email) return "failed";

  try {
    const { data: course } = await supabase
      .from("courses")
      .select("brand, level, type, title, workshop_focus, venue_name, address, city, country, starts_at, ends_at, timezone")
      .eq("id", courseId)
      .single();

    if (!course) {
      console.warn("No course found for confirmation email", courseId);
      return "failed";
    }

    const brandKey = String(course.brand || "").toLowerCase();
    const isWorkshop = String(course.type || "").toLowerCase() === "workshop";

    // Deliberately narrow. See the note at the top of this file.
    if (!SENDS_CONFIRMATION.includes(brandKey)) {
      console.log("No confirmation copy for this course type — skipped", {
        courseId, brand: brandKey, type: course.type,
      });
      return "skipped";
    }

    const key = process.env.RESEND_API_KEY;
    if (!key) {
      console.warn("No RESEND_API_KEY — confirmation not sent to", email);
      return "failed";
    }

    const brand = BRAND[brandKey] || { name: "BirdBox Coaching", colour: "#2f7fd0" };
    const accent = brand.colour;
    const levelDigits = String(course.level == null ? "" : course.level).replace(/\D/g, "");
    const courseName = isWorkshop
      ? (course.title || brand.name + " Workshop")
      : brand.name + (levelDigits ? " — Level " + levelDigits : "");

    // Times as they read at the venue, whatever zone anybody is in.
    const clock = (iso) => {
      if (!iso) return null;
      try {
        return new Date(iso).toLocaleTimeString("en-GB", {
          hour: "2-digit", minute: "2-digit", hour12: false,
          timeZone: course.timezone || "UTC",
        });
      } catch { return null; }
    };

    const startClock = clock(course.starts_at);
    const endClock = clock(course.ends_at);

    // Arrive fifteen minutes before, which is what the pre-course
    // email says too.
    const arriveClock = course.starts_at
      ? clock(new Date(new Date(course.starts_at).getTime() - 15 * 60000).toISOString())
      : null;

    const workshopSchedule = startClock
      ? (endClock ? `${startClock} to ${endClock}.` : `Starts at ${startClock}.`) +
        (arriveClock ? ` Please arrive at ${arriveClock} so we can start on time.` : "")
      : "We will confirm the timings closer to the day.";
    const dates = formatDates(course);
    const place = [course.city, course.country].filter(Boolean).join(", ");
    const fullAddress = addressLine(course);

    // Manuals only exist for Level 1 today. For anything else the
    // section is left out rather than linking to an empty page.
    const manualUrl = (!isWorkshop && levelDigits === "1")
      ? SITE_URL + "/manuals/" + brandKey + "-l1/"
      : null;

    // Only mentioned when the enrolment actually worked. Promising
    // access that failed would be worse than saying nothing, and the
    // alert email means somebody is already fixing it.
    const onlineOk = online && online.status === "enrolled";
    const onlineName = onlineOk && online.label ? online.label : null;

    // Three hours in a gym needs rather less than two days in a
    // classroom: no ID, no manual, no lunch.
    const bring = isWorkshop
      ? [
          "Suitable clothes for training",
          "Water",
          "This confirmation email, printed or on your phone",
        ]
      : [
          "This confirmation email, printed or on your phone",
          "Government-issued photo ID",
          manualUrl ? "The course manual, with a pen — digital is fine, or print it if you prefer" : "A pen and something to write on",
          "Suitable clothes for training",
          "Snacks and fluids, and lunch if you are not going off site",
        ];
    if (!isWorkshop && brandKey === "tgc") bring.push("Gymnastics grips, if you use them");

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
      isWorkshop ? "WHAT WE ARE COVERING" : null,
      isWorkshop ? (course.workshop_focus || course.title || "") : null,
      isWorkshop ? "" : null,
      isWorkshop ? "ON THE DAY" : "COURSE SCHEDULE",
      isWorkshop ? workshopSchedule : "9:00am to 5:00pm each day, with a one-hour lunch break.",
      isWorkshop ? null : "Please arrive at 8:30am on day one to check in.",
      "",
      manualUrl ? "READING MATERIAL" : null,
      manualUrl ? manualUrl : null,
      manualUrl ? "Choose your language on that page." : null,
      manualUrl ? "" : null,
      onlineOk ? "YOUR FREE ONLINE COURSE" : null,
      onlineOk ? "Included with this " + (isWorkshop ? "workshop" : "seminar") + " at no extra cost" +
        (onlineName ? " (" + onlineName + ")" : "") + "." : null,
      onlineOk ? "You will receive two separate emails from BirdBox Academy: one to set your password, and one confirming your access." : null,
      onlineOk ? "In the academy it is listed as BirdBox Coaching Development Level " + levelDigits + " — this is the same course." : null,
      onlineOk ? LMS_URL : null,
      onlineOk ? "" : null,
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

  ${isWorkshop && (course.workshop_focus || course.title) ? `
  <h3 style="font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#666;margin:28px 0 8px;">What we are covering</h3>
  <p style="margin:0;">${esc(course.workshop_focus || course.title)}</p>
  ` : ""}

  <h3 style="font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#666;margin:28px 0 8px;">${isWorkshop ? "On the day" : "Course schedule"}</h3>
  ${isWorkshop
    ? `<p style="margin:0;">${esc(workshopSchedule)}</p>`
    : `<p style="margin:0;">9:00am to 5:00pm each day, with a one-hour lunch break.<br>
     Please arrive at <strong>8:30am on day one</strong> to check in.</p>`}

  ${manualUrl ? `
  <h3 style="font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#666;margin:28px 0 8px;">Reading material</h3>
  <p style="margin:0 0 12px;">Your course manual is available in several languages:</p>
  <p style="margin:0;">
    <a href="${manualUrl}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:5px;">Open your course manual</a>
  </p>
  <p style="color:#666;font-size:14px;margin:10px 0 0;">Choose your language on that page. Digital is fine, or print it if you prefer.</p>
  ` : ""}

  ${onlineOk ? `
  <h3 style="font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:#666;margin:28px 0 8px;">Your free online course</h3>
  <p style="margin:0 0 12px;">Included with this ${isWorkshop ? "workshop" : "seminar"} at no extra cost${onlineName ? ` (${esc(onlineName)})` : ""}. You will receive two more emails from BirdBox Academy — one to set your password, and one confirming your access.</p>
  <p style="margin:0;">
    <a href="${LMS_URL}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:5px;">Go to BirdBox Academy</a>
  </p>
  <p style="color:#666;font-size:14px;margin:10px 0 0;">In the academy it is listed as <strong>BirdBox Coaching Development Level ${esc(levelDigits)}</strong> — this is the same course.</p>
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
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("Could not send confirmation email", email, err);
    return "failed";
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
