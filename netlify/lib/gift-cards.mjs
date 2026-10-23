// netlify/lib/gift-cards.mjs
//
// Gift cards: a sum of money, bought on /gift/, spent on any seminar
// or online course. Shared by the checkout that sells them
// (gift-checkout), the Stripe webhook that issues them, the daily
// sender (gift-card-send), the printable card (gift-card-view) and
// every checkout that takes a code (validate-discount, create-checkout,
// free-registration, online-checkout).
//
// WHERE THINGS LIVE
//   gift_cards              one row per card: code, balance, currency,
//                           who it is from and to, when to send it.
//   gift_card_redemptions   one row each time a card pays for something.
//   redeem_gift_card()      the database function that takes money off
//                           a card, once per checkout, never below zero.
//
// A card keeps a balance. A €250 card used on a €200 seminar still has
// €50 on it, for another time. It is spent in its own currency only.
//
// VAT: a card that can buy things taxed at different rates is a
// multi-purpose voucher. No VAT is charged when it is bought; VAT is
// due when it is spent. So at checkout the card pays towards the price
// INCLUDING VAT, and the VAT on the part it paid is still owed by us.
// The redemption rows are what the accountant needs for that.

import { db, sendMail, esc, SITE_URL, OFFICE } from "./directory.mjs";

export const GIFT_CURRENCIES = ["EUR", "GBP", "USD", "AUD", "CAD"];
export const GIFT_PRESETS = [100, 250, 500];   // in whole units of the currency
export const GIFT_MIN = 50;
export const GIFT_MAX = 3000;
export const GIFT_MONTHS = 24;                 // how long a card lasts
export const MESSAGE_MAX = 400;

// Stripe will not take a card payment under one unit of the currency,
// so a card is never allowed to leave less than this to pay.
const STRIPE_MIN = 100;

// No 0/O, 1/I/L: the code is read off a printed card and typed in.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomChars(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function newCode() {
  return "GIFT-" + randomChars(4) + "-" + randomChars(4);
}

