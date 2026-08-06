// netlify/functions/course-admin.mjs
//
// The three admin actions the portal calls: moving a course to a new
// date, resending a registration confirmation, and cancelling.
//
// Cancelling is deliberately not automated. It would mean issuing real
// refunds through Stripe, and a mistake there is irreversible. Until
// that is built properly the button says so plainly rather than
// pretending to have done it.

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

    const body = await request.json();

    switch (body.action) {
      case "reschedule":            return await reschedule(body, me);
      case "send_registration_email": return await sendRegistrationEmail(body);
      case "cancel":                return await cancel(body);
      default:
        return json({ error: `Unknown action "${body.action}".` }, 400);
    }
  } catch (err) {
    console.error("course-admin failed:", err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

// ---------------------------------------------------------------
// Move a course to a new date and tell everybody.

async function reschedule({ courseId, startsAt, endsAt }, me) {
  if (!courseId || !startsAt) return json({ error: "A course and a new start are needed." }, 400);

  const when = new Date(startsAt);
  if (isNaN(when.getTime())) return json({ error: "That start date could not be read." }, 400);

  const { data: course, error: cErr } = await supabase
    .from("courses")
    .select("id, title, city, country, venue_name, address, starts_at, ends_at, timezone, slug")
    .eq("id", courseId)
    .single();

  if (cErr || !course) return json({ error: "Course not found" }, 404);

  const wasStart = course.starts_at;

  const { error: uErr } = await supabase
    .from("courses")
    .update({ starts_at: startsAt, ends_at: endsAt || null })
    .eq("id", courseId);

  if (uErr) return json({ error: "Could not move the date: " + uErr.message }, 500);

  // Any balance still to collect moves with the course, so nobody is
  // charged for a date that no longer exists.
  const { data: regs } = await supabase
    .from("registrations")
    .select("id, first_name, last_name, email, status, payment_status")
    .eq("course_id", courseId);

  const active = (regs || []).filter(
    (r) => (r.status || "active") === "active" &&
           r.payment_status !== "refunded" &&
           r.email
  );

  if (active.length) {
    const balanceDue = new Date(when.getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const { error: pErr } = await supabase
      .from("payments")
      .update({ due_date: balanceDue })
      .in("registration_id", active.map((r) => r.id))
      .gt("sequence", 1)
      .neq("status", "paid");
    if (pErr) console.error("Could not move outstanding balances:", pErr.message);
  }

  const tz = safeZone(course.timezone);
  const oldWhen = longDate(wasStart, tz);
  const newWhen = longDate(startsAt, tz);
  const newTime = shortTime(startsAt, tz);
  const where = [course.venue_name, course.city].filter(Boolean).join(", ");

  // ---- participants ----------------------------------------
  let emailed = 0;
  for (const r of active) {
    const ok = await send({
      to: r.email,
      subject: `${course.title} has moved to ${newWhen}`,
      text:
`Hello ${r.first_name || "there"},

The date of ${course.title} has changed.

It was:  ${oldWhen}
It is now: ${newWhen}, starting at ${newTime}${where ? `, at ${where}` : ""}.

Your place is unchanged and moves with it, along with any balance still to pay.

If the new date does not work for you, reply to this email and we will sort something out — a transfer to another course, or a credit.

We are sorry for the disruption, and we look forward to seeing you.

BirdBox Coaching
${SITE_URL}/c/${course.slug}/`,
    });
    if (ok) emailed++;
  }

  // ---- coaches ---------------------------------------------
  const { data: staffRows } = await supabase
    .from("course_staff")
    .select("role, staff ( full_name, email, active )")
    .eq("course_id", courseId);

  const coaches = (staffRows || [])
    .map((row) => ({ role: row.role, ...(row.staff || {}) }))
    .filter((c) => c.active && c.email);

  let coachesEmailed = 0;
  for (const c of coaches) {
    const ok = await send({
      to: c.email,
      subject: `Date changed: ${course.title}`,
      text:
`Hi ${(c.full_name || "there").split(" ")[0]},

${course.title} has been moved.

It was:  ${oldWhen}
It is now: ${newWhen}, starting at ${newTime}${where ? `, at ${where}` : ""}.

You are down as ${c.role === "lead_coach" ? "lead coach" : "an assistant"} on this one. ${active.length} participant${active.length === 1 ? " has" : "s have"} been emailed.

Moved by ${me.full_name}.

${SITE_URL}/portal/`,
    });
    if (ok) coachesEmailed++;
  }

  return json({
    moved: true,
    participants: active.length,
    emailed,
    coachesEmailed,
  });
}

// ---------------------------------------------------------------
// Resend somebody their registration confirmation.

async function sendRegistrationEmail({ registration_id }) {
  if (!registration_id) return json({ error: "No registration given." }, 400);

  const { data: reg, error } = await supabase
    .from("registrations")
    .select("id, first_name, last_name, email, course_id, courses ( title, starts_at, ends_at, timezone, venue_name, address, city, country, slug )")
    .eq("id", registration_id)
    .single();

  if (error || !reg) return json({ error: "Registration not found" }, 404);
  if (!reg.email) return json({ error: "That registration has no email address." }, 400);

  const course = reg.courses || {};
  const tz = safeZone(course.timezone);
  const where = [course.venue_name, course.address, course.city].filter(Boolean).join(", ");

  const ok = await send({
    to: reg.email,
    subject: `You are registered for ${course.title}`,
    text:
`Hello ${reg.first_name || "there"},

You are registered for ${course.title}.

When:  ${longDate(course.starts_at, tz)}, from ${shortTime(course.starts_at, tz)}
Where: ${where || "to be confirmed"}

We will be in touch again before the course with the full details for the day.

If anything here looks wrong, reply to this email and we will put it right.

BirdBox Coaching
${SITE_URL}/c/${course.slug}/`,
  });

  if (!ok) return json({ error: "The email was rejected." }, 502);
  return json({ sent: 1 });
}

// ---------------------------------------------------------------
// Cancelling means real refunds, so it is not automated yet. Saying so
// is better than a button that appears to have refunded twelve people
// and has not.

async function cancel({ courseId }) {
  const { data: course } = await supabase
    .from("courses")
    .select("id, title")
    .eq("id", courseId)
    .maybeSingle();

  const { count } = await supabase
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId)
    .eq("status", "active");

  return json({
    error:
      "Cancelling is not automated yet, because it would issue real refunds.\n\n" +
      `To cancel "${(course && course.title) || "this course"}": archive it here, ` +
      `then refund ${count || 0} participant${count === 1 ? "" : "s"} in Stripe and email them.`,
  }, 400);
}

// ---------------------------------------------------------------

function longDate(iso, tz) {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz,
  });
}

function shortTime(iso, tz) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: tz,
  });
}

function safeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC" });
    return tz || "UTC";
  } catch (e) { return "UTC"; }
}

async function send({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("No Resend key; nothing sent to", to); return false; }

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
      console.error("Resend rejected mail to", to, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Could not send to", to, err.message);
    return false;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
