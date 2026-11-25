// netlify/functions/flag-alerts.mjs
//
// Flagged people (Nathan, 25 Nov 2026). Someone with an unpaid balance is
// not blocked: database triggers note every time they book, buy, sign up,
// apply or log in (public.flag_events), and this sweep emails the office
// about anything new, every 15 minutes. One email per person per sweep.
// The person sees nothing different.

import { db, sendMail, esc, OFFICE } from "../lib/directory.mjs";

const SOURCE = {
  "public.registrations": "booked a seminar",
  "public.abandoned_checkouts": "started a checkout",
  "public.course_payments": "made a seminar payment",
  "public.online_sales": "bought an online course",
  "public.online_invoices": "asked for an online course invoice",
  "public.learn_enrolments": "was enrolled on an online course",
  "public.learn_invites": "was invited to BirdBox Learn",
  "public.learn_all_access": "was given Learn all-access",
  "public.learn_mentorships": "joined a mentorship",
  "public.mentor_bookings": "booked a mentor call",
  "public.directory_profiles": "made a Trainer Directory listing",
  "public.directory_contact_requests": "used the Trainer Directory contact form",
  "public.email_signups": "signed up by email",
  "public.interest_signups": "registered interest",
  "public.quiz_responses": "took a quiz",
  "public.gift_cards": "bought or was sent a gift card",
  "public.hoodie_claims": "claimed a hoodie",
  "public.staff_pathway_applications": "applied to the Staff Pathway",
  "public.programming_applications": "applied for programming",
  "train.applications": "applied for 1:1 programming",
  "train.athletes": "was added as a programming athlete",
  "train.move_offers": "was sent a move-over offer",
  "auth.users": "made a BirdBox account",
};

function what(e) {
  if (e.action === "login") return "logged in";
  return SOURCE[e.source] || `appeared in ${e.source}`;
}

function when(iso) {
  return new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", dateStyle: "medium", timeStyle: "short" });
}

export default async () => {
  const { data: events, error } = await db.from("flag_events")
    .select("id, flagged_id, matched_on, source, action, detail, at, flagged_people(full_name, email, reason)")
    .is("emailed_at", null).order("at").limit(200);
  if (error) { console.error("flag-alerts could not read events:", error.message); return; }
  if (!events?.length) return;

  const byPerson = new Map();
  for (const e of events) {
    if (!byPerson.has(e.flagged_id)) byPerson.set(e.flagged_id, []);
    byPerson.get(e.flagged_id).push(e);
  }

  for (const list of byPerson.values()) {
    const p = list[0].flagged_people || {};
    const rows = list.map((e) => {
      const d = e.detail || {};
      const used = d.email || d.payer_email || d.buyer_email || d.recipient_email || d.mentee_email || "";
      const how = e.matched_on === "name" ? ` (matched on name; email used: ${used || "none"})` : "";
      return { text: `- ${when(e.at)}: ${what(e)}${how}`, html: `<li>${esc(when(e.at))}: ${esc(what(e))}${esc(how)}</li>` };
    });
    const subject = `Flagged: ${p.full_name} ${what(list[list.length - 1])}`;
    const text = [
      `${p.full_name} (${p.email || "no email on file"}) is on the flag list.`,
      `Reason: ${p.reason}`, "", ...rows.map((r) => r.text), "",
      "Nothing has been blocked. Decide what to do, then reply here or tell Claude.",
    ].join("\n");
    const html = `<p><strong>${esc(p.full_name)}</strong> (${esc(p.email || "no email on file")}) is on the flag list.</p>
<p>Reason: ${esc(p.reason)}</p><ul>${rows.map((r) => r.html).join("")}</ul>
<p>Nothing has been blocked. Decide what to do, then reply here or tell Claude.</p>`;
    const sent = await sendMail({ to: OFFICE, subject, text, html });
    if (sent) {
      await db.from("flag_events").update({ emailed_at: new Date().toISOString() }).in("id", list.map((e) => e.id));
    }
  }
};

export const config = { schedule: "*/15 * * * *" };
