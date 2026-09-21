// netlify/functions/invoice-admin.mjs
//
// Invoices for places bought in bulk — a gym or company paying for
// several people on one course. Three actions, all admin only:
//
//   create_and_send  build a Stripe invoice from the portal form and
//                    email it to the payer (due in 7 days)
//   add_participant  put a named person onto a PAID invoice: they are
//                    registered as paid, with their share of the money,
//                    and get the same confirmation email as the website
//   void             cancel an invoice that has not been paid
//
// VAT is always the rate for the country the seminar runs in (the
// admission-to-events rule), taken from vat_rates — the same table the
// website checkout uses, so an invoice can never disagree with it.
//
// Marking an invoice paid is NOT done here. Stripe tells the webhook
// (invoice.paid) and stripe-webhook.mjs updates the invoices row.

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { sendConfirmation } from "./stripe-webhook.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const DAYS_TO_PAY = 7;

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth || !auth.user) return json({ error: "Not signed in" }, 401);

    const { data: me } = await supabase
      .from("staff")
      .select("id, full_name, role, active")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (!me || !me.active) return json({ error: "Not a member of staff" }, 403);
    if (me.role !== "admin") return json({ error: "Only an admin can do this" }, 403);

    const body = await request.json();

    switch (body.action) {
      case "create_and_send": return await createAndSend(body, me);
      case "add_participant": return await addParticipant(body, me);
      case "void":            return await voidInvoice(body);
      default:
        return json({ error: `Unknown action "${body.action}".` }, 400);
    }
  } catch (err) {
    console.error("invoice-admin failed:", err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

// ---------------------------------------------------------------
// create the invoice and email it
// ---------------------------------------------------------------

async function createAndSend(b, me) {
  const courseId = b.course_id;
  if (!courseId) return json({ error: "No course given." }, 400);

  const payerName = clean(b.payer_name);
  const payerEmail = clean(b.payer_email);
  const business = clean(b.business_name);
  if (!payerName) return json({ error: "A name is needed." }, 400);
  if (!payerEmail || !payerEmail.includes("@")) return json({ error: "A valid email is needed." }, 400);

  const places = parseInt(b.places, 10);
  if (!Number.isFinite(places) || places < 1) return json({ error: "Number of places must be at least 1." }, 400);

  const unitCents = Math.round(Number(b.unit_price) * 100);
  if (!Number.isFinite(unitCents) || unitCents <= 0) return json({ error: "Price per place must be more than zero." }, 400);

  const { data: course, error: cErr } = await supabase
    .from("courses")
    .select("id, title, country, currency, starts_at")
    .eq("id", courseId)
    .single();
  if (cErr || !course) return json({ error: "Course not found." }, 404);

  const currency = String(course.currency || "EUR").toUpperCase();

  // VAT country defaults to where the seminar runs.
  const vatCountry = String(b.vat_country || course.country || "").toUpperCase();
  let vatRate = 0;
  let taxRateId = null;
  if (vatCountry) {
    const { data: vr } = await supabase
      .from("vat_rates")
      .select("rate, stripe_tax_rate_id")
      .eq("code", vatCountry)
      .maybeSingle();
    if (vr && Number(vr.rate) > 0) {
      const raw = Number(vr.rate);
      vatRate = raw <= 1 ? raw * 100 : raw;
      taxRateId = vr.stripe_tax_rate_id || null;
      if (!taxRateId || !taxRateId.startsWith("txr_")) {
        return json({ error: `The VAT rate for ${vatCountry} has no Stripe tax rate set up.` }, 400);
      }
    }
  }

  // Discount code — checked against the same table the website uses.
  let discountCode = null;
  let discountPercent = 0;
  const rawCode = clean(b.discount_code);
  if (rawCode) {
    const found = await findCode(rawCode, courseId);
    if (found.error) return json({ error: found.error }, 400);
    discountCode = found.code;
    discountPercent = found.percent;
  }

  // Our own figures, used for the record and the preview. Stripe works
  // out the invoice itself; the two use the same order — discount off
  // the net price, then VAT on what is left.
  const subtotal = unitCents * places;
  const discount = Math.round(subtotal * discountPercent / 100);
  const taxable = subtotal - discount;
  const vat = Math.round(taxable * vatRate / 100);
  const total = taxable + vat;

  const { data: row, error: insErr } = await supabase
    .from("invoices")
    .insert({
      course_id: courseId,
      payer_name: payerName,
      business_name: business,
      payer_email: payerEmail,
      address_line1: clean(b.address_line1),
      address_line2: clean(b.address_line2),
      city: clean(b.city),
      postcode: clean(b.postcode),
      address_country: clean(b.address_country),
      vat_number: clean(b.vat_number),
      vat_country: vatCountry || null,
      vat_rate: vatRate,
      places,
      unit_price_cents: unitCents,
      currency,
      discount_code: discountCode,
      discount_percent: discountPercent,
      subtotal_cents: taxable,
      vat_cents: vat,
      total_cents: total,
      status: "draft",
      created_by: me.id,
    })
    .select("id")
    .single();
  if (insErr) return json({ error: "Could not save the invoice: " + insErr.message }, 500);

  let stripeInvoiceId = null;
  try {
    const address = {
      line1: clean(b.address_line1) || undefined,
      line2: clean(b.address_line2) || undefined,
      city: clean(b.city) || undefined,
      postal_code: clean(b.postcode) || undefined,
      country: clean(b.address_country) || undefined,
    };
    const hasAddress = Object.values(address).some(Boolean);

    const customer = await stripe.customers.create({
      name: business || payerName,
      email: payerEmail,
      address: hasAddress ? address : undefined,
      metadata: { portal_invoice_id: row.id },
    });

    // Shown on the invoice itself. Stripe caps each value at 30
    // characters.
    const customFields = [];
    if (business) customFields.push({ name: "Attention", value: payerName.slice(0, 30) });
    if (clean(b.vat_number)) customFields.push({ name: "Customer VAT no.", value: clean(b.vat_number).slice(0, 30) });

    let discounts;
    if (discountPercent > 0) {
      const coupon = await stripe.coupons.create({
        percent_off: discountPercent,
        duration: "once",
        name: discountCode,
      });
      discounts = [{ coupon: coupon.id }];
    }

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: DAYS_TO_PAY,
      auto_advance: false,
      currency: currency.toLowerCase(),
      description: `${places} × ${course.title}`,
      default_tax_rates: taxRateId ? [taxRateId] : [],
      custom_fields: customFields.length ? customFields : undefined,
      discounts,
      metadata: {
        portal_invoice_id: row.id,
        course_id: courseId,
        kind: "group_invoice",
        places: String(places),
      },
    });
    stripeInvoiceId = invoice.id;

    const each = (unitCents / 100).toFixed(2);
    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      amount: subtotal,
      currency: currency.toLowerCase(),
      description: `${course.title} — ${places} place${places === 1 ? "" : "s"} at ${currency} ${each} each (excl. VAT)`,
    });

    const finalised = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(invoice.id);

    // Stripe's own figures are the ones that were billed, so they win.
    const stripeVat = taxTotal(finalised);
    const stripeTotal = finalised.total ?? total;

    await supabase.from("invoices").update({
      stripe_customer_id: customer.id,
      stripe_invoice_id: invoice.id,
      stripe_invoice_number: finalised.number || null,
      hosted_invoice_url: finalised.hosted_invoice_url || null,
      due_date: finalised.due_date ? new Date(finalised.due_date * 1000).toISOString().slice(0, 10) : null,
      vat_cents: stripeVat ?? vat,
      total_cents: stripeTotal,
      subtotal_cents: stripeTotal - (stripeVat ?? vat),
      status: "sent",
      last_error: null,
    }).eq("id", row.id);

    if (discountCode) {
      try {
        await supabase.rpc("bump_discount_redemption", { p_code: discountCode, p_course_id: courseId });
      } catch (e) {
        console.error("Could not count discount use", e);
      }
    }

    return json({
      sent: true,
      number: finalised.number || null,
      total_cents: stripeTotal,
      currency,
    });
  } catch (err) {
    console.error("Stripe invoice failed", err);
    // Tidy up so a half-made invoice does not sit in Stripe or the portal.
    if (stripeInvoiceId) {
      try { await stripe.invoices.del(stripeInvoiceId); } catch (_) {
        try { await stripe.invoices.voidInvoice(stripeInvoiceId); } catch (_) {}
      }
    }
    await supabase.from("invoices").delete().eq("id", row.id);
    return json({ error: "Stripe did not accept the invoice: " + (err.message || "unknown error") }, 502);
  }
}

