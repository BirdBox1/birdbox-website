// netlify/functions/online-invoice.mjs
//
// Selling the online course by invoice, for people who could not pay
// on the LearnWorlds page. Replaces: make a Stripe invoice by hand,
// make a LearnWorlds coupon code, send both, check they paid, hope
// they manage to use the code.
//
// Now: the portal sends a Stripe invoice. When it is paid, the
// webhook calls onOnlineInvoicePaid() below, which creates their
// academy account (or finds the one they have), enrols them in the
// course, and emails them. A new account gets LearnWorlds' own
// set-your-password email, so they log in and the course is already
// there. No code to type anywhere.
//
// Admin only. Actions:
//
//   options          the courses and VAT countries for the form
//   list             recent online invoices and where each one is
//   create_and_send  build the Stripe invoice and email it
//   resend           email an unpaid invoice again
//   mark_paid        paid by bank transfer: Stripe marks it paid,
//                    which fires the webhook, which enrols them
//   retry            try the enrolment again after a failure
//   void             cancel an unpaid invoice
//
// The course list is read LIVE from LearnWorlds every time the form
// opens, so a new course or a new language appears in the dropdown on
// its own — nothing to add anywhere. Drafts are left out.
//
// VAT: the online course is an electronically supplied service, so it
// is charged at the rate of the CUSTOMER's country (not a seminar's),
// from the same vat_rates table the checkout uses. No rate for the
// country means no VAT. An EU business with a VAT number can be
// invoiced on reverse charge.

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { enrolById, listCourses, isOnSite, LEARN_URL, learnStartLink } from "./learnworlds.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const DAYS_TO_PAY = 7;
const KIND = "online_course_invoice";
const ALERT_EMAIL = "info@birdboxcoaching.com";
const REPLY_TO = "info@birdboxcoaching.com";
const LMS_URL = "https://www.birdboxacademy.com";

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth || !auth.user) return json({ error: "Your session has expired — sign in again." }, 401);

    const { data: me } = await supabase
      .from("staff")
      .select("id, full_name, role, active")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (!me || !me.active) return json({ error: "Not a member of staff" }, 403);
    if (me.role !== "admin") return json({ error: "Only an admin can do this" }, 403);

    const body = await request.json();

    switch (body.action) {
      case "options":         return await options();
      case "list":            return await list();
      case "create_and_send": return await createAndSend(body, me);
      case "resend":          return await resend(body);
      case "mark_paid":       return await markPaid(body);
      case "retry":           return await retry(body);
      case "void":            return await voidInvoice(body);
      default:
        return json({ error: `Unknown action "${body.action}".` }, 400);
    }
  } catch (err) {
    console.error("online-invoice failed:", err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

// ---------------------------------------------------------------
// what the form needs
// ---------------------------------------------------------------

async function options() {
  let courses;
  try {
    courses = (await listCourses()).map((c) => ({
      product_id: c.id,
      label: c.title,
      access: c.access,
    }));
  } catch (err) {
    return json({ error: err.message }, 502);
  }

  const { data: rates } = await supabase
    .from("vat_rates")
    .select("code, rate");

  const vat = (rates || [])
    .map((r) => ({ code: String(r.code || "").toUpperCase(), rate: pct(r.rate) }))
    .filter((r) => r.code)
    .sort((a, b) => a.code.localeCompare(b.code));

  return json({ courses, vat });
}

async function list() {
  const { data, error } = await supabase
    .from("online_invoices")
    .select("id, created_at, first_name, last_name, email, product_label, total_cents, currency, status, due_date, paid_at, stripe_invoice_number, hosted_invoice_url, learnworlds_status, learnworlds_error, user_was_created")
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return json({ error: error.message }, 500);
  return json({ invoices: data || [] });
}

// ---------------------------------------------------------------
// create the invoice and email it
// ---------------------------------------------------------------

async function createAndSend(b, me) {
  const first = clean(b.first_name);
  const last = clean(b.last_name);
  const email = clean(b.email);
  const country = (clean(b.country) || "").toUpperCase();
  const business = clean(b.business_name);

  if (!first || !last) return json({ error: "First and last name are both needed." }, 400);
  if (!email || !email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    return json({ error: "A valid email is needed." }, 400);
  }
  if (!/^[A-Z]{2}$/.test(country)) return json({ error: "Choose the customer's country." }, 400);

  const priceCents = Math.round(Number(b.price) * 100);
  if (!Number.isFinite(priceCents) || priceCents <= 0) return json({ error: "The price must be more than zero." }, 400);
  const currency = (clean(b.currency) || "EUR").toUpperCase();

  // The course, checked against the live academy list rather than
  // trusted from the browser, so an invoice can never name a course
  // that cannot then be enrolled.
  const productId = clean(b.product_id);
  if (!productId) return json({ error: "Choose an online course." }, 400);
  let product;
  try {
    product = (await listCourses()).find((c) => c.id === productId);
  } catch (err) {
    return json({ error: err.message }, 502);
  }
  if (!product) return json({ error: "That course is no longer in the academy. Reopen the form and choose again." }, 400);
  const label = product.title;

  // VAT: "AUTO" (or blank) = the customer's country, "NONE" = no VAT,
  // "REVERSE" = reverse charge for an EU business.
  const vatChoice = (clean(b.vat) || "AUTO").toUpperCase();
  const reverse = vatChoice === "REVERSE";
  const taxId = taxIdFor(b.vat_number, country);
  if (reverse) {
    const problem = reverseChargeProblem(taxId);
    if (problem) return json({ error: problem }, 400);
  }

  let vatCountry = null;
  let vatRate = 0;
  let taxRateId = null;
  if (vatChoice === "AUTO") {
    const { data: vr } = await supabase
      .from("vat_rates")
      .select("rate, stripe_tax_rate_id")
      .eq("code", country)
      .maybeSingle();
    if (vr && pct(vr.rate) > 0) {
      vatCountry = country;
      vatRate = pct(vr.rate);
      taxRateId = vr.stripe_tax_rate_id || null;
      if (!taxRateId || !taxRateId.startsWith("txr_")) {
        return json({ error: `The VAT rate for ${country} has no Stripe tax rate set up.` }, 400);
      }
    }
  }

  const vat = Math.round(priceCents * vatRate / 100);
  const total = priceCents + vat;

  const { data: row, error: insErr } = await supabase
    .from("online_invoices")
    .insert({
      created_by: me.id,
      first_name: first,
      last_name: last,
      email,
      country,
      business_name: business,
      vat_number: taxId ? taxId.value : clean(b.vat_number),
      product_id: product.id,
      product_label: label,
      price_cents: priceCents,
      currency,
      vat_country: vatCountry,
      vat_rate: vatRate,
      reverse_charge: reverse,
      vat_cents: vat,
      total_cents: total,
      status: "draft",
    })
    .select("id")
    .single();
  if (insErr) return json({ error: "Could not save the invoice: " + insErr.message }, 500);

  let stripeInvoiceId = null;
  try {
    const customer = await stripe.customers.create({
      name: business || `${first} ${last}`,
      email,
      address: { country },
      tax_exempt: reverse ? "reverse" : "none",
      metadata: { online_invoice_id: row.id },
    });

    const attached = await attachTaxId(customer.id, taxId);
    if (reverse && !attached) {
      throw new Error(`Stripe did not accept the VAT number ${taxId.value}. Check it and try again.`);
    }

    const customFields = [];
    if (business) customFields.push({ name: "Attention", value: `${first} ${last}`.slice(0, 30) });

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: DAYS_TO_PAY,
      auto_advance: false,
      currency: currency.toLowerCase(),
      description: (await isOnSite(product.id))
        ? `Online course: ${label}. As soon as this is paid the course is added to your account on ` +
          `birdboxcoaching.com/learn/ — we will email you how to log in.`
        : `Online course: ${label}. As soon as this is paid your account is set up and the ` +
          `course is added to it — watch for an email from BirdBox Academy to set your password.`,
      default_tax_rates: taxRateId ? [taxRateId] : [],
      custom_fields: customFields.length ? customFields : undefined,
      metadata: {
        kind: KIND,
        online_invoice_id: row.id,
      },
    });
    stripeInvoiceId = invoice.id;

    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      amount: priceCents,
      currency: currency.toLowerCase(),
      description: `Online course — ${label}`,
    });

    const finalised = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(invoice.id);

    const stripeVat = taxTotal(finalised);
    const stripeTotal = finalised.total ?? total;

    await supabase.from("online_invoices").update({
      stripe_customer_id: customer.id,
      stripe_invoice_id: invoice.id,
      stripe_invoice_number: finalised.number || null,
      hosted_invoice_url: finalised.hosted_invoice_url || null,
      due_date: finalised.due_date ? new Date(finalised.due_date * 1000).toISOString().slice(0, 10) : null,
      vat_cents: stripeVat ?? vat,
      total_cents: stripeTotal,
      status: "sent",
      last_error: null,
    }).eq("id", row.id);

    return json({ sent: true, number: finalised.number || null, total_cents: stripeTotal, currency });
  } catch (err) {
    console.error("Online invoice failed", err);
    if (stripeInvoiceId) {
      try { await stripe.invoices.del(stripeInvoiceId); } catch (_) {
        try { await stripe.invoices.voidInvoice(stripeInvoiceId); } catch (_) {}
      }
    }
    await supabase.from("online_invoices").delete().eq("id", row.id);
    return json({ error: "Stripe did not accept the invoice: " + (err.message || "unknown error") }, 502);
  }
}

