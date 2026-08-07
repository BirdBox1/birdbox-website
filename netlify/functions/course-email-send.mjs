// netlify/functions/course-email-send.mjs
//
// Sends a lead coach's emails to participants.
//
//   POST { emailId }                  the pre-course email, to everyone
//   POST { emailId, registrationId }  a welcome, to one person
//
// Each participant is emailed individually, from the lead coach, with
// info@ copied. Nobody ever appears in anyone else's To line.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Domains verified in Resend, where we may send as the coach.
const VERIFIED_DOMAINS = ["birdboxcoaching.com"];
const FALLBACK_FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const OFFICE = "info@birdboxcoaching.com";

// Logos have to be absolute URLs — an email client has no idea what
// site the message came from. Change this one line if the custom
// domain goes live.
const SITE_URL = (process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app")
  .replace(/\/+$/, "");

// The brand the participant actually registered for, so the email
// carries the right identity. Filenames are case-sensitive on Netlify.
const BRAND_LOGO = {
  tcc: { file: "tcc.png", alt: "The Coaches Course" },
  tgc: { file: "tgc.png", alt: "The Gymnastics Course" },
  tec: { file: "tec.png", alt: "The Endurance Course" },
  twc: { file: "twc.png", alt: "The Weightlifting Course" },
};

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const staff = await requireStaff(req);
    if (!staff) return json({ error: "Not authorised" }, 401);

    const { emailId, attendedOnly } = await req.json();
    if (!emailId) return json({ error: "Missing email" }, 400);

    const { data: email } = await supabase
      .from("course_emails")
      .select("id, course_id, registration_id, kind, subject, body, status")
      .eq("id", emailId)
      .single();

    if (!email) return json({ error: "Email not found" }, 404);
    if (email.status === "sent") return json({ error: "This has already been sent." }, 409);
    if (!email.body || !email.body.trim()) return json({ error: "There is nothing to send." }, 409);

    if (!(await isLeadOrAdmin(staff, email.course_id))) {
      return json({ error: "Only the lead coach can send to participants" }, 403);
    }

    const { data: course } = await supabase
      .from("courses")
      .select("id, brand, title, city, country, starts_at")
      .eq("id", email.course_id)
      .single();

    // A welcome goes to one person; the pre-course email to everyone
    // still on the course; the follow-up only to those who turned up.
    let people = [];
    if (email.registration_id) {
      const { data } = await supabase
        .from("registrations")
        .select("id, first_name, last_name, email, payment_status, status, attended")
        .eq("id", email.registration_id);
      people = data || [];
    } else {
      const { data } = await supabase
        .from("registrations")
        .select("id, first_name, last_name, email, payment_status, status, attended")
        .eq("course_id", email.course_id)
        .not("payment_status", "in", '("refunded","failed")')
        .order("last_name");

      // Somebody cancelled or archived is no longer on the course, so
      // they should not be hearing about it. Filtered here rather than
      // in the query because older rows have no status at all.
      people = (data || []).filter((r) => (r.status || "active") === "active");

      // The follow-up talks about putting the weekend into practice,
      // which reads badly to somebody who did not attend it.
      if (attendedOnly) people = people.filter((r) => r.attended === true);
    }

    if (!people.length) {
      return json({
        error: attendedOnly
          ? "Nobody on this course is ticked as attended."
          : "There is nobody to send to.",
      }, 409);
    }

    const sender = senderFor(staff);
    const brand = BRAND_LOGO[String(course.brand || "").toLowerCase()] || null;
    const subject = (email.subject || "").trim() ||
      (email.kind === "welcome"
        ? `Looking forward to seeing you at ${course.title}`
        : `${course.title} — this weekend`);

    let sent = 0;
    let failed = 0;
    const problems = [];

    for (const p of people) {
      if (!p.email) {
        failed++;
        problems.push(`${p.first_name} ${p.last_name}: no email address`);
        continue;
      }

      // Greet each person by name, whatever the body says.
      const text = personalise(email.body, p);

      const ok = await sendEmail({
        to: p.email,
        sender,
        subject,
        text,
        brand,
      });

      if (ok) sent++;
      else {
        failed++;
        problems.push(`${p.first_name} ${p.last_name}: the email was rejected`);
      }
    }

    await supabase.from("course_emails").update({
      status: failed && !sent ? "failed" : "sent",
      sent_at: new Date().toISOString(),
      sent_by: staff.id,
      send_error: problems.length ? problems.join("; ") : null,
      updated_at: new Date().toISOString(),
    }).eq("id", email.id);

    if (email.kind === "precourse") {
      await officeSummary(course, staff, sender, sent, failed, problems);
    }

    return json({ ok: true, sent, failed, problems, sentAs: sender.from });
  } catch (err) {
    console.error("course-email-send failed:", err);
    return json({ error: err.message || "Something went wrong" }, 500);
  }
};

