// netlify/functions/host-email.mjs
//
// The email an admin used to write by hand for every seminar. It
// creates the three discount codes and sends them to the host, with
// the media team copied so they can follow up with artwork.
//
// Codes are created here rather than in the browser because the
// discount_codes table has no public read policy — if it did, anyone
// could list every live code.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const OFFICE = "info@birdboxcoaching.com";

// The office address, not the alerts one. A host is a business
// contact, so the email should come from where they would reply to
// anyway — and info@ is the address the sending domain is verified
// for, which alerts@send. may not be.
const FROM = process.env.CONFIRM_FROM || OFFICE;
const SITE_URL = (process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app")
  .replace(/\/+$/, "");

// Copied on every host email so the artwork follows without anybody
// having to remember to ask. Any coach already assigned to the course
// is copied too — they are the ones who will hear from the host.
const MEDIA_EMAILS = (process.env.MEDIA_EMAILS ||
  "media@thegymnasticscourse.education,sarah@birdboxcoaching.com")
  .split(",").map((e) => e.trim()).filter(Boolean);

// Early bird stops four weeks out — after that it is not early.
const EARLY_BIRD_DAYS = 28;
const EARLY_BIRD_PERCENT = 10;

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth || !auth.user) return json({ error: "Not signed in" }, 401);

    const { data: me } = await supabase
      .from("staff")
      .select("id, full_name, role, active")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (!me || !me.active) return json({ error: "Not a member of staff" }, 403);
    if (me.role !== "admin") return json({ error: "Only an admin can do this" }, 403);

    const {
      courseId, subject, body,
      hostCode, hostUses,
      prepaidCode, prepaidUses,
      earlyBirdCode,
    } = await request.json();

    if (!courseId) return json({ error: "No course given." }, 400);
    if (!subject || !body) return json({ error: "The email is empty." }, 400);

    const { data: course, error: cErr } = await supabase
      .from("courses")
      .select("id, brand, type, title, slug, starts_at, timezone, host_name, host_email")
      .eq("id", courseId)
      .single();

    if (cErr || !course) return json({ error: "Course not found" }, 404);
    if (!course.host_email) return json({ error: "This course has no host email." }, 400);

    // ---- the codes --------------------------------------------
    const made = [];

    if (hostCode && hostUses > 0) {
      const err = await makeCode({
        code: hostCode,
        label: `Host places — ${course.title}`,
        percent: 100,
        courseId: course.id,
        maxRedemptions: hostUses,
      });
      if (err) return json({ error: `Host code: ${err}` }, 400);
      made.push(hostCode);
    }

    if (prepaidCode && prepaidUses > 0) {
      const err = await makeCode({
        code: prepaidCode,
        label: `Prepaid places — ${course.title}`,
        percent: 100,
        courseId: course.id,
        maxRedemptions: prepaidUses,
      });
      if (err) return json({ error: `Prepaid code: ${err}` }, 400);
      made.push(prepaidCode);
    }

    // Every seminar gets its own early bird row, so each can expire
    // four weeks before its own start date. Hosts all share the same
    // memorable code, which is the point.
    //
    // Workshops do not run an early bird at all. Enforced here rather
    // than only in the form, because a code created by accident is
    // live the moment it exists.
    if (earlyBirdCode && course.type !== "workshop") {
      const expires = new Date(
        new Date(course.starts_at).getTime() - EARLY_BIRD_DAYS * 86400000
      );
      const err = await makeCode({
        code: earlyBirdCode,
        label: `Early bird — ${course.title}`,
        percent: EARLY_BIRD_PERCENT,
        courseId: course.id,
        maxRedemptions: null,
        expiresAt: expires.toISOString(),
      });
      if (err) return json({ error: `Early bird code: ${err}` }, 400);
      made.push(earlyBirdCode);
    }

    // ---- who else sees it -------------------------------------
    const { data: assigned } = await supabase
      .from("course_staff")
      .select("staff ( full_name, email, active )")
      .eq("course_id", course.id);

    const coachEmails = (assigned || [])
      .map((r) => r.staff)
      .filter((c) => c && c.active && c.email)
      .map((c) => c.email);

    // Deduplicated and lowercased, because the same person appearing
    // twice in a cc list looks careless to a host.
    const cc = [...new Set(
      [...MEDIA_EMAILS, OFFICE, ...coachEmails]
        .map((e) => String(e).trim().toLowerCase())
        .filter((e) => e && e !== String(course.host_email).trim().toLowerCase())
    )];

    // ---- send it ----------------------------------------------
    const sent = await send({
      to: course.host_email,
      cc,
      subject,
      text: body + `\n\n${me.full_name}\nBirdBox Coaching\n${SITE_URL}`,
      brand: course.brand,
      isWorkshop: course.type === "workshop",
    });

    if (!sent) {
      return json({
        error: "The codes were created, but the email was rejected. " +
               "Try again — the codes will not be duplicated.",
      }, 502);
    }

    // Recorded the same way every other email is, so the portal can
    // say when it went and to whom.
    await supabase.from("course_emails").insert({
      course_id: course.id,
      registration_id: null,
      kind: "host",
      subject,
      body,
      status: "sent",
      sent_at: new Date().toISOString(),
    });

    return json({
      sent: true,
      sentTo: course.host_email,
      copied: cc.length,
      coaches: coachEmails.length,
      codes: made.length,
    });
  } catch (err) {
    console.error("host-email failed:", err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

// ---------------------------------------------------------------

// Returns null on success, or a message. Sending the email twice must
// not create the codes twice, so an existing code on this course is
// updated rather than duplicated.
async function makeCode({ code, label, percent, courseId, maxRedemptions, expiresAt }) {
  const { data: existing } = await supabase
    .from("discount_codes")
    .select("id, course_id")
    .ilike("code", code)
    .eq("course_id", courseId)
    .maybeSingle();

  const row = {
    code: code.toUpperCase(),
    label,
    kind: "percent",
    percent_off: percent,
    course_id: courseId,
    max_redemptions: maxRedemptions,
    expires_at: expiresAt || null,
    active: true,
  };

  if (existing) {
    const { error } = await supabase
      .from("discount_codes").update(row).eq("id", existing.id);
    return error ? error.message : null;
  }

  // The same code on a DIFFERENT course is fine and expected — every
  // seminar has its own EB10. Only a clash on this course matters.
  const { error } = await supabase.from("discount_codes").insert(row);
  return error ? error.message : null;
}

// ---------------------------------------------------------------
// how the email looks
// ---------------------------------------------------------------

// The marks are black lettering on transparent, so they sit on a
// white band under the dark strip rather than on it. SITE_URL is
// declared at the top of the file — an email cannot resolve a
// relative path, so the images need that absolute origin.
const BRAND_MARKS = {
  tcc:     { file: "tcc.png",     alt: "The Coaches Course" },
  tgc:     { file: "tgc.png",     alt: "The Gymnastics Course" },
  tec:     { file: "tec.png",     alt: "The Endurance Course" },
  twc:     { file: "twc.png",     alt: "The Weightlifting Course" },
  birdbox: { file: "birdBox.png", alt: "BirdBox Coaching" },
};

function brandMark(brand) {
  return BRAND_MARKS[String(brand || "").toLowerCase()] || BRAND_MARKS.birdbox;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// This email went out as plain text only, which cost it twice over.
// The section titles sat flat among the paragraphs, and a bare URL on
// its own line was left for the mail client to guess the end of — it
// guessed wrong and swallowed the first word of the next paragraph
// into the link.
//
// The copy already carries its own structure: ALL CAPS lines are
// headings, hyphens are list items, a line that is only a URL is a
// link. Reading that back out means nobody has to rewrite anything.
function bodyToHtml(text) {
  const blocks = String(text).split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out = [];

  const para = (html) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#16181b">${html}</p>`;

  // A URL anywhere in a line becomes a real anchor, so its boundary
  // is explicit rather than something the client works out.
  const linkify = (line) =>
    escapeHtml(line).replace(
      /(https?:\/\/[^\s<]+?)(?=[.,;:)]?(?:\s|$))/g,
      (url) => `<a href="${url}" style="color:#2f7fd0">${url}</a>`
    );

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

    if (lines.every((l) => /^[-•]\s+/.test(l))) {
      out.push(
        '<ul style="margin:0 0 16px;padding-left:1.2rem;font-size:16px;' +
        'line-height:1.65;color:#16181b">' +
        lines.map((l) =>
          `<li style="margin:0 0 6px">${linkify(l.replace(/^[-•]\s+/, ""))}</li>`
        ).join("") +
        "</ul>"
      );
      continue;
    }

    for (const line of lines) {
      // A short line in capitals is a section title. A long one is a
      // sentence somebody happened to shout.
      const isHeading =
        line.length <= 60 &&
        /[A-Z]/.test(line) &&
        line === line.toUpperCase() &&
        !/^[-•]/.test(line) &&
        !/^https?:\/\//i.test(line);

      if (isHeading) {
        out.push(
          '<p style="margin:26px 0 8px;font-size:12px;letter-spacing:0.12em;' +
          'text-transform:uppercase;font-weight:700;color:#16181b">' +
          escapeHtml(line) + "</p>"
        );
        continue;
      }

      // A line that is nothing but a link gets room of its own, which
      // is what a host is going to copy and share.
      if (/^https?:\/\/\S+$/i.test(line)) {
        const url = escapeHtml(line);
        out.push(
          '<p style="margin:0 0 16px;font-size:16px;line-height:1.5;word-break:break-all">' +
          `<a href="${url}" style="color:#2f7fd0">${url}</a></p>`
        );
        continue;
      }

      if (/^[-•]\s+/.test(line)) {
        out.push(
          '<p style="margin:0 0 6px 1.2rem;font-size:16px;line-height:1.65;' +
          'color:#16181b">' + linkify(line.replace(/^[-•]\s+/, "")) + "</p>"
        );
        continue;
      }

      out.push(para(linkify(line)));
    }
  }

  return out.join("");
}

function emailHtml(text, brand, isWorkshop) {
  const mark = brandMark(brand);

  // The workshop mark is white lettering, so it cannot go on the white
  // band the others use. It sits on the dark strip instead, on the
  // right, with the strip a little taller to carry it — and the white
  // band is dropped, because there is nothing left to put on it.
  const header = isWorkshop
    ? `<tr><td style="padding:18px 28px;background:#0d0e10;border-radius:5px 5px 0 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td align="left" style="vertical-align:middle">
              <span style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#9aa1a9;
                           font-family:Helvetica,Arial,sans-serif">BirdBox Coaching</span>
            </td>
            <td align="right" style="vertical-align:middle">
              <img src="${SITE_URL}/brand/tgc-workshops.png" alt="TGC Workshops"
                   height="34" style="height:34px;width:auto;display:block;border:0;outline:none;
                   text-decoration:none;-ms-interpolation-mode:bicubic">
            </td>
          </tr></table>
        </td></tr>`
    : `<tr><td style="padding:14px 28px;background:#0d0e10;border-radius:5px 5px 0 0">
          <span style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#9aa1a9;
                       font-family:Helvetica,Arial,sans-serif">BirdBox Coaching</span>
        </td></tr>
        <tr><td align="left" style="padding:20px 28px;background:#ffffff;
                   border-bottom:1px solid #e0ddd7">
          <img src="${SITE_URL}/brand/${mark.file}" alt="${escapeHtml(mark.alt)}"
               height="46" style="height:46px;width:auto;display:block;border:0;outline:none;
               text-decoration:none;-ms-interpolation-mode:bicubic">
        </td></tr>`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f3f0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f0">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:600px;background:#ffffff;border:1px solid #e0ddd7;border-radius:6px">
        ${header}
        <tr><td style="padding:28px;font-family:Helvetica,Arial,sans-serif">${bodyToHtml(text)}</td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #e0ddd7;
                       font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6c7178">
          BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function send({ to, cc, subject, text, brand, isWorkshop }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("No Resend key; host email not sent to", to); return false; }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox Coaching <${FROM}>`,
        to: [to],
        cc: (cc || []).filter(Boolean),
        reply_to: OFFICE,
        subject,
        text,
        html: emailHtml(text, brand, isWorkshop),
      }),
    });
    if (!res.ok) {
      console.error("Resend rejected the host email to", to, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Could not send the host email to", to, err.message);
    return false;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
