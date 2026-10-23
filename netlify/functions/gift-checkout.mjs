// netlify/functions/gift-checkout.mjs
//
// Selling gift cards on /gift/.
//
//   GET  -> { currency, currencies, presets, min, max, months }
//        The currency is picked from where the visitor is; they can
//        change it.
//
//   POST { amount, currency, from_name, recipient_name, recipient_email,
//          message, send_on }
//        -> { url }   the Stripe Checkout page
//
// The card itself is made by the Stripe webhook once payment goes
// through (onGiftSaleCompleted in netlify/lib/gift-cards.mjs), which
// emails the buyer, and the recipient now or on send_on.
//
// No VAT is charged here: a card that can be spent on things taxed at
// different rates is a multi-purpose voucher, taxed when it is spent.

import Stripe from "stripe";
import { json } from "../lib/directory.mjs";
import {
  GIFT_CURRENCIES, GIFT_PRESETS, GIFT_MIN, GIFT_MAX, GIFT_MONTHS, MESSAGE_MAX, money,
} from "../lib/gift-cards.mjs";
import { currencyForCountry } from "./online-checkout.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe metadata values stop at 500 characters.
const clip = (s, n) => String(s || "").trim().slice(0, n);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (req, context) => {
  if (req.method === "GET") {
    let country = null;
    try { country = context?.geo?.country?.code || null; } catch (e) { country = null; }
    return json({
      currency: currencyForCountry(country),
      currencies: GIFT_CURRENCIES,
      presets: GIFT_PRESETS,
      min: GIFT_MIN,
      max: GIFT_MAX,
      months: GIFT_MONTHS,
      message_max: MESSAGE_MAX,
    });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const b = await req.json();
    const currency = String(b.currency || "").toUpperCase();
    if (!GIFT_CURRENCIES.includes(currency)) return json({ error: "Choose a currency" }, 400);

    const units = Number(b.amount);
    if (!Number.isInteger(units) || units < GIFT_MIN || units > GIFT_MAX) {
      return json({ error: `Choose an amount between ${GIFT_MIN} and ${GIFT_MAX}, in whole numbers` }, 400);
    }
    const cents = units * 100;

    const fromName = clip(b.from_name, 80);
    const recipientName = clip(b.recipient_name, 80);
    const recipientEmail = clip(b.recipient_email, 200).toLowerCase();
    const message = clip(b.message, MESSAGE_MAX);
    if (!fromName) return json({ error: "Tell us who the card is from" }, 400);
    if (recipientEmail && !EMAIL.test(recipientEmail)) return json({ error: "That recipient email doesn't look right" }, 400);

    // Send date: today or up to a year ahead. Only meaningful when we
    // are the ones emailing it.
    let sendOn = "";
    if (recipientEmail && b.send_on) {
      const d = String(b.send_on).slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const limit = new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < today || d > limit) {
        return json({ error: "Choose a send date between today and a year from now" }, 400);
      }
      if (d > today) sendOn = d;
    }

    const origin = req.headers.get("origin") || process.env.SITE_URL;
    const name = `BirdBox Coaching gift card — ${money(cents, currency)}`;
    const who = recipientName ? ` for ${recipientName}` : "";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_creation: "always",
      billing_address_collection: "required",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: cents,
          product_data: {
            name: name + who,
            description: `Spend it on any BirdBox seminar or online course priced in ${currency}. Valid for ${GIFT_MONTHS} months. The code is emailed as soon as you have paid.`,
          },
        },
      }],
      payment_intent_data: { description: name + who },
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `${name}${who}. Multi-purpose voucher: no VAT is charged on the card itself; VAT is accounted for when it is spent.`,
          metadata: { kind: "gift_card" },
        },
      },
      metadata: {
        kind: "gift_card",
        amount_cents: String(cents),
        currency,
        from_name: fromName,
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        message,
        send_on: sendOn,
      },
      success_url: `${origin}/gift/?paid=1`,
      cancel_url: `${origin}/gift/`,
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("gift-checkout failed:", err);
    return json({ error: err.message || "Could not start checkout" }, 500);
  }
};
