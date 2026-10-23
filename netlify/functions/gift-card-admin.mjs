// netlify/functions/gift-card-admin.mjs
//
// The office side of gift cards, for /portal/gift-cards/. Admins only.
//
// GET ?q=anna                         -> { cards: [...] }  find by code, name or email
// POST { action: "resend", id, to }   email the card again. to = "recipient",
//                                     "buyer", or an email address
// POST { action: "top_up", id, amount, note }
//                                     add money to a card (a refund, a seminar
//                                     that was cancelled), in whole units
// POST { action: "cancel", id, note } the code stops working
// POST { action: "reactivate", id }   a cancelled card works again
//
// Everything done here is written to gift_card_events with who did it.

import { db, json, userFrom } from "../lib/directory.mjs";
import { sendRecipientEmail, sendBuyerEmail, money } from "../lib/gift-cards.mjs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELDS = "id, code, token, amount_cents, balance_cents, currency, expires_at, status, buyer_name, buyer_email, " +
  "recipient_name, recipient_email, message, send_on, sent_at, created_at, expiry_reminded_at";

export default async (req) => {
  const user = await userFrom(req);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const { data: staff } = await db.from("staff").select("id, role, active, email").eq("id", user.id).maybeSingle();
  if (!staff || !staff.active || staff.role !== "admin") return json({ error: "Admins only." }, 403);
  const by = staff.email || user.email || "admin";

  try {
    if (req.method === "GET") return json({ cards: await find(new URL(req.url).searchParams.get("q") || "") });
    if (req.method !== "POST") return json({ error: "Use GET or POST" }, 405);

    const b = await req.json().catch(() => ({}));
    const { data: card } = await db.from("gift_cards").select(FIELDS).eq("id", b.id).maybeSingle();
    if (!card) return json({ error: "Card not found." }, 404);
    const log = (kind, extra = {}) => db.from("gift_card_events").insert({ gift_card_id: card.id, kind, by_email: by, ...extra });

    if (b.action === "resend") {
      let ok;
      if (b.to === "buyer") {
        ok = await sendBuyerEmail(card);
      } else {
        const to = b.to === "recipient" ? card.recipient_email : String(b.to || "").trim().toLowerCase();
        if (!to || !EMAIL.test(to)) return json({ error: "There is no email to send it to." }, 400);
        ok = await sendRecipientEmail({ ...card, recipient_email: to });
        // Sent somewhere new: remember it, so the reminder goes there too.
        if (ok && b.to !== "recipient") await db.from("gift_cards").update({ recipient_email: to }).eq("id", card.id);
      }
      if (!ok) return json({ error: "The email could not be sent. Try again in a minute." }, 502);
      await log("resend", { note: b.to === "buyer" ? "to buyer " + card.buyer_email : "to " + (b.to === "recipient" ? card.recipient_email : b.to) });
      return json({ ok: true, card: await one(card.id) });
    }

    if (b.action === "top_up") {
      const cents = Math.round(Number(b.amount) * 100);
      if (!(cents > 0) || cents > 500000) return json({ error: "Enter an amount, e.g. 50." }, 400);
      const { error } = await db.rpc("top_up_gift_card", { p_card: card.id, p_cents: cents, p_note: String(b.note || "").slice(0, 300) || null, p_by: by });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, card: await one(card.id), message: `${money(cents, card.currency)} added.` });
    }

    if (b.action === "cancel" || b.action === "reactivate") {
      const status = b.action === "cancel" ? "void" : "active";
      await db.from("gift_cards").update({ status }).eq("id", card.id);
      await log(b.action, { note: String(b.note || "").slice(0, 300) || null });
      return json({ ok: true, card: await one(card.id) });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("gift-card-admin failed:", err);
    return json({ error: err.message || "Something went wrong" }, 500);
  }
};

async function find(q) {
  const term = String(q).trim().replace(/[%,()]/g, " ").trim();
  let query = db.from("gift_cards").select(FIELDS).order("created_at", { ascending: false }).limit(50);
  if (term) {
    const like = `%${term}%`;
    query = query.or(`code.ilike.${like},buyer_name.ilike.${like},buyer_email.ilike.${like},recipient_name.ilike.${like},recipient_email.ilike.${like}`);
  }
  const { data: cards, error } = await query;
  if (error) throw error;
  return withHistory(cards || []);
}

async function one(id) {
  const { data } = await db.from("gift_cards").select(FIELDS).eq("id", id).single();
  return (await withHistory([data]))[0];
}

// Each card with what has happened to it: uses and office actions, newest first.
async function withHistory(cards) {
  if (!cards.length) return [];
  const ids = cards.map((c) => c.id);
  const [{ data: uses }, { data: events }] = await Promise.all([
    db.from("gift_card_redemptions").select("gift_card_id, cents, used_for, created_at").in("gift_card_id", ids),
    db.from("gift_card_events").select("gift_card_id, kind, cents, note, by_email, created_at").in("gift_card_id", ids),
  ]);
  return cards.map((c) => ({
    ...c,
    history: [
      ...(uses || []).filter((u) => u.gift_card_id === c.id).map((u) => ({ at: u.created_at, kind: "used", cents: u.cents, note: u.used_for })),
      ...(events || []).filter((e) => e.gift_card_id === c.id).map((e) => ({ at: e.created_at, kind: e.kind, cents: e.cents, note: e.note, by: e.by_email })),
    ].sort((a, b) => b.at.localeCompare(a.at)),
  }));
}
