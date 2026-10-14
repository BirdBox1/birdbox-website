// netlify/functions/payment-invoice.mjs
//
// "Invoice" on a participant's card in the portal: an invoice for a
// seminar they have ALREADY paid for by card on the website, for the
// person who only has a Stripe receipt and needs an invoice (to claim
// it back from an employer, for their books).
//
// It never takes or records money a second time. Either:
//
//   - Stripe already has an invoice for the payment (the checkout makes
//     one silently for most venues, the balance and monthly payments
//     each have one): that invoice is emailed to them as it is; or
//   - there is none (Switzerland, or a payment from before invoices
//     were switched on): one invoice is made to the same amounts and
//     VAT as the payment, and the ORIGINAL card payment is attached to
//     it (Stripe's attach_payment). It is paid by that payment — no
//     second charge, no "paid outside Stripe", so it cannot be counted
//     as income twice. One payment, one invoice: the registration
//     remembers it and Stripe refuses to attach a payment twice.
//
// The name, business, VAT number and address they want on it are set
// on their Stripe customer before the new invoice is issued. A paid
// invoice that already exists cannot be changed.
//
// Admin only.
//
//   POST { action: "lookup", registration_id }
//   POST { action: "send",   registration_id, invoice_id }   email an existing one
//   POST { action: "create", registration_id, name, business_name, vat_number,
//          line1, line2, city, postcode, country }           make one, then email it

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// attach_payment needs an API version from 2025-03-31 on. Only that
// one call uses it.
const ATTACH_API_VERSION = "2025-03-31.basil";