// ---------------------------------------------------------------
// the other buttons
// ---------------------------------------------------------------

async function getRow(id) {
  const { data } = await supabase.from("online_invoices").select("*").eq("id", id).maybeSingle();
  return data;
}

async function resend(b) {
  const row = await getRow(b.id);
  if (!row) return json({ error: "Invoice not found." }, 404);
  if (row.status !== "sent" || !row.stripe_invoice_id) return json({ error: "Only an unpaid invoice can be sent again." }, 400);
  await stripe.invoices.sendInvoice(row.stripe_invoice_id);
  return json({ resent: true });
}

// Paid by bank transfer or cash. Stripe records it as paid outside
// Stripe and fires invoice.paid, so the enrolment happens exactly the
// same way as a card payment.
async function markPaid(b) {
  const row = await getRow(b.id);
  if (!row) return json({ error: "Invoice not found." }, 404);
  if (row.status !== "sent" || !row.stripe_invoice_id) return json({ error: "Only an unpaid invoice can be marked paid." }, 400);
  await stripe.invoices.pay(row.stripe_invoice_id, { paid_out_of_band: true });
  return json({ marked: true });
}

async function retry(b) {
  const row = await getRow(b.id);
  if (!row) return json({ error: "Invoice not found." }, 404);
  if (row.status !== "paid") return json({ error: "The invoice has not been paid yet." }, 400);
  if (row.learnworlds_status === "enrolled") return json({ error: "They are already enrolled." }, 400);
  const result = await enrolAndEmail(row, row.stripe_invoice_number);
  if (result.status !== "enrolled") return json({ error: result.error || "Enrolment failed again." }, 502);
  return json({ enrolled: true, userWasCreated: !!result.userWasCreated });
}

