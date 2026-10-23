// netlify/functions/gift-card-reminders.mjs
//
// Every morning: a card that still has money on it and expires within the
// next 30 days gets one reminder email (sendExpiryReminder in
// netlify/lib/gift-cards.mjs), to the recipient if we emailed it to
// someone, otherwise the buyer. expiry_reminded_at stops a second one.

import { db, OFFICE, sendMail } from "../lib/directory.mjs";
import { sendExpiryReminder, money, niceDate } from "../lib/gift-cards.mjs";

const DAYS = 30;

export default async () => {
  const now = new Date();
  const until = new Date(now.getTime() + DAYS * 86400000);
  const { data: due, error } = await db
    .from("gift_cards")
    .select("*")
    .eq("status", "active")
    .gt("balance_cents", 0)
    .is("expiry_reminded_at", null)
    .gt("expires_at", now.toISOString())
    .lte("expires_at", until.toISOString())
    .limit(100);

  if (error) {
    console.error("gift-card-reminders could not read cards:", error.message);
    return new Response("error", { status: 500 });
  }

  const sent = [];
  for (const card of due || []) {
    if (await sendExpiryReminder(card)) {
      await db.from("gift_cards").update({ expiry_reminded_at: new Date().toISOString() }).eq("id", card.id);
      sent.push(`${card.code}: ${money(card.balance_cents, card.currency)} left, expires ${niceDate(card.expires_at)}`);
    }
  }
  if (sent.length) {
    await sendMail({
      to: OFFICE,
      subject: `[BirdBox] Gift card expiry reminders sent (${sent.length})`,
      text: "These gift cards expire within 30 days and their holders have been reminded:\n\n" + sent.join("\n"),
    });
  }
  console.log(`gift-card-reminders: ${sent.length} of ${(due || []).length} sent`);
  return new Response("ok");
};

// 08:00 UTC, after the 07:00 gift card sends.
export const config = { schedule: "0 8 * * *" };