const KIND = "retro_invoice";
const OFFICE = "info@birdboxcoaching.com";

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);
  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return json({ error: "Not signed in" }, 401);
    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth || !auth.user) return json({ error: "Your session has expired — sign in again." }, 401);
    const { data: me } = await supabase
      .from("staff").select("id, full_name, role, active").eq("id", auth.user.id).maybeSingle();
    if (!me || !me.active) return json({ error: "Not a member of staff" }, 403);
    if (me.role !== "admin") return json({ error: "Only an admin can do this" }, 403);

    const body = await request.json();
    switch (body.action) {
      case "lookup": return await lookup(body);
      case "send":   return await sendExisting(body);
      case "create": return await create(body);
      default:       return json({ error: `Unknown action "${body.action}".` }, 400);
    }
  } catch (err) {
    console.error("payment-invoice failed:", err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

// ---------------------------------------------------------------
// what was paid, and which payments already have an invoice
// ---------------------------------------------------------------

async function loadReg(id) {
  const { data: reg, error } = await supabase
    .from("registrations")
    .select("id, first_name, last_name, email, source, stripe_session_id, stripe_customer_id, invoice_id, " +
            "retro_invoice_id, retro_invoice_number, courses!registrations_course_id_fkey(id, title, country, brand)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return reg;
}

async function lookup(b) {
  const reg = await loadReg(b.registration_id);
  if (!reg) return json({ error: "Registration not found." }, 404);
  const course = reg.courses || {};
  const base = {
    person: `${reg.first_name || ""} ${reg.last_name || ""}`.trim(),
    email: reg.email,
    course: course.title || "",
    venue_country: (course.country || "").toUpperCase(),
  };

  // Places bought on a group invoice: that invoice IS their invoice.
  if (reg.invoice_id) {
    const { data: inv } = await supabase.from("invoices")
      .select("business_name, payer_name, stripe_invoice_id, stripe_invoice_number, hosted_invoice_url, status")
      .eq("id", reg.invoice_id).maybeSingle();
    return json({ ...base, group: inv ? {
      to: inv.business_name || inv.payer_name, number: inv.stripe_invoice_number,
      url: inv.hosted_invoice_url, status: inv.status,
    } : {} });
  }

  if (!reg.stripe_session_id || !reg.stripe_session_id.startsWith("cs_")) {
    return json({ ...base, none: reg.source === "regfox"
      ? "They paid through RegFox, not on our website, so there is no Stripe payment to invoice. RegFox's own receipt is the record."
      : "There is no card payment on the website for this registration, so there is nothing in Stripe to invoice." });
  }

  const s = await stripe.checkout.sessions.retrieve(reg.stripe_session_id, { expand: ["invoice", "payment_intent"] });
  const details = s.customer_details || {};
  const a = details.address || {};
  const items = [];

  // The checkout payment itself.
  const pi = typeof s.payment_intent === "object" ? s.payment_intent : null;
  const first = {
    key: "checkout",
    label: "Payment on the website",
    amount: s.amount_total, currency: (s.currency || "").toUpperCase(),
    date: pi ? pi.created : s.created,
    invoice: null, can_create: false, note: "",
  };
  if (s.invoice && typeof s.invoice === "object") {
    first.invoice = invSummary(s.invoice);
  } else if (reg.retro_invoice_id) {
    first.invoice = invSummary(await stripe.invoices.retrieve(reg.retro_invoice_id));
  } else if (!pi || pi.status !== "succeeded") {
    first.note = "This payment did not go through, so there is nothing to invoice.";
  } else if (pi.amount_received <= 0) {
    first.note = "Nothing was paid on this checkout.";
  } else {
    first.can_create = true;
  }
  items.push(first);

  // Balance and monthly payments: each was its own Stripe invoice.
  const { data: pays } = await supabase.from("payments")
    .select("sequence, amount_cents, status, stripe_invoice_id, charged_at")
    .eq("registration_id", reg.id).not("stripe_invoice_id", "is", null).order("sequence");
  for (const p of pays || []) {
    if (p.status !== "paid") continue;
    try {
      const inv = await stripe.invoices.retrieve(p.stripe_invoice_id);
      items.push({ key: p.stripe_invoice_id, label: `Payment ${p.sequence}`, amount: inv.amount_paid,
        currency: (inv.currency || "").toUpperCase(), date: inv.status_transitions?.paid_at || inv.created,
        invoice: invSummary(inv), can_create: false, note: "" });
    } catch (err) {
      console.warn("Could not read invoice", p.stripe_invoice_id, err.message);
    }
  }

  return json({
    ...base,
    bill: {
      name: details.name || base.person,
      business_name: "",
      vat_number: (details.tax_ids && details.tax_ids[0] && details.tax_ids[0].value) || "",
      line1: a.line1 || "", line2: a.line2 || "", city: a.city || "",
      postcode: a.postal_code || "", country: (a.country || "").toUpperCase(),
    },
    items,
  });
}

function invSummary(inv) {
  return {
    id: inv.id, number: inv.number, status: inv.status,
    to: inv.customer_name || "", pdf: inv.invoice_pdf || null, url: inv.hosted_invoice_url || null,
    total: inv.total, currency: (inv.currency || "").toUpperCase(),
  };
}

// ---------------------------------------------------------------
// email an invoice that exists
// ---------------------------------------------------------------

async function sendExisting(b) {
  const reg = await loadReg(b.registration_id);
  if (!reg) return json({ error: "Registration not found." }, 404);
  const ok = await belongsTo(reg, b.invoice_id);
  if (!ok) return json({ error: "That invoice is not for this registration." }, 400);
  const inv = await stripe.invoices.retrieve(b.invoice_id);
  if (inv.status !== "paid") return json({ error: "That invoice is not paid." }, 400);
  const sent = await emailInvoice(reg, inv);
  if (!sent.ok) return json({ error: "The email did not send: " + sent.error }, 502);
  return json({ sent: true, number: inv.number, to: reg.email });
}

// Only invoices that really are this person's payment can be sent
// from their card.
async function belongsTo(reg, invoiceId) {
  if (!invoiceId) return false;
  if (reg.retro_invoice_id === invoiceId) return true;
  if (reg.stripe_session_id) {
    const s = await stripe.checkout.sessions.retrieve(reg.stripe_session_id);
    if (s.invoice === invoiceId) return true;
  }
  const { data } = await supabase.from("payments").select("id")
    .eq("registration_id", reg.id).eq("stripe_invoice_id", invoiceId).limit(1);
  return !!(data && data.length);
}

// ---------------------------------------------------------------
// make the invoice for a payment that has none
// ---------------------------------------------------------------

async function create(b) {
  const reg = await loadReg(b.registration_id);
  if (!reg) return json({ error: "Registration not found." }, 404);
  if (reg.retro_invoice_id) return json({ error: `This payment already has invoice ${reg.retro_invoice_number || ""}. Send that one.` }, 409);
  if (!reg.stripe_session_id) return json({ error: "There is no website card payment to invoice." }, 400);

  const s = await stripe.checkout.sessions.retrieve(reg.stripe_session_id, {
    expand: ["line_items.data.taxes", "payment_intent.latest_charge"],
  });
  if (s.invoice) return json({ error: "Stripe already has an invoice for this payment. Send that one." }, 409);
  const pi = s.payment_intent;
  if (!pi || typeof pi !== "object" || pi.status !== "succeeded") return json({ error: "This payment did not go through." }, 400);
  const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  if (charge && charge.amount_refunded > 0) {
    return json({ error: "This payment has been refunded (in full or in part), so an invoice for it would be wrong. Ask your accountant." }, 400);
  }

  // Stripe's own record too, in case the registration was not updated.
  const found = await stripe.invoices.search({ query: `metadata['payment_intent']:'${pi.id}'` });
  if (found.data.some((i) => i.status !== "void")) {
    return json({ error: "An invoice for this payment already exists in Stripe. Reopen this window to send it." }, 409);
  }

  const customerId = (typeof pi.customer === "string" ? pi.customer : pi.customer?.id) ||
                     (typeof s.customer === "string" ? s.customer : null);
  if (!customerId) return json({ error: "This payment has no Stripe customer, so Stripe cannot put it on an invoice." }, 400);

  // Who it is made out to, on their Stripe customer.
  const clean = (v, max = 120) => String(v == null ? "" : v).trim().slice(0, max);
  const name = clean(b.name);
  const business = clean(b.business_name);
  const country = clean(b.country, 2).toUpperCase();
  if (!name) return json({ error: "Enter the name for the invoice." }, 400);
  if (country && !/^[A-Z]{2}$/.test(country)) return json({ error: "Choose the country." }, 400);
  const person = `${reg.first_name || ""} ${reg.last_name || ""}`.trim();

  await stripe.customers.update(customerId, {
    name: business || name,
    address: country ? {
      line1: clean(b.line1) || "", line2: clean(b.line2) || "", city: clean(b.city, 80) || "",
      postal_code: clean(b.postcode, 20) || "", country,
    } : undefined,
  });
  const vat = clean(b.vat_number, 40);
  let vatOnCustomer = false;
  if (vat) {
    const t = taxIdFor(vat, country);
    if (t) {
      try {
        const existing = await stripe.customers.listTaxIds(customerId, { limit: 20 });
        if (!existing.data.some((x) => x.value === t.value)) {
          await stripe.customers.createTaxId(customerId, { type: t.type, value: t.value });
        }
        vatOnCustomer = true;
      } catch (err) {
        console.warn("Stripe did not take the VAT number", vat, err.message);
      }
    }
  }

  const fields = [];
  if (business) fields.push({ name: "Attention", value: name.slice(0, 30) });
  if (person && person.toLowerCase() !== (business || name).toLowerCase()) fields.push({ name: "Participant", value: person.slice(0, 30) });
  if (vat && !vatOnCustomer) fields.push({ name: "Customer VAT no.", value: vat.slice(0, 30) });
  if (charge && charge.receipt_number) fields.push({ name: "Card receipt", value: String(charge.receipt_number).slice(0, 30) });

  const paidOn = new Date(pi.created * 1000).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });
  const courseTitle = reg.courses?.title || "Seminar";

  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: "send_invoice",
    days_until_due: 1,
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
    currency: s.currency,
    description: `${courseTitle}. Paid in full by card on ${paidOn}.`,
    custom_fields: fields.length ? fields.slice(0, 4) : undefined,
    metadata: { kind: KIND, payment_intent: pi.id, registration_ref: reg.id, checkout_session: s.id },
  });

  // The same lines, amounts and VAT rates as the payment.
  try {
    for (const li of s.line_items?.data || []) {
      const net = (li.amount_subtotal || 0) - (li.amount_discount || 0);
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        currency: s.currency,
        amount: net,
        description: li.description || courseTitle,
        tax_rates: (li.taxes || []).map((t) => t.rate?.id).filter(Boolean),
      });
    }
    const final = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false });
    if (final.total !== pi.amount_received) {
      throw new Error(`the invoice came to ${(final.total / 100).toFixed(2)} but the payment was ${(pi.amount_received / 100).toFixed(2)}`);
    }

    // Paid by the card payment they already made.
    await stripe.rawRequest("POST", `/v1/invoices/${invoice.id}/attach_payment`,
      { payment_intent: pi.id }, { apiVersion: ATTACH_API_VERSION });
  } catch (err) {
    console.error("Retro invoice failed", invoice.id, err);
    try { await stripe.invoices.del(invoice.id); } catch (_) {
      try { await stripe.invoices.voidInvoice(invoice.id); } catch (_) {}
    }
    return json({ error: "Stripe would not make the invoice: " + (err.message || "unknown error") + ". Nothing was charged or sent." }, 502);
  }

  const paid = await stripe.invoices.retrieve(invoice.id);
  await supabase.from("registrations").update({
    retro_invoice_id: paid.id,
    retro_invoice_number: paid.number || null,
  }).eq("id", reg.id);

  if (paid.status !== "paid") {
    return json({ error: `Invoice ${paid.number} was made but Stripe has not marked it paid yet. Check it in Stripe before sending.` }, 502);
  }

  const sent = await emailInvoice(reg, paid);
  if (!sent.ok) return json({ error: `Invoice ${paid.number} was made but the email did not send: ${sent.error}. Try Send again.` }, 502);
  return json({ sent: true, created: true, number: paid.number, to: reg.email });
}

