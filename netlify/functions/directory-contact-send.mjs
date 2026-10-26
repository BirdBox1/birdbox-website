// netlify/functions/directory-contact-send.mjs
//
// Every 5 minutes: emails Trainer Directory contact requests whose short
// wait is over (see directory-contact.mjs).
//
// The wait exists because a spammer messages several coaches in a row.
// Sending each one instantly meant the first two reached coaches before
// the "several coaches" rule could catch the third. Now, just before a
// request is sent, the sender is checked again: if they have reached
// SPREAD_LIMIT coaches in a day, or been blocked since, everything of
// theirs still waiting is held for the office instead.

import { db, PROFILE_FIELDS } from "../lib/directory.mjs";
import { emailCoach, coachesContacted, holdQueued, SPREAD_LIMIT } from "./directory-contact.mjs";

const LOOKING_FOR = {
  personal: "Coaching for myself", online: "Online coaching", join: "Joining a gym", other: "Something else",
};

export default async () => {
  const now = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 86400e3).toISOString();
  const { data: due, error } = await db.from("directory_contact_requests")
    .select("id, profile_id, name, email, phone, looking_for, message, ip_hash, created_at")
    .eq("status", "queued").lte("send_after", now).order("created_at").limit(50);
  if (error) { console.error("directory-contact-send:", error.message); return; }

  let sent = 0, held = 0;
  for (const r of due || []) {
    // Still queued? An earlier one in this run may have held it.
    const { data: still } = await db.from("directory_contact_requests").select("status").eq("id", r.id).maybeSingle();
    if (!still || still.status !== "queued") continue;

    const blockedQ = db.from("directory_blocked_senders").select("id").limit(1);
    const { data: blocked } = r.ip_hash
      ? await blockedQ.or(`email.eq.${JSON.stringify(r.email)},ip_hash.eq.${r.ip_hash}`)
      : await blockedQ.eq("email", r.email);
    if (blocked && blocked.length) {
      await holdQueued(r.email, r.ip_hash, "Sender was reported or blocked");
      held++; continue;
    }

    const coaches = await coachesContacted(r.email, r.ip_hash, dayAgo);
    if (coaches.size >= SPREAD_LIMIT) {
      await holdQueued(r.email, r.ip_hash, `Contacting several coaches (${coaches.size} today)`);
      held++; continue;
    }

    const { data: p } = await db.from("directory_profiles").select(PROFILE_FIELDS).eq("id", r.profile_id).maybeSingle();
    if (!p || !p.visible || p.hidden_at) {
      await db.from("directory_contact_requests").update({ status: "held", hold_reason: "Coach no longer listed", send_after: null }).eq("id", r.id);
      continue;
    }

    // Claim it before sending, so two runs can never email it twice.
    const { data: claimed } = await db.from("directory_contact_requests")
      .update({ status: "sent", send_after: null }).eq("id", r.id).eq("status", "queued").select("id");
    if (!claimed || !claimed.length) continue;

    const ok = await emailCoach(p, r.id, {
      name: r.name, email: r.email, phone: r.phone, lookingFor: LOOKING_FOR[r.looking_for] || "—", message: r.message,
    });
    if (ok) { await db.from("directory_contact_requests").update({ emailed: true }).eq("id", r.id); sent++; }
    else console.error("directory-contact-send: email failed for request", r.id);
  }
  if (sent || held) console.log(`directory-contact-send: sent ${sent}, held ${held}`);
};

export const config = { schedule: "*/5 * * * *" };
