// netlify/functions/story-invite.mjs
//
// Sends each participant the link to their story overlay 30 minutes
// before their course is due to finish, while everyone is still in
// the room together.
//
// Runs every ten minutes and looks for courses inside the last half
// hour, so a course is caught within ten minutes of its mark. The
// window is a full 30 minutes wide, which means a run that fails is
// picked up by the next one rather than missed entirely.
//
// Every send is written to course_emails with kind 'story', so nobody
// is emailed twice and there is a record of what went out.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const OFFICE = "info@birdboxcoaching.com";
const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const SITE_URL = (process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app")
  .replace(/\/+$/, "");

const MINUTES_BEFORE_END = 30;

export default async () => {
  try {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + MINUTES_BEFORE_END * 60000);

    // Courses finishing within the next half hour, and not already
    // finished. Anything without an end time is skipped: there is no
    // way to know when to send.
    const { data: courses, error: cErr } = await supabase
      .from("courses")
      .select("id, slug, title, type, ends_at, status, archived")
      .eq("archived", false)
      .neq("status", "cancelled")
      .not("ends_at", "is", null)
      .gt("ends_at", now.toISOString())
      .lte("ends_at", windowEnd.toISOString());

    if (cErr) throw new Error("courses: " + cErr.message);
    if (!courses || !courses.length) return done("no courses finishing shortly");

    const ids = courses.map((c) => c.id);

    const { data: template, error: tErr } = await supabase
      .from("email_templates")
      .select("subject, body")
      .eq("kind", "story")
      .eq("language", "en")
      .maybeSingle();

    if (tErr) throw new Error("template: " + tErr.message);
    if (!template) return done("no story template set up — nothing sent");

    // Anyone still on the course. Attendance is often not ticked until
    // afterwards, so filtering on it here would send to nobody.
    const { data: regs, error: rErr } = await supabase
      .from("registrations")
      .select("id, course_id, first_name, email, status, payment_status")
      .in("course_id", ids);

    if (rErr) throw new Error("registrations: " + rErr.message);

    const active = (regs || []).filter(
      (r) => (r.status || "active") === "active" &&
             r.payment_status !== "refunded" &&
             r.payment_status !== "failed" &&
             r.email
    );
    if (!active.length) return done("nobody to send to");

    // Who has had it already.
    const { data: already, error: eErr } = await supabase
      .from("course_emails")
      .select("registration_id")
      .in("course_id", ids)
      .eq("kind", "story");

    if (eErr) throw new Error("course_emails: " + eErr.message);
    const done_ = new Set((already || []).map((r) => r.registration_id));

    const byCourse = Object.fromEntries(courses.map((c) => [c.id, c]));

    let sent = 0;
    let failed = 0;

    for (const r of active) {
      if (done_.has(r.id)) continue;
      const course = byCourse[r.course_id];
      if (!course) continue;

      const fields = {
        first_name: r.first_name || "there",
        course_title: course.title || "your course",
        story_url: `${SITE_URL}/story/?c=${encodeURIComponent(course.slug)}`,
      };

      const subject = fill(template.subject || "Share your course", fields);
      const body = fill(template.body, fields);

      const ok = await sendEmail(r.email, subject, body);
      if (ok) sent++; else failed++;

      // Written whether or not it sent, so a hard failure is visible
      // and nobody gets a second attempt at the same email.
      const { error: insErr } = await supabase.from("course_emails").insert({
        course_id: course.id,
        registration_id: r.id,
        kind: "story",
        subject,
        body,
        status: ok ? "sent" : "failed",
        sent_at: new Date().toISOString(),
        send_error: ok ? null : "The email was rejected",
      });
      if (insErr) console.error("Could not record story email:", insErr.message);
    }

    return done(`${sent} sent` + (failed ? `, ${failed} failed` : ""));
  } catch (err) {
    console.error("story-invite failed:", err);
    return new Response("error", { status: 500 });
  }
};

function fill(text, fields) {
  let out = String(text);
  for (const [key, value] of Object.entries(fields)) {
    out = out.replace(new RegExp("\\{\\{\\s*" + key + "\\s*\\}\\}", "gi"), value);
  }
  return out;
}

async function sendEmail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("No Resend key; story link not sent to", to); return false; }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox Coaching <${FROM}>`,
        to: [to],
        reply_to: OFFICE,
        subject,
        text,
      }),
    });
    if (!res.ok) {
      console.error("Resend rejected story link for", to, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Could not send story link to", to, err.message);
    return false;
  }
}

function done(note) {
  console.log("story-invite:", note);
  return new Response("ok", { status: 200 });
}

// Every ten minutes, so the send lands close to the half-hour mark.
export const config = { schedule: "*/10 * * * *" };
