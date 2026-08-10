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
// The banner carries the brand of the course the feedback is for: the
// dark BirdBox strip, then the TGC or TCC mark on white beneath it,
// matching the follow-up emails.

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

// Feedback can be drafted during the course and immediately after it,
// but it does not go out until two hours past the finish. It gives
// the lead coach room to read everything back once the room has
// cleared, and stops a participant receiving their email while they
// are still packing their bag.
const SEND_DELAY_MINUTES = 120;

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
      .select("id, title, brand, level, city, country, starts_at, ends_at, timezone, currency, language")
      .eq("id", courseId)
      .single();

    if (!course) return json({ error: "Course not found" }, 404);

    const hold = sendHold(course);
    if (hold.holding) {
      return json({ error: hold.message, releasesAt: hold.releasesAt }, 409);
    }

    // Only what has actually been read and checked.
    const { data: drafts } = await supabase
      .from("feedback_drafts")
      .select("id, registration_id, subject, body, status, " +
              "translated_subject, translated_body, translated_language, translated_from")
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

      // A translation is what the participant reads, where one was made
      // and checked. The English stays on the record either way.
      //
      // If the English moved on after translating, the translation is
      // out of date — the portal says so before sending, but this is
      // the last line of defence, and sending the English is safer
      // than sending a translation of something else.
      const stale = d.translated_from && d.translated_from !== d.body;
      const useTranslation = !!(d.translated_body && d.translated_body.trim() && !stale);

      const full = String(
        useTranslation ? d.translated_body : d.body || ""
      ).trim();
      const subjectLine = useTranslation && d.translated_subject
        ? d.translated_subject
        : d.subject;

      if (stale && d.translated_body) {
        console.warn(
          "Translation out of date for", d.registration_id, "— sent in English."
        );
      }

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
        subject: subjectLine || `Your feedback from ${course.title}`,
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
// not before two hours after the finish
// ---------------------------------------------------------------

// The comparison is between two instants, so it is correct wherever
// the coach is sitting. Only the message is rendered in the course's
// own time zone, because that is the clock the coach was working to.
function sendHold(course) {
  const finish = course.ends_at || course.starts_at;
  if (!finish) return { holding: false };

  const releases = new Date(new Date(finish).getTime() + SEND_DELAY_MINUTES * 60000);
  if (Date.now() >= releases.getTime()) return { holding: false };

  let local;
  try {
    local = releases.toLocaleString("en-GB", {
      timeZone: course.timezone || "UTC",
      weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch {
    local = releases.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }

  return {
    holding: true,
    releasesAt: releases.toISOString(),
    message:
      `Feedback cannot be sent until two hours after the course finishes. ` +
      `This one opens at ${local}` +
      (course.city ? `, local to ${course.city}.` : ".") +
      ` Drafts can be written and checked in the meantime.`,
  };
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
// Two bands at the top, matching the follow-up emails: the dark
// BirdBox strip, then the mark of the brand the seminar belongs to on
// white. The marks are black lettering on transparent, so they need
// the white band — on the dark strip they would not be visible, and
// recolouring them is not something we do.
function template(text, brand) {
  const mark = brandMark(brand);

  const paras = String(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) =>
      `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#16181b">${
        linkify(escapeHtml(p)).replace(/\n/g, "<br>")
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
        <tr><td align="left" style="padding:20px 28px;background:#ffffff;
                   border-bottom:1px solid #e0ddd7">
          <img src="${SITE_URL}/brand/${mark.file}" alt="${escapeHtml(mark.alt)}"
               height="46" style="height:46px;width:auto;display:block;border:0;outline:none;
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

// The one piece of markdown the drafts are allowed to use: an
// exercise name carrying its demonstration link, written
// [Eccentric sit ups](https://...). Everywhere else the body is
// plain text and appears exactly as written.
//
// Run after escaping, so the link text cannot inject markup. An
// ampersand inside the URL has already become &amp;, which is the
// correct form inside an href and resolves back to & in the browser.
const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

function linkify(escaped) {
  return escaped.replace(MD_LINK, (m, text, href) =>
    `<a href="${href}" style="color:#2f7fd0;text-decoration:underline">${text}</a>`);
}

// The plain-text alternative cannot carry a link, so the name and the
// URL are both shown. A client that strips HTML still gets something
// usable rather than markdown punctuation.
function plainText(text) {
  return String(text).replace(MD_LINK, (m, name, href) => `${name}: ${href}`);
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
        text: plainText(text),
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