// ---------------------------------------------------------------
// put a person onto a paid invoice
// ---------------------------------------------------------------

async function addParticipant(b, me) {
  const r = await addPlace({
    invoiceId: b.invoice_id,
    first: b.first_name, last: b.last_name, email: b.email, phone: b.phone,
    addedBy: me.id,
  });
  if (r.error) return json({ error: r.error }, r.status || 400);
  return json({ added: true, registration_id: r.registration_id, confirmation: r.confirmation });
}

// Shared with invoice-names.mjs, the public form the payer fills in,
// so a place is added the same way whoever adds it.
export async function addPlace({ invoiceId, first, last, email, phone, addedBy = null }) {
  first = clean(first); last = clean(last); email = clean(email); phone = clean(phone);
  if (!first || !last) return { error: "First and last name are both needed — they go on the certificate." };
  if (!email || !email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    return { error: `A valid email is needed for ${first || "each person"}.` };
  }

  const { data: inv, error } = await supabase
    .from("invoices")
    .select("id, course_id, status, places, total_cents, vat_rate, currency, unit_price_cents, discount_code, discount_percent, payer_name, business_name, stripe_invoice_number")
    .eq("id", invoiceId)
    .single();
  if (error || !inv) return { error: "Invoice not found.", status: 404 };
  if (inv.status !== "paid") return { error: "This invoice has not been paid yet. People can be added once it is." };

  const { data: existing } = await supabase
    .from("registrations")
    .select("id, email")
    .eq("invoice_id", inv.id);
  const taken = existing || [];
  if (taken.length >= inv.places) {
    return { error: `All ${inv.places} places on this invoice are already filled.` };
  }
  if (taken.some((r) => String(r.email || "").toLowerCase() === email.toLowerCase())) {
    return { error: `${email} is already on this invoice.` };
  }

  // Each person carries their share of what was actually paid, so the
  // course's income adds up to the invoice.
  const share = Math.round((inv.total_cents || 0) / inv.places);
  const discountEach = Math.round(
    inv.unit_price_cents * (Number(inv.discount_percent) || 0) / 100 * (1 + (Number(inv.vat_rate) || 0) / 100)
  );

  const { data: reg, error: regErr } = await supabase
    .from("registrations")
    .insert({
      course_id: inv.course_id,
      first_name: first,
      last_name: last,
      email,
      phone,
      status: "active",
      source: "manual",
      source_note: ("Invoice " + (inv.stripe_invoice_number || "") + " — " + (inv.business_name || inv.payer_name)).replace(/\s+—/, " —"),
      payment_status: "paid_in_full",
      amount_paid_cents: share,
      currency: String(inv.currency || "EUR").toUpperCase(),
      discount_code: inv.discount_code,
      discount_cents: discountEach,
      invoice_id: inv.id,
      added_by: addedBy,
    })
    .select("id")
    .single();

  if (regErr) {
    if (regErr.code === "23514") return { error: "The course is full. Please contact us and we will sort it out." };
    return { error: "Could not add them: " + regErr.message, status: 500 };
  }

  const confirmation = await sendConfirmation({
    courseId: inv.course_id,
    email,
    firstName: first,
    option: "full",
    balanceCents: 0,
    online: null,
  });

  return { registration_id: reg.id, confirmation: confirmation || "unknown" };
}

