// netlify/functions/gift-card-send.mjs
//
// Every morning: emails the gift cards whose buyer chose a later send
// date (a birthday, Christmas morning) and whose day has come. Cards
// for today are sent by the webhook straight after payment, so this
// only ever picks up dated ones — or one whose first send failed.

import { db } from "../lib/directory.mjs";
import { sendRecipientEmail } from "../lib/gift-cards.mjs";

export default async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { data: due, error } = await db
    .from("gift_cards")
    .select("*")
    .is("sent_at", null)
    .not("recipient_email", "is", null)
    .eq("status", "active")
    .or(`send_on.is.null,send_on.lte.${today}`)
    .limit(100);

  if (error) {
    console.error("gift-card-send could not read cards:", error.message);
    return new Response("error", { status: 500 });
  }

  let sent = 0;
  for (const card of due || []) {
    if (await sendRecipientEmail(card)) sent++;
  }
  console.log(`gift-card-send: ${sent} of ${(due || []).length} sent`);
  return new Response("ok");
};

// 07:00 UTC — morning across Europe, the night before in the Americas.
export const config = { schedule: "0 7 * * *" };
