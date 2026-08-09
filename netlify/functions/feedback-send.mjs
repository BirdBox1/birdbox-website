// netlify/functions/feedback-send.mjs
//
// Sends the approved feedback emails for one course.
//
//   POST { courseId }
//
// Each participant gets one email addressed only to them, sent from
// the lead coach with info@ copied in. Nobody is ever in a position
// to see anyone else's feedback.
//
// The body is sent exactly as it stands. The approved passages are
// written into the email while it is being drafted, in the place in
// the argument where they belong, so there is nothing to add here.
// This function used to staple them to the end, which read as a
// handout bolted onto a letter.
//
// The banner carries the brand of the course the feedback is for: a
// TGC seminar arrives under the TGC mark, a TCC seminar under TCC.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Where we may send as the coach's own address, because the domain
// is verified in Resend. Anything else falls back to the shared
// sending address with the coach's name on it.
const VERIFIED_DOMAINS = ["birdboxcoaching.com"];

const FALLBACK_FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const OFFICE = "info@birdboxcoaching.com";

// An email cannot resolve a relative path, so the brand marks need an
// absolute origin. Set SITE_URL in Netlify to the live domain; the
// default keeps the current deploy working until that happens.
const SITE_URL =
  (process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app").replace(/\/+$/, "");

// The marks are black lettering on transparent, so they sit on a
// white banner rather than the dark one used elsewhere. They are
// never recoloured.
const BRAND_MARKS = {
  tcc:     { file: "tcc.png",     alt: "The Coaches Course" },
  tgc:     { file: "tgc.png",     alt: "The Gymnastics Course" },
  tec:     { file: "tec.png",     alt: "The Endurance Course" },
  twc:     { file: "twc.png",     alt: "The Weightlifting Course" },
  birdbox: { file: "birdBox.png", alt: "BirdBox Coaching" },
};

function brandMark(brand) {
  const key = String(brand || "").toLowerCase();
  return BRAND_MARKS[key] || BRAND_MARKS.birdbox;
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const staff = await requireStaff(req);
    if (!staff) return json({ error: "Not authorised" }, 401);

    const { courseId } = await req.json();
    if (!courseId) return json({ error: "Missing course" }, 400);

    if (!(await isLeadOrAdmin(staff, courseId))) {
      return json({ error: "Only the lead coach can send feedback" }, 403);
    }

    const { data: course } = await supabase
      .from("courses")
      .select("id, title, brand, level, city, country, starts_at, currency, language")
      .eq("id", courseId)
      .single();

    if (!course) return json({ error: "Course not found" }, 404);

    // Only what has actually been read and checked.
    const { data: drafts } = await supabase
      .from("feedback_drafts")
      .select("id, registration_id, subject, body, status")
      .eq("course_id", courseId)
      .eq("status", "approved");

    if (!drafts || !drafts.length) {
      return json({ error: "Nothing has been checked yet." }, 409);
    }

    const { data: regs } = await supabase
      .from("registrations")
      .select("id, first_name, last_name, email")
      .in("id", drafts.map((d) => d.registration_id));

    const byId = {};
    for (const r of regs || []) byId[r.id] = r;

    const sender = senderFor(staff);

    let sent = 0;
    let failed = 0;
    const problems = [];

    for (const d of drafts) {
      const reg = byId[d.registration_id];
      if (!reg || !reg.email) {
        failed++;
        problems.push(`${reg ? reg.first_name : "Unknown"}: no email address`);
        await supabase.from("feedback_drafts")
          .update({ send_error: "No email address" }).eq("id", d.id);
        continue;
      }

      // Exactly what the coach read and checked. Nothing is added.
      const full = String(d.body || "").trim();

      if (!full) {
        failed++;
        problems.push(`${reg.first_name} ${reg.last_name}: the draft is empty`);
        await supabase.from("feedback_drafts")
          .update({ send_error: "The draft was empty, so nothing was sent." })
          .eq("id", d.id);
        continue;
      }

      const ok = await sendEmail({
        to: reg.email,
        sender,
        subject: d.subject || `Your feedback from ${course.title}`,
        text: full,
        brand: course.brand,
      });

      if (ok) {
        sent++;
        await supabase.from("feedback_drafts")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            send_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", d.id);
      } else {
        failed++;
        problems.push(`${reg.first_name} ${reg.last_name}: the email was rejected`);
        await supabase.from("feedback_drafts")
          .update({ send_error: "The email was rejected. Check the address." })
          .eq("id", d.id);
      }
    }

    await officeSummary(course, staff, sender, sent, failed, problems);

    return json({ ok: true, sent, failed, problems, sentAs: sender.from });
  } catch (err) {
    console.error("feedback-send failed:", err);
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

// ---------------------------------------------------------------
// who it comes from
// ---------------------------------------------------------------

// If the coach's domain is verified we send as them outright. If it
// is not, the shared address carries their name and their address is
// used for replies — which is where every reply should land either
// way, since they are the one who watched the participant move.
function senderFor(staff) {
  const email = (staff.email || "").trim().toLowerCase();
  const domain = email.split("@")[1] || "";
  const verified = VERIFIED_DOMAINS.includes(domain);

  return {
    from: verified
      ? `${staff.full_name} <${email}>`
      : `${staff.full_name} (BirdBox Coaching) <${FALLBACK_FROM}>`,
    replyTo: email || OFFICE,
    verified,
  };
}

// ---------------------------------------------------------------
// email
// ---------------------------------------------------------------

// A feedback email is a letter, not a marketing piece — paragraphs,
// nothing to click, nothing to distract.
//
// The banner is white because the brand marks are black lettering on
// a transparent background. On the dark banner used elsewhere they
// would simply not be visible, and recolouring them is not something
// we do.
function template(text, brand) {
  const mark = brandMark(brand);

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

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f3f0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f0">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:600px;background:#ffffff;border:1px solid #e0ddd7;border-radius:6px">
        <tr><td align="left" style="padding:22px 28px 18px;background:#ffffff;
                   border-bottom:1px solid #e0ddd7;border-radius:5px 5px 0 0">
          <img src="${SITE_URL}/brand/${mark.file}" alt="${escapeHtml(mark.alt)}"
               height="30" style="height:30px;width:auto;display:block;border:0;outline:none;
               text-decoration:none;-ms-interpolation-mode:bicubic">
        </td></tr>
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
        subject: `[BirdBox] Feedback sent: ${course.title}`,
        text:
          `${staff.full_name} sent feedback for ${course.title}.\n\n` +
          `Sent as: ${sender.from}\n` +
          `Replies go to: ${sender.replyTo}\n\n` +
          `Sent: ${sent}\nFailed: ${failed}\n` +
          (problems.length
            ? "\nNEEDS ATTENTION:\n" + problems.map((p) => "  " + p).join("\n")
            : ""),
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
