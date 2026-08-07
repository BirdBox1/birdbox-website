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
const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const SITE_URL = (process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app")
  .replace(/\/+$/, "");

// Copied on every host email so the artwork follows without anybody
// having to remember to ask.
const MEDIA_EMAIL = process.env.MEDIA_EMAIL || "media@thegymnasticscourse.education";

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
    if (earlyBirdCode) {
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

    // ---- send it ----------------------------------------------
    const sent = await send({
      to: course.host_email,
      cc: [MEDIA_EMAIL, OFFICE],
      subject,
      text: body + `\n\n${me.full_name}\nBirdBox Coaching\n${SITE_URL}`,
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
      copied: MEDIA_EMAIL,
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

async function send({ to, cc, subject, text }) {
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
