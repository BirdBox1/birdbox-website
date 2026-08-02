// netlify/functions/feedback-send.mjs
//
// Sends the approved feedback emails for one course.
//
//   POST { courseId }
//
// Each participant gets one email addressed only to them, sent from
// the lead coach with info@ copied in. Nobody is ever in a position
// to see anyone else's feedback.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const OFFICE = "info@birdboxcoaching.com";

// Dollar-priced courses get the US spelling of the philosophy block.
const US_CURRENCIES = ["USD", "CAD"];

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
      .select("id, registration_id, subject, body, blocks, status")
      .eq("course_id", courseId)
      .eq("status", "approved");

    if (!drafts || !drafts.length) {
      return json({ error: "Nothing has been checked yet." }, 409);
    }

    const { data: regs } = await supabase
      .from("registrations")
      .select("id, first_name, last_name, email, feedback_language")
      .in("id", drafts.map((d) => d.registration_id));

    const byId = {};
    for (const r of regs || []) byId[r.id] = r;

    const blockText = await loadBlocks(course);

    // The coach's own address, so a reply reaches the person who
    // watched them move.
    const replyTo = staff.email || OFFICE;

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

      // The written part, then any approved passages, word for word.
      const langue = reg.feedback_language || course.language || "en";
      const parts = [d.body.trim()];
      for (const key of d.blocks || []) {
        const text = blockText(key, langue);
        if (text) parts.push(text);
      }
      const full = parts.join("\n\n");

      const ok = await sendEmail({
        to: reg.email,
        replyTo,
        fromName: staff.full_name,
        subject: d.subject || `Your feedback from ${course.title}`,
        text: full,
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

    await officeSummary(course, staff, sent, failed, problems);

    return json({ ok: true, sent, failed, problems });
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
// the approved passages
// ---------------------------------------------------------------
async function loadBlocks(course) {
  const { data: blocks } = await supabase
    .from("email_blocks").select("key, body");
  const { data: translations } = await supabase
    .from("email_block_translations").select("key, language, body");

  const base = {};
  for (const b of blocks || []) base[b.key] = b.body;

  const byLang = {};
  for (const t of translations || []) {
    (byLang[t.language] = byLang[t.language] || {})[t.key] = t.body;
  }

  const wantsUS = US_CURRENCIES.includes(course.currency);

  // key + language -> the exact text to attach
  return (key, language) => {
    if (language && language !== "en" && byLang[language]?.[key]) {
      return byLang[language][key];
    }
    // English falls back to the US spelling of the philosophy block
    // on dollar-priced courses.
    if (wantsUS && base[key + "_us"]) return base[key + "_us"];
    return base[key] || null;
  };
}

// ---------------------------------------------------------------
// email
// ---------------------------------------------------------------

// Plain text kept as paragraphs. A feedback email is a letter, not a
// marketing piece — no columns, no buttons, nothing to distract.
function template(text) {
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
        <tr><td style="padding:14px 28px;background:#0d0e10;border-radius:5px 5px 0 0">
          <span style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#9aa1a9;
                       font-family:Helvetica,Arial,sans-serif">BirdBox Coaching</span>
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

async function sendEmail({ to, replyTo, fromName, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("No Resend key; not sending to", to); return false; }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} (BirdBox Coaching) <${FROM}>`,
        to: [to],
        cc: [OFFICE],
        reply_to: replyTo,
        subject,
        text,
        html: template(text),
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

async function officeSummary(course, staff, sent, failed, problems) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox <${FROM}>`,
        to: [OFFICE],
        subject: `[BirdBox] Feedback sent: ${course.title}`,
        text:
          `${staff.full_name} sent feedback for ${course.title}.\n\n` +
          `Sent: ${sent}\nFailed: ${failed}\n` +
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