async function voidInvoice(b) {
  const row = await getRow(b.id);
  if (!row) return json({ error: "Invoice not found." }, 404);
  if (row.status === "paid") return json({ error: "A paid invoice cannot be voided. Refund it in Stripe instead." }, 400);
  if (row.stripe_invoice_id) {
    try { await stripe.invoices.voidInvoice(row.stripe_invoice_id); }
    catch (err) { return json({ error: "Stripe would not void it: " + err.message }, 502); }
  }
  await supabase.from("online_invoices").update({ status: "void" }).eq("id", row.id);
  return json({ voided: true });
}

// ---------------------------------------------------------------
// called by stripe-webhook.mjs
// ---------------------------------------------------------------

export function isOnlineInvoice(invoice) {
  return !!(invoice && invoice.metadata && invoice.metadata.kind === KIND);
}

// invoice.paid. Safe to run twice: Stripe can deliver the same event
// again, and someone already enrolled is left alone.
export async function onOnlineInvoicePaid(invoice) {
  const id = invoice.metadata.online_invoice_id;

  const { data: row, error } = await supabase
    .from("online_invoices")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      total_cents: invoice.amount_paid ?? invoice.total ?? null,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throw new Error("online_invoices: " + error.message);
  if (!row) {
    console.warn("Paid online invoice has no row", { id, invoice: invoice.id });
    return;
  }
  if (row.learnworlds_status === "enrolled") return;

  await enrolAndEmail(row, invoice.number || invoice.id);
}

// invoice.overdue / marked_uncollectible.
export async function onOnlineInvoiceOverdue(invoice) {
  const row = await getRow(invoice.metadata.online_invoice_id);
  if (!row || row.status === "paid" || row.status === "void") return;
  await alert(
    "Online course invoice overdue",
    `Invoice ${invoice.number || invoice.id} to ${row.first_name} ${row.last_name} (${row.email}) ` +
    `for ${row.product_label} is past its due date and unpaid: ` +
    `${((invoice.amount_due || 0) / 100).toFixed(2)} ${(invoice.currency || "").toUpperCase()}.`
  );
}

