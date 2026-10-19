// netlify/functions/balance-invoice.mjs
//
// "Invoice balance" on a participant's card: someone still owes part
// of their seminar (a RegFox final payment that kept failing, say).
// One Stripe invoice for what they owe, emailed to them, due on the
// date chosen.
//
// It goes through the system the same way a website balance does:
//
//   - a row in payments (sequence 2+, pending) carries the amount, so
//     the card shows the balance owed and they are not paid in full;
//   - the invoice carries metadata.registration_id, so the webhook
//     (onInvoicePaid) marks that row paid, sets them paid_in_full and
//     clears any overdue flag the moment it is paid — and flags them
//     overdue if Stripe gives up on it.
//
// The amount typed is what they owe in total, VAT included. VAT is the
// rate for the country the seminar runs in (admission to an event),
// from vat_rates, the same as the website checkout.
//
// Admin only.
//
//   POST { registration_id, amount, due_date, description, name, email,
//          line1, line2, city, postcode, country }

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);
  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return json({ error: "Not signed in" }, 401);
    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth || !auth.user) return json({ error: "Your session has expired — sign in again." }, 401);
    const { data: me } = await supabase
      .from("staff").select("id, role, active").eq("id", auth.user.id).maybeSingle();
    if (!me || !me.active) return json({ error: "Not a member of staff" }, 403);
    if (me.role !== "admin") return json({ error: "Only an admin can do this" }, 403);

    return await send(await request.json());
  } catch (err) {
    console.error("balance-invoice failed:", err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

async function send(b) {
  const clean = (v, max = 120) => String(v == null ? "" : v).trim().slice(0, max);

  const { data: reg } = await supabase
    .from("registrations")
    .select("id, first_name, last_name, email, status, currency, stripe_customer_id, " +
            "courses!registrations_course_id_fkey(id, title, country, currency)")
    .eq("id", b.registration_id).maybeSingle();
  if (!reg) return json({ error: "Registration not found." }, 404);
  if ((reg.status || "active") !== "active") return json({ error: "This registration is not active." }, 400);
  const course = reg.courses || {};

  const gross = Math.round(Number(b.amount) * 100);
  if (!Number.isFinite(gross) || gross <= 0) return json({ error: "Enter the amount they owe." }, 400);

  const today = new Date().toISOString().slice(0, 10);
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date || "")) ? b.due_date : today;
  if (due < today) return json({ error: "The due date cannot be in the past." }, 400);

  const name = clean(b.name) || `${reg.first_name || ""} ${reg.last_name || ""}`.trim();
  const email = clean(b.email) || reg.email;
  if (!email || !email.includes("@")) return json({ error: "A valid email is needed." }, 400);
  const description = clean(b.description, 300) || `Remaining balance — ${course.title || "seminar"}`;
  const currency = String(course.currency || reg.currency || "EUR").toLowerCase();

  // Not twice: an unpaid balance invoice already out stops another.
  const { data: open } = await supabase.from("payments")
    .select("id, sequence, stripe_invoice_id, status")
    .eq("registration_id", reg.id).eq("kind", "balance_invoice").in("status", ["pending", "failed"]);
  if (open && open.length) {
    return json({ error: "A balance invoice for this person is already out and unpaid. Void it in Stripe first if it is wrong." }, 409);
  }

  // VAT for the venue's country, inside the amount they owe.
  const { data: vr } = await supabase.from("vat_rates")
    .select("rate, stripe_tax_rate_id").eq("code", String(course.country || "").toUpperCase()).maybeSingle();
  const rate = vr ? (Number(vr.rate) <= 1 ? Number(vr.rate) * 100 : Number(vr.rate)) : 0;
  const taxRateId = rate > 0 && vr.stripe_tax_rate_id && vr.stripe_tax_rate_id.startsWith("txr_") ? vr.stripe_tax_rate_id : null;
  if (rate > 0 && !taxRateId) return json({ error: `The VAT rate for ${course.country} has no Stripe tax rate set up.` }, 400);
  const net = taxRateId ? netFor(gross, rate) : gross;
  if (net == null) return json({ error: "That amount cannot be split exactly into price and VAT. Change it by a cent." }, 400);

  // Due at the end of the chosen day (Stripe needs a time in the future).
  const dueAt = Math.max(
    Math.floor(Date.parse(`${due}T22:00:00Z`) / 1000),
    Math.floor(Date.now() / 1000) + 3600,
  );

  const country = clean(b.country, 2).toUpperCase();
  const customer = await stripe.customers.create({
    name,
    email,
    address: /^[A-Z]{2}$/.test(country) ? {
      line1: clean(b.line1) || "", line2: clean(b.line2) || "", city: clean(b.city, 80) || "",
      postal_code: clean(b.postcode, 20) || "", country,
    } : undefined,
    metadata: { registration_id: reg.id },
  });

  const participant = `${reg.first_name || ""} ${reg.last_name || ""}`.trim();
  let invoice;
  try {
    invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "send_invoice",
      due_date: dueAt,
      auto_advance: false,
      currency,
      description,
      default_tax_rates: taxRateId ? [taxRateId] : [],
      custom_fields: participant && participant.toLowerCase() !== name.toLowerCase()
        ? [{ name: "Participant", value: participant.slice(0, 30) }] : undefined,
      metadata: { registration_id: reg.id, course_id: course.id || "", kind: "balance_invoice" },
    });
    await stripe.invoiceItems.create({
      customer: customer.id, invoice: invoice.id, currency, amount: net, description,
    });
    const final = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false });
    if (final.total !== gross) {
      throw new Error(`the invoice came to ${(final.total / 100).toFixed(2)} instead of ${(gross / 100).toFixed(2)}`);
    }

    const { data: seqs } = await supabase.from("payments").select("sequence").eq("registration_id", reg.id);
    const sequence = Math.max(1, ...(seqs || []).map((p) => p.sequence || 0)) + 1;
    const { error: payErr } = await supabase.from("payments").insert({
      registration_id: reg.id, sequence, amount_cents: gross, due_date: due,
      status: "pending", stripe_invoice_id: invoice.id, kind: "balance_invoice",
    });
    if (payErr) throw new Error("could not record it: " + payErr.message);

    await stripe.invoices.sendInvoice(invoice.id);

    // Not paid in full until this is paid; the webhook sets it back.
    await supabase.from("registrations")
      .update({ payment_status: "deposit_paid" }).eq("id", reg.id);

    return json({ sent: true, number: final.number, to: email, total: gross, currency: currency.toUpperCase() });
  } catch (err) {
    console.error("Balance invoice failed", err);
    if (invoice) {
      await supabase.from("payments").delete().eq("stripe_invoice_id", invoice.id);
      try { await stripe.invoices.del(invoice.id); } catch (_) {
        try { await stripe.invoices.voidInvoice(invoice.id); } catch (_) {}
      }
    }
    return json({ error: "Stripe did not accept the invoice: " + (err.message || "unknown error") + ". Nothing was sent." }, 502);
  }
}

// The price before VAT that Stripe will turn back into exactly the
// amount owed, VAT rounded to the cent.
function netFor(gross, ratePct) {
  const guess = Math.round(gross / (1 + ratePct / 100));
  for (let n = guess - 2; n <= guess + 2; n++) {
    if (n + Math.round(n * ratePct / 100) === gross) return n;
  }
  return null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