export function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function money(cents, currency) {
  return new Intl.NumberFormat("en", {
    style: "currency", currency, minimumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}

export function niceDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// Looks like a gift card code? Saves a database trip for every
// ordinary discount code typed into a box.
export function looksLikeGift(code) {
  return /^GIFT[\s-]?[A-Z0-9]{4}[\s-]?[A-Z0-9]{4}$/i.test(String(code || "").trim());
}

// "gift abcd efgh" -> "GIFT-ABCD-EFGH"
function normalise(code) {
  const bare = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^GIFT/, "");
  return bare.length === 8 ? "GIFT-" + bare.slice(0, 4) + "-" + bare.slice(4) : null;
}

// The card behind a code, or { error } in words a buyer can act on.
export async function findCard(code, currency) {
  const clean = normalise(code);
  if (!clean) return { error: "That gift card code isn't recognised" };

  const { data: card } = await db.from("gift_cards").select("*").eq("code", clean).maybeSingle();
  if (!card) return { error: "That gift card code isn't recognised" };
  if (card.status !== "active") return { error: "That gift card is no longer active" };
  if (new Date(card.expires_at) < new Date()) return { error: "That gift card expired on " + niceDate(card.expires_at) };
  if (card.balance_cents <= 0) return { error: "That gift card has been used up" };
  if (currency && card.currency !== String(currency).toUpperCase()) {
    return { error: `That gift card is in ${card.currency}, and this is priced in ${String(currency).toUpperCase()}`, card };
  }
  return { card };
}

// How much of a price a card pays. Prices on the site are quoted
// before VAT, and the card pays towards the price WITH VAT, so:
//
//   gross      = net + VAT
//   covered    = what comes off the card (never more than its balance)
//   remaining  = the net price still to pay by card at Stripe, on
//                which Stripe adds the VAT as normal
//
// If the card would leave a sliver under Stripe's minimum to pay, it
// takes slightly less, so the buyer pays the minimum and the rest
// stays on the card. vatPercent is 0 where no VAT is charged.
export function applyCard(card, netCents, vatPercent = 0) {
  const factor = 1 + (Number(vatPercent) || 0) / 100;
  const gross = Math.round(netCents * factor);
  let covered = Math.min(card.balance_cents, gross);
  let remainingGross = gross - covered;
  if (remainingGross > 0 && remainingGross < STRIPE_MIN) {
    covered = Math.max(0, gross - STRIPE_MIN);
    remainingGross = gross - covered;
  }
  const remainingNet = remainingGross === 0 ? 0 : Math.round(remainingGross / factor);
  return {
    covered,
    remainingNet,
    discountNet: netCents - remainingNet,
    balanceAfter: card.balance_cents - covered,
    free: remainingNet === 0,
  };
}

// VAT on a seminar: the venue's country, unless it has no rate or
// is exempt (Ireland). Mirrors vatForCourse in create-checkout.
export async function seminarVatPercent(course) {
  return (await seminarVat(course)).percent;
}

// { country, percent } for a seminar: the venue's country, and its rate
// (0 where none is charged, e.g. Ireland's exempt seminars).
export async function seminarVat(course) {
  const country = String(course.country || "").trim().toUpperCase() || null;
  return { country, percent: await venueRate(country) };
}

async function venueRate(code) {
  if (!code) return 0;
  const { data } = await db.from("vat_rates").select("rate, stripe_tax_rate_id, seminars_exempt").eq("code", code).maybeSingle();
  if (!data || !data.stripe_tax_rate_id || data.seminars_exempt) return 0;
  const raw = Number(data.rate);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw <= 1 ? raw * 100 : raw;
}

// Takes money off the card once the purchase has gone through. The
// database function refuses to go below zero and ignores a second
// call for the same session, so a redelivered webhook is harmless.
// If the card cannot cover it after all (spent twice at the same
// moment), the sale stands and the office is told.
//
// vatCountry and vatPercent are the VAT inside what the card paid (the
// venue's country for a seminar, the buyer's for an online course; 0
// where none is charged). They are stored on the redemption, which is
// what the VAT report in the portal (/portal/gift-cards/) reads.
export async function redeemCard({ cardId, cents, session, usedFor, registrationId, vatCountry, vatPercent }) {
  if (!cardId || !(cents > 0)) return null;
  const { data, error } = await db.rpc("redeem_gift_card", {
    p_card: cardId, p_cents: cents, p_session: session || null,
    p_used_for: usedFor, p_registration: registrationId || null,
    p_vat_country: vatCountry || null, p_vat_percent: Number(vatPercent) || 0,
  });
  if (error || data === null) {
    console.error("Gift card could not be redeemed", { cardId, cents, session, error });
    await sendMail({
      to: OFFICE,
      subject: "[BirdBox] Gift card could not be charged — check this sale",
      text: `A purchase went through using gift card ${cardId}, but ${(cents / 100).toFixed(2)} (in the card's currency) could not be taken off it.\n\n` +
        `Used for: ${usedFor}\nStripe session: ${session || "(free registration)"}\n\n` +
        `Most likely the card was spent somewhere else at the same moment, or has expired. The buyer has their place; look up the card in gift_cards and decide whether to chase the difference.`,
    });
    return null;
  }
  return data;
}

// ---------------------------------------------------------------
// issuing a card after payment
// ---------------------------------------------------------------

export function isGiftSale(session) {
  return session?.metadata?.kind === "gift_card";
}

export async function onGiftSaleCompleted(session) {
  const { data: already } = await db.from("gift_cards").select("id").eq("stripe_session_id", session.id).maybeSingle();
  if (already) return;

  const m = session.metadata || {};
  const details = session.customer_details || {};
  const expires = new Date();
  expires.setUTCMonth(expires.getUTCMonth() + GIFT_MONTHS);

  const row = {
    code: newCode(),
    token: newToken(),
    amount_cents: Number(m.amount_cents),
    balance_cents: Number(m.amount_cents),
    currency: String(m.currency || session.currency || "EUR").toUpperCase(),
    expires_at: expires.toISOString(),
    buyer_name: m.from_name || details.name || null,
    buyer_email: details.email,
    recipient_name: m.recipient_name || null,
    recipient_email: m.recipient_email || null,
    message: m.message || null,
    send_on: m.send_on || null,
    stripe_session_id: session.id,
    stripe_customer_id: session.customer || null,
  };

  let card = null;
  for (let i = 0; i < 3 && !card; i++) {
    const { data, error } = await db.from("gift_cards").insert(row).select().single();
    if (!error) { card = data; break; }
    if (error.code === "23505" && /stripe_session_id/.test(error.message)) return; // a redelivery beat us to it
    if (error.code !== "23505") throw error;
    row.code = newCode();
    row.token = newToken();
  }
  if (!card) throw new Error("Could not issue a unique gift card code");

  await sendBuyerEmail(card);

  // Straight to the recipient if they gave an address and no later
  // date; otherwise the daily sender picks it up on the day.
  const today = new Date().toISOString().slice(0, 10);
  if (card.recipient_email && (!card.send_on || card.send_on <= today)) {
    await sendRecipientEmail(card);
  }

  await sendMail({
    to: OFFICE,
    subject: `[BirdBox] Gift card sold — ${money(card.amount_cents, card.currency)}`,
    text: `${card.buyer_name || card.buyer_email} bought a ${money(card.amount_cents, card.currency)} gift card` +
      (card.recipient_name ? ` for ${card.recipient_name}` : "") + `.\n\nCode: ${card.code}\n` +
      (card.recipient_email ? `Goes to ${card.recipient_email}` + (card.send_on && card.send_on > today ? ` on ${niceDate(card.send_on)}` : " now") + ".\n" : "The buyer is passing it on themselves.\n") +
      `Expires ${niceDate(card.expires_at)}.\nCard: ${cardUrl(card)}`,
  });
}

export function cardUrl(card) {
  return `${SITE_URL}/gift/card/?t=${card.token}`;
}

function emailShell(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f4f2ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16181b">
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
<img src="${SITE_URL}/brand/birdbox-email-header.png" alt="BirdBox Coaching" width="560" style="display:block;width:100%;max-width:560px;height:auto;margin:0 0 20px">
${inner}
<p style="font-size:13px;color:#6b6f75;margin:28px 0 0">BirdBox Coaching · <a href="mailto:${OFFICE}" style="color:#6b6f75">${OFFICE}</a></p>
</div></body></html>`;
}

// The same card as the Shop, /gift/ and the printable card: black, silver
// logo, gold amount, "BirdBox Coaching", the four course colours down the
// right edge. Fixed at real card proportions (85.6 x 54 mm, so 300 x 189
// px, narrow enough for a phone) and centred, so it looks like a card rather than a banner. Tables
// with fixed sizes, because email clients ignore most CSS layout.
function cardBlock(card) {
  const W = 300, H = 189, BAR = 13;
  const bar = (c, h) => `<tr><td style="background:${c};height:${h}px;font-size:0;line-height:0">&nbsp;</td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:22px 0;border-collapse:separate">
<tr><td style="background:#F3EFE8;padding:24px 10px;border-radius:10px" align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="${W}" height="${H}" style="width:${W}px;height:${H}px;background:#16181b;border-radius:12px;border-collapse:separate;overflow:hidden">
<tr>
<td width="${W - BAR}" height="${H}" style="width:${W - BAR}px;height:${H}px;padding:0;vertical-align:top;color:#fff">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%">
<tr>
<td height="92" style="height:92px;padding:16px 0 0 18px;vertical-align:top"><img src="${SITE_URL}/brand/birdBox-silver.png" alt="BirdBox" width="52" style="display:block;width:52px;height:auto"></td>
<td style="padding:18px 16px 0 0;vertical-align:top;text-align:right;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#9aa1a9">Gift card</td>
</tr>
<tr><td colspan="2" style="padding:4px 18px 0">
<div style="font-size:38px;font-weight:800;line-height:1;color:#c9a24a">${esc(money(card.amount_cents, card.currency))}</div>
<div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#9aa1a9;margin-top:8px">BirdBox Coaching</div>
</td></tr>
</table>
</td>
<td width="${BAR}" style="width:${BAR}px;padding:0;vertical-align:top"><table role="presentation" cellpadding="0" cellspacing="0" width="${BAR}">${bar("#85151A", 47)}${bar("#298DE9", 47)}${bar("#10502C", 47)}${bar("#F1A509", 48)}</table></td>
</tr></table>
<table role="presentation" cellpadding="0" cellspacing="0" width="${W}" style="width:${W}px;margin-top:16px"><tr>
<td style="font-size:12px;color:#6b6f75;text-align:left">Code</td><td style="font-size:12px;color:#6b6f75;text-align:right">Valid until</td></tr><tr>
<td style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:17px;font-weight:700;letter-spacing:.04em;color:#16181b;text-align:left">${esc(card.code)}</td>
<td style="font-size:14px;color:#16181b;text-align:right">${esc(niceDate(card.expires_at))}</td></tr></table>
</td></tr></table>`;
}

function howToUse(card) {
  return `Use it on any BirdBox seminar or online course priced in ${card.currency}: choose the course on ${SITE_URL.replace(/^https?:\/\//, "")}, enter the code at checkout ("Have a discount code or gift card?" on seminars, "Have a gift card?" on online courses), and the card pays towards the price. If the course costs less than the card, the rest stays on the card for next time.`;
}

const button = (href, label) =>
  `<a href="${href}" style="display:inline-block;background:#16181b;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:6px">${label}</a>`;

export async function sendBuyerEmail(card) {
  const to = card.recipient_email;
  const later = to && card.send_on && card.send_on > new Date().toISOString().slice(0, 10);
  const whatHappens = !to
    ? "Here it is to pass on however you like. Open the printable card below to print it or save it as a PDF."
    : later
      ? `We will email it to ${card.recipient_name || to} on ${niceDate(card.send_on)}. A copy is below in case you would also like to print it.`
      : `We have emailed it to ${card.recipient_name || to} just now. A copy is below in case you would also like to print it.`;

  const html = emailShell(`
<p>Hi ${esc((card.buyer_name || "").split(" ")[0] || "there")},</p>
<p>Thank you for buying a BirdBox Coaching gift card${card.recipient_name ? " for " + esc(card.recipient_name) : ""}. ${esc(whatHappens)}</p>
${cardBlock(card)}
<p>${button(cardUrl(card), "Open the printable card")}</p>
<p style="font-size:14px;color:#4a4e54">${esc(howToUse(card))}</p>
<p style="font-size:14px;color:#4a4e54">Your receipt from Stripe comes separately.</p>`);

  const text = [
    `Hi ${(card.buyer_name || "").split(" ")[0] || "there"},`, "",
    `Thank you for buying a BirdBox Coaching gift card${card.recipient_name ? " for " + card.recipient_name : ""}. ${whatHappens}`, "",
    `Amount: ${money(card.amount_cents, card.currency)}`, `Code: ${card.code}`, `Valid until: ${niceDate(card.expires_at)}`, "",
    `Printable card: ${cardUrl(card)}`, "", howToUse(card),
  ].join("\n");

  await sendMail({ to: card.buyer_email, subject: "Your BirdBox Coaching gift card", html, text });
}

export async function sendRecipientEmail(card) {
  if (!card.recipient_email) return false;
  const from = card.buyer_name || "Someone";
  const html = emailShell(`
<p>Hi ${esc(card.recipient_name || "there")},</p>
<p>${esc(from)} has sent you a BirdBox Coaching gift card.</p>
${card.message ? `<blockquote style="margin:18px 0;padding:4px 0 4px 16px;border-left:3px solid #c9ccd0;color:#33363a;white-space:pre-line">${esc(card.message)}</blockquote>` : ""}
${cardBlock(card)}
<p>${button(cardUrl(card), "Open your gift card")}</p>
<p style="font-size:14px;color:#4a4e54">${esc(howToUse(card))}</p>
<p style="font-size:14px;color:#4a4e54">${button(SITE_URL + "/seminars/", "Browse seminars")}&nbsp; ${button(SITE_URL + "/", "All courses")}</p>`);

  const text = [
    `Hi ${card.recipient_name || "there"},`, "",
    `${from} has sent you a BirdBox Coaching gift card.`, "",
    ...(card.message ? [card.message, ""] : []),
    `Amount: ${money(card.amount_cents, card.currency)}`, `Code: ${card.code}`, `Valid until: ${niceDate(card.expires_at)}`, "",
    `Your card: ${cardUrl(card)}`, "", howToUse(card),
    "", `Seminars: ${SITE_URL}/seminars/`, `All courses: ${SITE_URL}/`,
  ].join("\n");

  const ok = await sendMail({
    to: card.recipient_email,
    subject: `${from} sent you a BirdBox Coaching gift card`,
    html, text, replyTo: card.buyer_email,
  });
  if (ok) await db.from("gift_cards").update({ sent_at: new Date().toISOString() }).eq("id", card.id);
  return ok;
}

// ---------------------------------------------------------------
// the reminder, 30 days before a card with money on it expires
// ---------------------------------------------------------------

// To whoever has the card: the recipient if we emailed it to someone,
// otherwise the buyer. Shows what is left, not what it started at.
export async function sendExpiryReminder(card) {
  const to = card.recipient_email || card.buyer_email;
  if (!to) return false;
  const first = card.recipient_email ? (card.recipient_name || "there") : ((card.buyer_name || "").split(" ")[0] || "there");
  const left = money(card.balance_cents, card.currency);
  const when = niceDate(card.expires_at);
  const shown = { ...card, amount_cents: card.balance_cents };

  const html = emailShell(`
<p>Hi ${esc(first)},</p>
<p>A reminder that your BirdBox Coaching gift card still has <b>${esc(left)}</b> on it, and it expires on <b>${esc(when)}</b>.</p>
${cardBlock(shown)}
<p>${button(cardUrl(card), "Open your gift card")}</p>
<p style="font-size:14px;color:#4a4e54">${esc(howToUse(card))}</p>
<p style="font-size:14px;color:#4a4e54">${button(SITE_URL + "/seminars/", "Browse seminars")}&nbsp; ${button(SITE_URL + "/", "All courses")}</p>`);

  const text = [
    `Hi ${first},`, "",
    `A reminder that your BirdBox Coaching gift card still has ${left} on it, and it expires on ${when}.`, "",
    `Code: ${card.code}`, `Your card: ${cardUrl(card)}`, "", howToUse(card), "",
    `Seminars: ${SITE_URL}/seminars/`, `All courses: ${SITE_URL}/`,
  ].join("\n");

  return sendMail({ to, subject: `Your BirdBox gift card has ${left} left, and expires on ${when}`, html, text });
}