async function enrolAndEmail(row, invoiceNumber) {
  const result = await enrolById({
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    productId: row.product_id,
    productType: "course",
    justification: `Paid by invoice ${invoiceNumber || ""}`.trim(),
  });

  await supabase.from("online_invoices").update({
    learnworlds_status: result.status,
    learnworlds_user_id: result.userId || null,
    learnworlds_enrolled_at: result.status === "enrolled" ? new Date().toISOString() : null,
    learnworlds_error: result.error || null,
    user_was_created: result.status === "enrolled" ? !!result.userWasCreated : null,
  }).eq("id", row.id);

  if (result.status !== "enrolled") {
    await alert(
      "Online course PAID but NOT enrolled",
      `${row.first_name} ${row.last_name} (${row.email}) paid invoice ${invoiceNumber} for ` +
      `${row.product_label}, but the academy enrolment failed:\n\n${result.error}\n\n` +
      `Open the portal → Online course invoice and press Retry.`
    );
    return result;
  }

  const welcomed = await sendWelcome(row, !!result.userWasCreated, !!result.onSite);
  if (welcomed) {
    await supabase.from("online_invoices").update({ welcome_sent_at: new Date().toISOString() }).eq("id", row.id);
  }

  await alert(
    "Online course invoice paid — enrolled",
    `${row.first_name} ${row.last_name} (${row.email}) paid invoice ${invoiceNumber} and is now enrolled in ` +
    `${row.product_label}. ` +
    (result.onSite
      ? "The course is on birdboxcoaching.com/learn/ — they have been emailed how to log in."
      : result.userWasCreated
        ? "A new academy account was created and they have been sent the set-your-password email."
        : "They already had an academy account; the course has been added to it.") +
    "\n\nNothing to do."
  );
  return result;
}

// Our own short note, so they know what to look for. The academy's
// emails can land in spam; this one comes from an address they have
// just been invoiced from.
async function sendWelcome(row, isNewAccount, onSite) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const lines = [
    `Hi ${row.first_name},`,
    "",
    `Thank you — your payment has come through and ${row.product_label} is now in your account.`,
    "",
  ];
  if (onSite) {
    lines.push(
      "Your course is on our website. Tap this link to open it — the first time, it sets up your account and logs you straight in:",
      "",
      learnStartLink(row.email),
      "",
      "The course is waiting under My courses. Once you are in, set a password so you can log in any time.",
      `Later, log in at ${LEARN_URL} with this email address: ${row.email}`,
      "",
      "No code is needed. Any problems getting in, just reply to this email.",
      "",
      "BirdBox Coaching",
    );
  } else if (isNewAccount) {
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
    `Log in with this email address: ${row.email}`,
    "",
    "No code is needed. Any problems getting in, just reply to this email.",
    "",
    "BirdBox Coaching",
  );

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.CONFIRM_FROM || process.env.ALERT_FROM || REPLY_TO,
        to: [row.email],
        cc: [ALERT_EMAIL],
        reply_to: REPLY_TO,
        subject: `You're in — ${row.product_label}`,
        text: lines.join("\n"),
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("Could not send online course welcome", err);
    return false;
  }
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

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

// vat_rates stores either 0.21 or 21.
function pct(raw) {
  const n = Number(raw) || 0;
  return n <= 1 ? n * 100 : n;
}

function taxTotal(inv) {
  if (Array.isArray(inv.total_taxes)) return inv.total_taxes.reduce((s, t) => s + (t.amount || 0), 0);
  if (Array.isArray(inv.total_tax_amounts)) return inv.total_tax_amounts.reduce((s, t) => s + (t.amount || 0), 0);
  if (typeof inv.tax === "number") return inv.tax;
  return null;
}

const EU_VAT_PREFIXES = new Set(["AT","BE","BG","CY","CZ","DE","DK","EE","EL","ES","FI","FR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","XI"]);

function taxIdFor(raw, addressCountry) {
  let v = String(raw || "").toUpperCase().replace(/[\s.\-]/g, "");
  if (!v) return null;
  let prefix = /^[A-Z]{2}/.test(v) ? v.slice(0, 2) : String(addressCountry || "").toUpperCase();
  if (prefix === "GR") prefix = "EL";
  const body = /^[A-Z]{2}/.test(v) ? v.slice(2) : v;
  const value = prefix + body;
  if (EU_VAT_PREFIXES.has(prefix)) return { type: "eu_vat", value, eu: true, prefix };
  if (prefix === "GB") return { type: "gb_vat", value, eu: false, prefix };
  return { type: null, value: raw, eu: false, prefix };
}

function reverseChargeProblem(taxId) {
  if (!taxId) return "Reverse charge needs the customer's VAT number.";
  if (!taxId.eu) return "Reverse charge is only for VAT-registered businesses in the EU.";
  if (taxId.prefix === "IE") return "An Irish business is charged Irish VAT, not reverse charge.";
  return null;
}

async function attachTaxId(customerId, taxId) {
  if (!taxId || !taxId.type) return false;
  try {
    await stripe.customers.createTaxId(customerId, { type: taxId.type, value: taxId.value });
    return true;
  } catch (err) {
    console.warn("Stripe rejected the VAT number", taxId.value, err.message);
    return false;
  }
}

function clean(v) {
  const s = String(v == null ? "" : v).trim();
  return s || null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
