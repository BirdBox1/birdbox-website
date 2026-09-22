// netlify/functions/plan-public.mjs
//
// The payer's side of a payment plan sent from the portal. They open
// /plan/?t=…, see the schedule and the commitment, type their name,
// tick to agree, and are sent to Stripe Checkout to pay the deposit.
// Their card is saved there for the instalments; the webhook
// (stripe-webhook.mjs) does the rest once the deposit is paid.
//
//   GET  ?t=token                 what the page needs to draw itself
//   POST { t, name, agree: true } record the agreement, return the
//                                 Stripe Checkout address

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL = (process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app").replace(/\/+$/, "");
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async (request) => {
  try {
    if (request.method === "GET") {
      const t = new URL(request.url).searchParams.get("t") || "";
      const row = await byToken(t);
      if (!row) return json({ error: "This link is not valid. Please reply to your plan email and we will help." }, 404);
      return json(summary(row));
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const row = await byToken(body.t || "");
      if (!row) return json({ error: "This link is not valid." }, 404);
      if (row.plan_state !== "awaiting_deposit") {
        return json({ error: row.plan_state === "cancelled" ? "This plan has been cancelled." : "The deposit for this plan is already paid." }, 400);
      }

      const name = String(body.name || "").trim();
      if (!body.agree) return json({ error: "Please tick to agree to the plan." }, 400);
      if (name.length < 2) return json({ error: "Please type your full name." }, 400);

      const course = row.courses || {};
      const deposit = (row.schedule || []).find((x) => x.kind === "deposit");
      if (!deposit) return json({ error: "This plan has no deposit set. Please reply to your plan email." }, 500);

      let taxRateId = null;
      if (row.vat_country && Number(row.vat_rate) > 0) {
        const { data: vr } = await supabase
          .from("vat_rates").select("stripe_tax_rate_id").eq("code", row.vat_country).maybeSingle();
        taxRateId = vr && vr.stripe_tax_rate_id ? vr.stripe_tax_rate_id : null;
      }

      const meta = { portal_invoice_id: row.id, course_id: row.course_id, kind: "plan_deposit" };
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: row.stripe_customer_id || undefined,
        customer_email: row.stripe_customer_id ? undefined : row.payer_email,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: String(row.currency).toLowerCase(),
            unit_amount: deposit.net_cents,
            product_data: {
              name: `Deposit — ${course.title || "course"} (${row.places} place${row.places === 1 ? "" : "s"})`,
              description: `Then ${row.instalments} monthly payment${row.instalments === 1 ? "" : "s"} taken automatically from this card.`,
            },
          },
          tax_rates: taxRateId ? [taxRateId] : [],
        }],
        // Saves the card for the instalments the payer has just agreed to.
        payment_intent_data: { setup_future_usage: "off_session", metadata: meta },
        // A proper paid invoice for the deposit, not just a receipt, so
        // a business has the invoice it needs for its accounts. Tagged
        // so the webhook and the match list leave it alone.
        invoice_creation: {
          enabled: true,
          invoice_data: {
            description: `Deposit — ${course.title || "course"} (${row.places} place${row.places === 1 ? "" : "s"}), ` +
              `then ${row.instalments} monthly payment${row.instalments === 1 ? "" : "s"}`,
            metadata: { kind: "plan_deposit_invoice", plan_id: row.id },
          },
        },
        metadata: meta,
        success_url: `${SITE_URL}/invoice-names/?t=${row.names_token}&paid=1`,
        cancel_url: `${SITE_URL}/plan/?t=${row.names_token}`,
      });

      await supabase.from("invoices").update({
        agreed_at: new Date().toISOString(),
        agreed_name: name,
        checkout_session_id: session.id,
      }).eq("id", row.id);

      return json({ url: session.url });
    }

    return json({ error: "Use GET or POST" }, 405);
  } catch (err) {
    console.error("plan-public failed:", err);
    return json({ error: "Something went wrong. Please try again, or reply to your plan email." }, 500);
  }
};

async function byToken(t) {
  if (!TOKEN.test(String(t))) return null;
  const { data } = await supabase
    .from("invoices")
    .select("id, kind, plan_state, course_id, places, currency, payer_name, business_name, payer_email, total_cents, vat_rate, vat_country, deposit_cents, instalments, schedule, agreement_text, names_token, stripe_customer_id, courses ( title, brand, starts_at, timezone )")
    .eq("names_token", t)
    .eq("kind", "plan")
    .maybeSingle();
  return data || null;
}

function summary(row) {
  const c = row.courses || {};
  let when = "";
  try {
    when = new Date(c.starts_at).toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: c.timezone || "UTC",
    });
  } catch (_) {}
  return {
    state: row.plan_state,
    payer: row.business_name || row.payer_name,
    course: c.title || "",
    brand: String(c.brand || "").toLowerCase(),
    when,
    places: row.places,
    currency: String(row.currency).toUpperCase(),
    total_cents: row.total_cents,
    vat_rate: Number(row.vat_rate) || 0,
    schedule: (row.schedule || []).map((x) => ({
      kind: x.kind, n: x.n, due_date: x.due_date, gross_cents: x.gross_cents, status: x.status,
    })),
    terms: row.agreement_text,
    names_link: `/invoice-names/?t=${row.names_token}`,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
