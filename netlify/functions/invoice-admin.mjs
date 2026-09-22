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
import { sendConfirmation, sendNamesForm, sendPlanEmail } from "./stripe-webhook.mjs";
import { grantOnlineCourse } from "./learnworlds.mjs";

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
      case "list_unmatched":  return await listUnmatched();
      case "match":           return await matchInvoice(body, me);
      case "ignore":          return await ignoreInvoice(body, me);
      case "adopt":           return await adoptInvoice(body, me);
      case "create_plan":     return await createPlan(body, me);
      case "cancel_plan":     return await cancelPlan(body);
      case "resend_plan":     return await resendPlan(body);
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
  // "NONE" is an explicit choice of no VAT; blank means the seminar's country.
  const noVat = String(b.vat_country || "").toUpperCase() === "NONE";
  const vatCountry = noVat ? "" : String(b.vat_country || course.country || "").toUpperCase();
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

  const subtotal = unitCents * places;

  // A discount is either typed straight in (a percentage, or an amount
  // off the whole invoice before VAT) or taken from a discount code.
  let discountCode = null;
  let discountPercent = 0;
  let discount = 0;
  let couponSpec = null;

  const typedPct = Number(b.discount_percent) || 0;
  const typedAmt = Math.round((Number(b.discount_amount) || 0) * 100);
  const rawCode = clean(b.discount_code);

  if (typedPct < 0 || typedPct > 100) return json({ error: "A percentage discount must be between 0 and 100." }, 400);
  if (typedAmt < 0) return json({ error: "A discount cannot be negative." }, 400);
  if (typedAmt > subtotal) return json({ error: "The discount is more than the invoice." }, 400);

  if (typedPct > 0) {
    discountPercent = typedPct;
    discount = Math.round(subtotal * typedPct / 100);
    couponSpec = { percent_off: typedPct, name: `${typedPct}% discount` };
  } else if (typedAmt > 0) {
    discount = typedAmt;
    discountPercent = Math.round(typedAmt / subtotal * 10000) / 100;
    couponSpec = {
      amount_off: typedAmt, currency: currency.toLowerCase(),
      name: `${currency} ${(typedAmt / 100).toFixed(2)} discount`,
    };
  } else if (rawCode) {
    const found = await findCode(rawCode, courseId);
    if (found.error) return json({ error: found.error }, 400);
    discountCode = found.code;
    discountPercent = found.percent;
    discount = Math.round(subtotal * found.percent / 100);
    couponSpec = { percent_off: found.percent, name: found.code };
  }

  // Our own figures, used for the record and the preview. Stripe works
  // out the invoice itself; the two use the same order — discount off
  // the net price, then VAT on what is left.
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
      discount_amount_cents: discount,
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
    if (couponSpec) {
      const coupon = await stripe.coupons.create({ ...couponSpec, duration: "once" });
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
export async function addPlace({ invoiceId, first, last, email, phone, language = null, addedBy = null }) {
  first = clean(first); last = clean(last); email = clean(email); phone = clean(phone);
  language = clean(language);
  if (!first || !last) return { error: "First and last name are both needed — they go on the certificate." };
  if (!email || !email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    return { error: `A valid email is needed for ${first || "each person"}.` };
  }

  const { data: inv, error } = await supabase
    .from("invoices")
    .select("id, course_id, status, kind, plan_state, paid_cents, places, total_cents, vat_rate, currency, unit_price_cents, discount_code, discount_percent, discount_amount_cents, payer_name, business_name, stripe_invoice_number")
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
  // course's income adds up to the invoice. On a payment plan that is
  // their share of what has come in so far; later instalments add to
  // it as they are paid.
  const isPlan = inv.kind === "plan";
  const share = Math.round(((isPlan ? inv.paid_cents : inv.total_cents) || 0) / inv.places);
  const vatFactor = 1 + (Number(inv.vat_rate) || 0) / 100;
  const discountEach = inv.discount_amount_cents
    ? Math.round(inv.discount_amount_cents / inv.places * vatFactor)
    : Math.round(inv.unit_price_cents * (Number(inv.discount_percent) || 0) / 100 * vatFactor);

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
      source_note: isPlan
        ? "Payment plan — " + (inv.business_name || inv.payer_name)
        : ("Invoice " + (inv.stripe_invoice_number || "") + " — " + (inv.business_name || inv.payer_name)).replace(/\s+—/, " —"),
      payment_status: isPlan && inv.plan_state !== "completed" ? "deposit_paid" : "paid_in_full",
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

  // The free online course, where the course includes one — the same
  // enrolment a website booking gets, done before the confirmation so
  // the academy emails arrive first and the confirmation can mention it.
  const online = await enrolOnline({ courseId: inv.course_id, registrationId: reg.id, email, first, last, language });

  const confirmation = await sendConfirmation({
    courseId: inv.course_id,
    email,
    firstName: first,
    option: "full",
    balanceCents: 0,
    online,
  });

  return { registration_id: reg.id, confirmation: confirmation || "unknown", online: online ? online.status : null };
}

async function enrolOnline({ courseId, registrationId, email, first, last, language }) {
  const { data: course } = await supabase
    .from("courses").select("brand, level, title, grants_online_course").eq("id", courseId).maybeSingle();
  if (!course || !course.grants_online_course) return null;

  // No language given (an admin adding someone by hand): leave it for
  // the Grant online access button rather than guess.
  if (!language) {
    await supabase.from("registrations").update({
      learnworlds_status: "failed",
      learnworlds_error: "No language given — grant it from the portal",
    }).eq("id", registrationId);
    return null;
  }

  let result;
  try {
    result = await grantOnlineCourse(supabase, {
      email, firstName: first, lastName: last,
      brand: course.brand, level: course.level, language,
      justification: `Included free with ${course.title}`,
    });
  } catch (err) {
    result = { status: "failed", error: err.message };
  }

  await supabase.from("registrations").update({
    learnworlds_language: language,
    learnworlds_status: result.status,
    learnworlds_user_id: result.userId || null,
    learnworlds_enrolled_at: result.status === "enrolled" ? new Date().toISOString() : null,
    learnworlds_error: result.error || null,
  }).eq("id", registrationId);

  return result;
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
// payment plans: a deposit now, then monthly instalments
// ---------------------------------------------------------------
// Nothing is charged here. The payer gets a link to /plan/, reads the
// schedule and the commitment, agrees, and pays the deposit through
// Stripe Checkout (plan-public.mjs). The webhook then saves the card
// and schedules every instalment in Stripe.

// The commitment the payer agrees to. Placeholder wording — change it
// here once the accountant has approved it. {…} parts are filled in.
const PLAN_TERMS =
  "I agree to pay {total} for {places} on {course}: a deposit of {deposit} today, then " +
  "{count} monthly payments on the dates shown, taken automatically from the card I use " +
  "to pay the deposit. I understand this is a commitment to pay the full amount. If I " +
  "cancel, transfer or do not attend, the remaining payments are still due under BirdBox " +
  "Coaching's terms. If a payment fails it will be retried, and I will be emailed so I can " +
  "pay or change card.";

function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

async function createPlan(b, me) {
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

  const depositPct = Number(b.deposit_percent);
  if (!(depositPct > 0 && depositPct < 100)) return json({ error: "The deposit must be between 1% and 99%." }, 400);
  const count = parseInt(b.instalments, 10);
  if (!(count >= 1 && count <= 12)) return json({ error: "Choose between 1 and 12 instalments." }, 400);

  const first = String(b.first_instalment_date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) return json({ error: "Choose the date of the first instalment." }, 400);
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (first < tomorrow) return json({ error: "The first instalment must be at least a day from now." }, 400);

  const { data: course } = await supabase
    .from("courses").select("id, title, brand, country, currency").eq("id", courseId).single();
  if (!course) return json({ error: "Course not found." }, 404);
  const currency = String(course.currency || "EUR").toUpperCase();

  const noVat = String(b.vat_country || "").toUpperCase() === "NONE";
  const vatCountry = noVat ? "" : String(b.vat_country || course.country || "").toUpperCase();
  let vatRate = 0;
  if (vatCountry) {
    const { data: vr } = await supabase
      .from("vat_rates").select("rate, stripe_tax_rate_id").eq("code", vatCountry).maybeSingle();
    if (vr && Number(vr.rate) > 0) {
      vatRate = Number(vr.rate) <= 1 ? Number(vr.rate) * 100 : Number(vr.rate);
      if (!vr.stripe_tax_rate_id || !vr.stripe_tax_rate_id.startsWith("txr_")) {
        return json({ error: `The VAT rate for ${vatCountry} has no Stripe tax rate set up.` }, 400);
      }
    }
  }

  const subtotal = unitCents * places;
  const typedPct = Number(b.discount_percent) || 0;
  const typedAmt = Math.round((Number(b.discount_amount) || 0) * 100);
  if (typedPct < 0 || typedPct > 100) return json({ error: "A percentage discount must be between 0 and 100." }, 400);
  if (typedAmt < 0 || typedAmt > subtotal) return json({ error: "Check the discount amount." }, 400);
  const discount = typedPct > 0 ? Math.round(subtotal * typedPct / 100) : typedAmt;
  const discountPercent = typedPct > 0 ? typedPct : (discount ? Math.round(discount / subtotal * 10000) / 100 : 0);

  // Every part is worked out before VAT and has VAT added on its own,
  // which is how Stripe charges each one. Rounding lands on the last
  // instalment so the parts add up exactly.
  const net = subtotal - discount;
  const depositNet = Math.round(net * depositPct / 100);
  const rest = net - depositNet;
  const each = Math.floor(rest / count);
  const vatOf = (c) => Math.round(c * vatRate / 100);

  const schedule = [{
    n: 0, kind: "deposit", due_date: null,
    net_cents: depositNet, vat_cents: vatOf(depositNet), gross_cents: depositNet + vatOf(depositNet),
    status: "pending",
  }];
  for (let i = 1; i <= count; i++) {
    const partNet = i === count ? rest - each * (count - 1) : each;
    schedule.push({
      n: i, kind: "instalment", due_date: addMonths(first, i - 1),
      net_cents: partNet, vat_cents: vatOf(partNet), gross_cents: partNet + vatOf(partNet),
      status: "pending",
    });
  }
  const total = schedule.reduce((sum, x) => sum + x.gross_cents, 0);
  const vatTotal = schedule.reduce((sum, x) => sum + x.vat_cents, 0);

  const money = (c) => `${currency} ${(c / 100).toFixed(2)}`;
  const terms = PLAN_TERMS
    .replace("{total}", money(total))
    .replace("{places}", `${places} place${places === 1 ? "" : "s"}`)
    .replace("{course}", course.title)
    .replace("{deposit}", money(schedule[0].gross_cents))
    .replace("{count}", String(count));

  const customer = await stripe.customers.create({
    name: business || payerName,
    email: payerEmail,
    address: clean(b.address_line1) ? {
      line1: clean(b.address_line1), line2: clean(b.address_line2) || undefined,
      city: clean(b.city) || undefined, postal_code: clean(b.postcode) || undefined,
      country: clean(b.address_country) || undefined,
    } : undefined,
  });

  const { data: row, error } = await supabase
    .from("invoices")
    .insert({
      kind: "plan",
      plan_state: "awaiting_deposit",
      status: "sent",
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
      discount_percent: discountPercent,
      discount_amount_cents: discount,
      subtotal_cents: net,
      vat_cents: vatTotal,
      total_cents: total,
      deposit_percent: depositPct,
      deposit_cents: schedule[0].gross_cents,
      instalments: count,
      first_instalment_date: first,
      schedule,
      agreement_text: terms,
      stripe_customer_id: customer.id,
      created_by: me.id,
    })
    .select("*")
    .single();
  if (error) return json({ error: "Could not save the plan: " + error.message }, 500);

  const emailed = b.send_email === false ? false : await sendPlanEmail(row, course);
  return json({ sent: true, emailed, total_cents: total, currency, token: row.names_token });
}

async function resendPlan(b) {
  const { data: row } = await supabase
    .from("invoices").select("*, courses ( title, brand )").eq("id", b.invoice_id).maybeSingle();
  if (!row || row.kind !== "plan") return json({ error: "Plan not found." }, 404);
  if (row.plan_state !== "awaiting_deposit") return json({ error: "The deposit is already paid." }, 400);
  const emailed = await sendPlanEmail(row, row.courses || {});
  if (!emailed) return json({ error: "The email did not send. Use Copy plan link instead." }, 502);
  return json({ emailed: true });
}

async function cancelPlan(b) {
  const { data: row } = await supabase
    .from("invoices").select("id, kind, plan_state, schedule, checkout_session_id").eq("id", b.invoice_id).maybeSingle();
  if (!row || row.kind !== "plan") return json({ error: "Plan not found." }, 404);
  if (["cancelled", "completed"].includes(row.plan_state)) return json({ error: "This plan is already " + row.plan_state + "." }, 400);

  if (row.checkout_session_id && row.plan_state === "awaiting_deposit") {
    try { await stripe.checkout.sessions.expire(row.checkout_session_id); } catch (_) { /* already used or expired */ }
  }

  // Stop every instalment that has not been paid. Drafts are deleted;
  // anything Stripe has already finalised is voided.
  const schedule = Array.isArray(row.schedule) ? row.schedule.map((x) => ({ ...x })) : [];
  const problems = [];
  for (const item of schedule) {
    if (item.kind === "deposit" || item.status === "paid" || !item.stripe_invoice_id) {
      if (item.kind !== "deposit" && item.status !== "paid") item.status = "cancelled";
      continue;
    }
    try {
      const inv = await stripe.invoices.retrieve(item.stripe_invoice_id);
      if (inv.status === "draft") await stripe.invoices.del(inv.id);
      else if (inv.status === "open") await stripe.invoices.voidInvoice(inv.id);
      else if (inv.status === "paid") { item.status = "paid"; continue; }
      item.status = "cancelled";
    } catch (err) {
      problems.push(`Instalment ${item.n}: ${err.message}`);
    }
  }

  await supabase.from("invoices").update({
    plan_state: "cancelled",
    status: row.plan_state === "awaiting_deposit" ? "void" : "paid",
    schedule,
  }).eq("id", row.id);

  if (problems.length) return json({ cancelled: true, warning: "Some instalments need stopping in Stripe by hand: " + problems.join("; ") });
  return json({ cancelled: true });
}

// ---------------------------------------------------------------
// Stripe invoices made by hand in the dashboard
// ---------------------------------------------------------------
// They carry no link to anybody, so the money never reached the
// portal. These actions list them and let an admin say who each one
// was for. Anything the system made itself is left out: portal
// invoices, balance invoices (they carry a registration), host
// payments (they carry a course), and anything for a customer who
// booked through the website checkout.

const MATCH_SINCE = Math.floor(new Date("2026-08-01T00:00:00Z").getTime() / 1000);

async function listUnmatched() {
  const all = [];
  for await (const inv of stripe.invoices.list({ status: "paid", limit: 100, created: { gte: MATCH_SINCE } })) {
    all.push(inv);
    if (all.length >= 500) break;
  }

  // Left out: invoices the system made for one person (a balance), and
  // portal invoices and plans. Invoices tagged only with a course — a
  // group or host payment for a block of places — are kept, because
  // the people on them still need linking.
  const handMade = all.filter((i) => {
    const m = i.metadata || {};
    return !m.registration_id && !m.portal_invoice_id;
  });
  if (!handMade.length) return json({ invoices: [] });

  const ids = handMade.map((i) => i.id);
  const customers = [...new Set(handMade.map((i) => i.customer).filter(Boolean))];

  const { data: done } = await supabase
    .from("stripe_matches").select("stripe_invoice_id").in("stripe_invoice_id", ids);
  const doneIds = new Set((done || []).map((d) => d.stripe_invoice_id));

  const { data: online } = customers.length
    ? await supabase.from("registrations").select("stripe_customer_id").in("stripe_customer_id", customers)
    : { data: [] };
  const onlineCustomers = new Set((online || []).map((r) => r.stripe_customer_id));

  // A customer who also booked on the website used to be left out
  // entirely, which hid real hand-made invoices (a gym owner who once
  // booked himself, say). They are now shown, marked, and listed last.
  const out = handMade
    .filter((i) => !doneIds.has(i.id))
    .map((i) => ({
      online: onlineCustomers.has(i.customer),
      id: i.id,
      number: i.number,
      name: i.customer_name || "",
      email: i.customer_email || "",
      amount_cents: i.amount_paid,
      currency: String(i.currency || "").toUpperCase(),
      created: new Date(i.created * 1000).toISOString(),
      description: i.description || (i.lines && i.lines.data && i.lines.data[0] && i.lines.data[0].description) || "",
    }));

  out.sort((a, b) => (a.online === b.online ? 0 : a.online ? 1 : -1));
  return json({ invoices: out });
}

async function matchInvoice(b, me) {
  const regIds = Array.isArray(b.registration_ids) ? [...new Set(b.registration_ids)] : [];
  if (!b.stripe_invoice_id) return json({ error: "No invoice given." }, 400);
  if (!regIds.length) return json({ error: "Tick at least one participant." }, 400);

  const { data: already } = await supabase
    .from("stripe_matches").select("id").eq("stripe_invoice_id", b.stripe_invoice_id).limit(1);
  if (already && already.length) return json({ error: "That invoice has already been matched." }, 400);

  const inv = await stripe.invoices.retrieve(b.stripe_invoice_id);
  if (inv.status !== "paid") return json({ error: "That invoice is not paid." }, 400);
  const currency = String(inv.currency || "").toUpperCase();

  const { data: regs, error } = await supabase
    .from("registrations")
    .select("id, first_name, last_name, amount_paid_cents, currency, payment_status")
    .in("id", regIds);
  if (error) return json({ error: error.message }, 500);
  if (!regs || regs.length !== regIds.length) return json({ error: "One of those participants could not be found." }, 404);

  // A person already holding money in another currency cannot have
  // this added to it without the total becoming meaningless.
  for (const r of regs) {
    if ((r.amount_paid_cents || 0) > 0 && r.currency && String(r.currency).toUpperCase() !== currency) {
      return json({ error: `${r.first_name} ${r.last_name} already has a payment in ${r.currency}; this invoice is in ${currency}.` }, 400);
    }
  }

  // Split evenly; any odd cent goes to the first person so the total
  // still equals the invoice.
  const n = regs.length;
  const base = Math.floor(inv.amount_paid / n);
  const extra = inv.amount_paid - base * n;

  const rows = [];
  for (let i = 0; i < n; i++) {
    const r = regs[i];
    const share = base + (i === 0 ? extra : 0);
    const patch = {
      amount_paid_cents: (r.amount_paid_cents || 0) + share,
      currency,
    };
    if (!["paid_in_full", "refunded"].includes(r.payment_status)) patch.payment_status = "paid_in_full";

    const { error: uErr } = await supabase.from("registrations").update(patch).eq("id", r.id);
    if (uErr) return json({ error: `Could not update ${r.first_name}: ${uErr.message}` }, 500);

    rows.push({
      stripe_invoice_id: inv.id,
      stripe_invoice_number: inv.number,
      registration_id: r.id,
      amount_cents: share,
      currency,
      matched_by: me.id,
    });
  }

  const { error: mErr } = await supabase.from("stripe_matches").insert(rows);
  if (mErr) return json({ error: "Amounts saved, but the match record failed: " + mErr.message }, 500);

  return json({ matched: n, amount_cents: inv.amount_paid, currency });
}

// A hand-made invoice for a block of places, turned into a portal
// invoice so the payer can name the people through the form. Anyone
// already registered under this payment (by a discount code, or added
// by hand) is ticked and linked, so they fill a place and are never
// registered twice. Nobody new is created here — only the payer's
// form does that.
async function adoptInvoice(b, me) {
  const places = parseInt(b.places, 10);
  const linkIds = Array.isArray(b.registration_ids) ? [...new Set(b.registration_ids)] : [];
  if (!b.stripe_invoice_id || !b.course_id) return json({ error: "Invoice or course missing." }, 400);
  if (!Number.isFinite(places) || places < 1) return json({ error: "Number of places must be at least 1." }, 400);
  if (linkIds.length > places) return json({ error: "More people ticked than places paid for." }, 400);

  const { data: already } = await supabase
    .from("stripe_matches").select("id").eq("stripe_invoice_id", b.stripe_invoice_id).limit(1);
  if (already && already.length) return json({ error: "That invoice has already been matched." }, 400);

  const inv = await stripe.invoices.retrieve(b.stripe_invoice_id);
  if (inv.status !== "paid") return json({ error: "That invoice is not paid." }, 400);
  const currency = String(inv.currency || "").toUpperCase();
  const payerEmail = clean(b.payer_email) || inv.customer_email;
  if (!payerEmail || !payerEmail.includes("@")) return json({ error: "A valid payer email is needed." }, 400);

  const { data: course } = await supabase
    .from("courses").select("id, title, brand, country").eq("id", b.course_id).single();
  if (!course) return json({ error: "Course not found." }, 404);

  let vatRate = 0;
  const { data: vr } = await supabase
    .from("vat_rates").select("rate").eq("code", String(course.country || "").toUpperCase()).maybeSingle();
  if (vr && Number(vr.rate) > 0) vatRate = Number(vr.rate) <= 1 ? Number(vr.rate) * 100 : Number(vr.rate);

  const total = inv.amount_paid;
  const vat = typeof inv.tax === "number" ? inv.tax : (taxTotal(inv) || 0);
  const net = total - vat;

  let regs = [];
  if (linkIds.length) {
    const { data, error } = await supabase
      .from("registrations")
      .select("id, course_id, first_name, last_name, amount_paid_cents, currency, payment_status, invoice_id")
      .in("id", linkIds);
    if (error) return json({ error: error.message }, 500);
    regs = data || [];
    if (regs.length !== linkIds.length) return json({ error: "One of those participants could not be found." }, 404);
    for (const r of regs) {
      if (r.course_id !== course.id) return json({ error: `${r.first_name} ${r.last_name} is on a different course.` }, 400);
      if (r.invoice_id) return json({ error: `${r.first_name} ${r.last_name} is already on another invoice.` }, 400);
      if ((r.amount_paid_cents || 0) > 0 && r.currency && String(r.currency).toUpperCase() !== currency) {
        return json({ error: `${r.first_name} ${r.last_name} already has a payment in ${r.currency}.` }, 400);
      }
    }
  }

  const { data: row, error: insErr } = await supabase
    .from("invoices")
    .insert({
      course_id: course.id,
      payer_name: inv.customer_name || payerEmail,
      payer_email: payerEmail,
      vat_country: String(course.country || "").toUpperCase() || null,
      vat_rate: vatRate,
      places,
      unit_price_cents: Math.round(net / places),
      currency,
      subtotal_cents: net,
      vat_cents: vat,
      total_cents: total,
      stripe_customer_id: typeof inv.customer === "string" ? inv.customer : null,
      stripe_invoice_id: inv.id,
      stripe_invoice_number: inv.number,
      hosted_invoice_url: inv.hosted_invoice_url || null,
      status: "paid",
      paid_at: inv.status_transitions && inv.status_transitions.paid_at
        ? new Date(inv.status_transitions.paid_at * 1000).toISOString() : new Date().toISOString(),
      created_by: me.id,
    })
    .select("id, names_token, payer_name, payer_email, places")
    .single();
  if (insErr) return json({ error: "Could not set it up: " + insErr.message }, 500);

  const share = Math.round(total / places);
  const matchRows = [{
    stripe_invoice_id: inv.id, stripe_invoice_number: inv.number, registration_id: null,
    amount_cents: total, currency, matched_by: me.id,
  }];
  for (const r of regs) {
    const patch = { invoice_id: row.id, amount_paid_cents: (r.amount_paid_cents || 0) + share, currency };
    if (!["paid_in_full", "refunded"].includes(r.payment_status)) patch.payment_status = "paid_in_full";
    const { error: uErr } = await supabase.from("registrations").update(patch).eq("id", r.id);
    if (uErr) return json({ error: `Set up, but could not link ${r.first_name}: ${uErr.message}` }, 500);
  }
  await supabase.from("stripe_matches").insert(matchRows);

  const left = places - regs.length;
  let emailed = false;
  if (b.send_email && left > 0) {
    emailed = await sendNamesForm(
      { ...row, courses: { title: course.title, brand: course.brand } },
      { number: inv.number, id: inv.id }
    );
    if (emailed) await supabase.from("invoices").update({ names_emailed_at: new Date().toISOString() }).eq("id", row.id);
  }

  return json({ set_up: true, linked: regs.length, left, emailed });
}

// For a paid invoice that is not a course place at all.
async function ignoreInvoice(b, me) {
  if (!b.stripe_invoice_id) return json({ error: "No invoice given." }, 400);
  const inv = await stripe.invoices.retrieve(b.stripe_invoice_id);
  const { error } = await supabase.from("stripe_matches").insert({
    stripe_invoice_id: inv.id,
    stripe_invoice_number: inv.number,
    registration_id: null,
    amount_cents: inv.amount_paid,
    currency: String(inv.currency || "").toUpperCase(),
    ignored: true,
    matched_by: me.id,
  });
  if (error) return json({ error: error.message }, 500);
  return json({ ignored: true });
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