// ---------------------------------------------------------------
// who is asking
// ---------------------------------------------------------------
async function requireStaff(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: staff } = await supabase
    .from("staff")
    .select("id, full_name, email, role, active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!staff || !staff.active) return null;
  return staff;
}

async function isLeadOrAdmin(staff, courseId) {
  if (staff.role === "admin") return true;
  const { data } = await supabase
    .from("course_staff")
    .select("role")
    .eq("course_id", courseId)
    .eq("staff_id", staff.id)
    .maybeSingle();
  return data?.role === "lead_coach";
}

function senderFor(staff) {
  const email = (staff.email || "").trim().toLowerCase();
  const domain = email.split("@")[1] || "";
  const verified = VERIFIED_DOMAINS.includes(domain);

  return {
    from: verified
      ? `${staff.full_name} <${email}>`
      : `${staff.full_name} (BirdBox Coaching) <${FALLBACK_FROM}>`,
    replyTo: email || OFFICE,
  };
}

// The body is written once with {{first_name}} where the greeting
// goes, so one draft still reads personally to each participant.
function personalise(body, person) {
  return String(body)
    .replace(/\{\{\s*first_name\s*\}\}/gi, person.first_name || "there")
    .replace(/\{\{\s*last_name\s*\}\}/gi, person.last_name || "")
    .replace(/\{\{\s*full_name\s*\}\}/gi,
      [person.first_name, person.last_name].filter(Boolean).join(" "));
}

// ---------------------------------------------------------------
// email
// ---------------------------------------------------------------

function template(text, brand) {
  const paras = String(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) =>
      `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#16181b">${
        escapeHtml(p).replace(/\n/g, "<br>")
      }</p>`
    )
    .join("");

  // The brand logo sits on its own white band under the black bar.
  // The marks are dark lettering, so they would disappear on black.
  const logoBand = brand
    ? `<tr><td style="padding:18px 28px 14px;border-bottom:1px solid #e0ddd7;background:#ffffff">
          <img src="${SITE_URL}/brand/${brand.file}" alt="${escapeHtml(brand.alt)}"
               height="44" style="height:44px;width:auto;display:block;border:0">
        </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f3f0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f0">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:600px;background:#ffffff;border:1px solid #e0ddd7;border-radius:6px">
        <tr><td style="padding:14px 28px;background:#0d0e10;border-radius:5px 5px 0 0">
          <span style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#9aa1a9;
                       font-family:Helvetica,Arial,sans-serif">BirdBox Coaching</span>
        </td></tr>
        ${logoBand}
        <tr><td style="padding:28px;font-family:Helvetica,Arial,sans-serif">${paras}</td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #e0ddd7;
                       font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6c7178">
          BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function sendEmail({ to, sender, subject, text, brand }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("No Resend key; not sending to", to); return false; }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender.from,
        to: [to],
        cc: [OFFICE],
        reply_to: sender.replyTo,
        subject,
        text,
        html: template(text, brand),
      }),
    });
    if (!res.ok) {
      console.error("Resend rejected", to, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Could not send to", to, err.message);
    return false;
  }
}

async function officeSummary(course, staff, sender, sent, failed, problems) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox <${FALLBACK_FROM}>`,
        to: [OFFICE],
        subject: `[BirdBox] Pre-course email sent: ${course.title}`,
        text:
          `${staff.full_name} sent the pre-course email for ${course.title}.\n\n` +
          `Sent as: ${sender.from}\nSent: ${sent}\nFailed: ${failed}\n` +
          (problems.length ? "\nNEEDS ATTENTION:\n" + problems.map((p) => "  " + p).join("\n") : ""),
      }),
    });
  } catch (err) {
    console.error("Could not send office summary:", err.message);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