// ---------------------------------------------------------------
// the email, with the PDF attached
// ---------------------------------------------------------------

async function emailInvoice(reg, inv) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "no Resend key is configured" };

  let attachment = null;
  if (inv.invoice_pdf) {
    try {
      const res = await fetch(inv.invoice_pdf);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        attachment = { filename: `Invoice ${inv.number || inv.id}.pdf`, content: buf.toString("base64") };
      }
    } catch (err) {
      console.warn("Could not fetch the invoice PDF", inv.id, err.message);
    }
  }

  const lines = [
    `Hi ${reg.first_name || "there"},`,
    "",
    `Here is your invoice${inv.number ? " " + inv.number : ""} for ${reg.courses?.title || "your seminar"}. ` +
      "It is marked as paid — it covers the card payment you have already made, so there is nothing more to pay.",
    "",
    attachment ? "The invoice is attached as a PDF. You can also view it online:" : "You can view and download it here:",
    inv.hosted_invoice_url || inv.invoice_pdf || "",
    "",
    "Any questions, just reply to this email.",
    "",
    "BirdBox Coaching",
  ];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox Coaching <${process.env.CONFIRM_FROM || OFFICE}>`,
        to: [reg.email],
        cc: [OFFICE],
        reply_to: OFFICE,
        subject: `Your invoice${inv.number ? " " + inv.number : ""} — ${reg.courses?.title || "BirdBox Coaching"}`,
        text: lines.join("\n"),
        ...(attachment ? { attachments: [attachment] } : {}),
      }),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: (await res.text()).slice(0, 200) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

const EU_VAT_PREFIXES = new Set(["AT","BE","BG","CY","CZ","DE","DK","EE","EL","ES","FI","FR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","XI"]);

function taxIdFor(raw, country) {
  const v = String(raw || "").toUpperCase().replace(/[\s.\-]/g, "");
  if (!v) return null;
  const has = /^[A-Z]{2}/.test(v);
  let prefix = has ? v.slice(0, 2) : String(country || "").toUpperCase();
  if (prefix === "GR") prefix = "EL";
  const value = prefix + (has ? v.slice(2) : v);
  if (EU_VAT_PREFIXES.has(prefix)) return { type: "eu_vat", value };
  if (prefix === "GB") return { type: "gb_vat", value };
  if (prefix === "CH") return { type: "ch_vat", value: v.startsWith("CHE") ? v : value };
  return null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
