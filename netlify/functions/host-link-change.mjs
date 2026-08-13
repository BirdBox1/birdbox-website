// netlify/functions/host-link-change.mjs
//
// ONE-OFF: email every host of a live/published seminar to tell them the
// registration LINK has changed (old RegFox link -> new birdboxcoaching.com
// link). Creates NO discount codes and touches nothing else — hosts keep the
// codes they already have.
//
// Guarded by ?t=<HOST_BLAST_TOKEN>. DRY RUN by default (lists who would be
// emailed, sends nothing). Add &send=1 to actually send.
//
//   Preview:  /.netlify/functions/host-link-change?t=YOUR_TOKEN
//   Send:     /.netlify/functions/host-link-change?t=YOUR_TOKEN&send=1
//
// Env (already on Netlify): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   RESEND_API_KEY, SITE_URL, ALERT_FROM. New: HOST_BLAST_TOKEN (you set it).
//
// Safe to delete this file (and the HOST_BLAST_TOKEN env var) once the
// one-off send is done.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const TOKEN = process.env.HOST_BLAST_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const OFFICE = "info@birdboxcoaching.com";
const SITE = (process.env.SITE_URL || "https://birdboxcoaching.com").replace(/\/+$/, "");

export default async (request) => {
  const url = new URL(request.url);
  if (!TOKEN || url.searchParams.get("t") !== TOKEN) {
    return new Response("forbidden", { status: 403 });
  }
  const send = url.searchParams.get("send") === "1";

  const nowIso = new Date().toISOString();

  // Live/published seminars still in the future that have a host email.
  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, title, slug, city, country, venue_name, starts_at, ends_at, timezone, host_name, host_email, status, archived, type")
    .not("host_email", "is", null)
    .eq("status", "published")
    .eq("archived", false)
    .gt("starts_at", nowIso)
    .order("starts_at", { ascending: true });

  if (error) return json({ error: error.message }, 500);

  // Lead coach per course (to CC them), fetched in one go.
  const PA = "sarah@birdboxcoaching.com";
  const leadEmail = {};
  const courseIds = (courses || []).map((c) => c.id);
  if (courseIds.length) {
    const { data: leads } = await supabase
      .from("course_staff")
      .select("course_id, role, staff ( email )")
      .in("course_id", courseIds)
      .eq("role", "lead_coach");
    for (const r of leads || []) {
      if (r.staff && r.staff.email) leadEmail[r.course_id] = r.staff.email;
    }
  }

  const results = [];
  for (const c of courses || []) {
    const to = String(c.host_email || "").trim();
    if (!to || !to.includes("@")) {
      results.push({ course: c.title, host: c.host_name, skipped: "no valid host email" });
      continue;
    }

    const link = `${SITE}/c/${c.slug}/`;
    const first = String(c.host_name || "there").split(" ")[0];
    const dates = fmtDates(c);

    // CC the PA on every one, and the lead coach if this course has one.
    // Never CC an address that is already the recipient.
    const cc = [];
    const addCc = (addr) => {
      if (!addr) return;
      const a = String(addr).trim();
      if (!a || a.toLowerCase() === to.toLowerCase()) return;
      if (!cc.some((x) => x.toLowerCase() === a.toLowerCase())) cc.push(a);
    };
    addCc(PA);
    addCc(leadEmail[c.id]);

    const record = { course: c.title, city: c.city, host: c.host_name, to, cc, dates, link };

    if (!send) {
      results.push({ ...record, action: "DRY RUN — nothing sent" });
      continue;
    }

    try {
      await sendEmail({ to, cc, first, title: c.title, city: c.city, dates, link });
      results.push({ ...record, sent: true });
    } catch (err) {
      results.push({ ...record, sent: false, error: err.message });
    }
  }

  return json({
    mode: send ? "SENT" : "DRY RUN (nothing sent — add &send=1 to send)",
    count: results.length,
    results,
  });
};

// --------------------------------------------------------------------------

function fmtDate(iso, tz) {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "long", year: "numeric",
    timeZone: tz || "UTC",
  });
}

function fmtDates(c) {
  const s = fmtDate(c.starts_at, c.timezone);
  if (c.ends_at) {
    const e = fmtDate(c.ends_at, c.timezone);
    if (e !== s) return `${s} to ${e}`;
  }
  return s;
}

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sendEmail({ to, cc, first, title, city, dates, link }) {
  if (!RESEND_API_KEY) throw new Error("No RESEND_API_KEY set");

  const where = city ? ` in ${city}` : "";
  const subject = `Your ${title} registration link has changed`;

  const text =
`Hey ${first},

A quick but important update from our end. We've moved BirdBox onto a new registration and payment system — and your seminar has come with us. ${title}${where} on ${dates} is still live and still selling, now on our new website.

The one thing that's changed is the registration link. The link you were given when we first set this up no longer works — so anywhere you've shared it (your socials, your gym's page, messages to members), it needs swapping for the new one below.

Your new registration link:
${link}

Your host codes haven't changed and still work on the new link.

Everything else stays the same. Any questions, just hit reply.

Thanks for hosting us,
Nathan Bird BSc, MSc, CSCS, CCFT
Founder BirdBox Coaching`;

  const html =
`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#16181b;max-width:560px;margin:0 auto">
  <p>Hey ${esc(first)},</p>
  <p>A quick but important update from our end. We've moved BirdBox onto a new registration and payment system — and your seminar has come with us. <strong>${esc(title)}</strong>${where ? " in " + esc(city) : ""} on ${esc(dates)} is still live and still selling, now on our new website.</p>
  <p>The one thing that's changed is the <strong>registration link</strong>. The link you were given when we first set this up no longer works — so anywhere you've shared it (your socials, your gym's page, messages to members), it needs swapping for the new one below.</p>
  <p style="margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:#16181b;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:5px">Your new registration link &rarr;</a></p>
  <p style="font-size:13px;color:#6c7178;word-break:break-all"><a href="${esc(link)}" style="color:#2f7fd0">${esc(link)}</a></p>
  <p>Your host codes haven't changed and still work on the new link.</p>
  <p>Everything else stays the same. Any questions, just hit reply.</p>
  <p>Thanks for hosting us,<br>Nathan Bird BSc, MSc, CSCS, CCFT<br>Founder BirdBox Coaching</p>
</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `BirdBox Coaching <${FROM}>`,
      to: [to],
      cc: (cc && cc.length) ? cc : undefined,
      reply_to: OFFICE,
      subject,
      text,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