// ---------------------------------------------------------------
// cancel an unpaid invoice
// ---------------------------------------------------------------

async function voidInvoice(b) {
  const { data: inv, error } = await supabase
    .from("invoices")
    .select("id, status, stripe_invoice_id")
    .eq("id", b.invoice_id)
    .single();
  if (error || !inv) return json({ error: "Invoice not found." }, 404);
  if (inv.status === "paid") return json({ error: "A paid invoice cannot be voided. Refund it in Stripe instead." }, 400);

  if (inv.stripe_invoice_id) {
    try {
      await stripe.invoices.voidInvoice(inv.stripe_invoice_id);
    } catch (err) {
      return json({ error: "Stripe would not void it: " + err.message }, 502);
    }
  }
  await supabase.from("invoices").update({ status: "void" }).eq("id", inv.id);
  return json({ voided: true });
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

async function findCode(raw, courseId) {
  const { data, error } = await supabase
    .from("discount_codes")
    .select("*")
    .ilike("code", raw)
    .or(`course_id.eq.${courseId},course_id.is.null`);
  if (error) return { error: "Could not check the discount code: " + error.message };

  const rows = data || [];
  // A code for this course beats a global one with the same name.
  const hit = rows.find((r) => r.course_id === courseId) || rows[0];
  if (!hit) return { error: `No discount code "${raw}" for this course.` };
  if (hit.active === false) return { error: `The code ${hit.code} is switched off.` };
  if (hit.expires_at && new Date(hit.expires_at) < new Date()) return { error: `The code ${hit.code} has expired.` };
  if (hit.max_redemptions != null && (hit.times_redeemed || 0) >= hit.max_redemptions) {
    return { error: `The code ${hit.code} has been used up.` };
  }
  const pct = Number(hit.percent_off);
  if (!(pct > 0)) return { error: `The code ${hit.code} is not a percentage discount, so it cannot go on an invoice.` };
  return { code: hit.code, percent: pct };
}

// Stripe has renamed this field across API versions.
function taxTotal(inv) {
  if (Array.isArray(inv.total_taxes)) return inv.total_taxes.reduce((s, t) => s + (t.amount || 0), 0);
  if (Array.isArray(inv.total_tax_amounts)) return inv.total_tax_amounts.reduce((s, t) => s + (t.amount || 0), 0);
  if (typeof inv.tax === "number") return inv.tax;
  return null;
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
