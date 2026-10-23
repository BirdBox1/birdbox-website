// netlify/functions/gift-card-view.mjs
//
// GET ?t=TOKEN -> what the printable card at /gift/card/ shows.
//
// The token is the long random one from the card's email link, not the
// code itself, so nobody can check balances by guessing codes here.

import { db, json } from "../lib/directory.mjs";

export default async (req) => {
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!/^[a-f0-9]{36}$/.test(t)) return json({ error: "This gift card link isn't complete" }, 400);

  const { data: card } = await db
    .from("gift_cards")
    .select("code, amount_cents, balance_cents, currency, expires_at, status, buyer_name, recipient_name, message")
    .eq("token", t)
    .maybeSingle();
  if (!card) return json({ error: "We couldn't find this gift card" }, 404);

  return json({
    code: card.code,
    amount_cents: card.amount_cents,
    balance_cents: card.balance_cents,
    currency: card.currency,
    expires_at: card.expires_at,
    active: card.status === "active" && new Date(card.expires_at) > new Date(),
    from_name: card.buyer_name,
    recipient_name: card.recipient_name,
    message: card.message,
  });
};
