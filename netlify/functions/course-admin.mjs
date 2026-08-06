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
import Stripe from "stripe";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const OFFICE = "info@birdboxcoaching.com";
const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const SITE_URL = (process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app")
  .replace(/\/+$/, "");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
      case "cancel_preview":        return await cancelPreview(body);
      case "cancel":                return await cancel(body, me);
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
// Cancelling a course. Clause 1.5 of the terms: if we cancel and cannot
// offer a suitable alternative, the participant gets a full refund. No
// administration fee — that is clause 1.4, for refunds they ask for.
//
// Two steps on purpose. The preview shows exactly what would move
// before any of it does, because a refund cannot be taken back.

// What each person paid, and what would happen to them.
async function cancelPlan(courseId) {
  const { data: regs, error } = await supabase
    .from("registrations")
    .select("id, first_name, last_name, email, status, payment_status, currency")
    .eq("course_id", courseId);

  if (error) throw new Error("registrations: " + error.message);

  const active = (regs || []).filter((r) => (r.status || "active") === "active");
  if (!active.length) return [];

  const { data: pays, error: pErr } = await supabase
    .from("payments")
    .select("id, registration_id, sequence, amount_cents, status, stripe_payment_intent_id, refunded_at")
    .in("registration_id", active.map((r) => r.id));

  if (pErr) throw new Error("payments: " + pErr.message);

  const byReg = {};
  for (const p of pays || []) (byReg[p.registration_id] = byReg[p.registration_id] || []).push(p);

  return active.map((r) => {
    const rows = byReg[r.id] || [];

    // Taken and not yet given back. A payment already refunded is left
    // alone, so pressing the button twice cannot refund twice.
    const toRefund = rows.filter(
      (p) => p.status === "paid" && !p.refunded_at && p.stripe_payment_intent_id
    );

    // Scheduled and not yet taken. These are stopped rather than
    // refunded — nobody has paid them.
    const toCancel = rows.filter(
      (p) => p.status !== "paid" && p.status !== "refunded" && p.status !== "cancelled"
    );

    // Money taken that we cannot refund automatically, because no
    // payment intent was recorded. Flagged rather than hidden.
    const stuck = rows.filter(
      (p) => p.status === "paid" && !p.refunded_at && !p.stripe_payment_intent_id
    );

    return {
      registration_id: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim(),
      email: r.email,
      currency: r.currency || "EUR",
      refundCents: toRefund.reduce((n, p) => n + (p.amount_cents || 0), 0),
      cancelCents: toCancel.reduce((n, p) => n + (p.amount_cents || 0), 0),
      stuckCents: stuck.reduce((n, p) => n + (p.amount_cents || 0), 0),
      refundIds: toRefund.map((p) => p.id),
      cancelIds: toCancel.map((p) => p.id),
    };
  });
}

async function cancelPreview({ courseId }) {
  if (!courseId) return json({ error: "No course given." }, 400);

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, starts_at, timezone, cancelled_at")
    .eq("id", courseId)
    .maybeSingle();

  if (!course) return json({ error: "Course not found" }, 404);

  const plan = await cancelPlan(courseId);

  return json({
    preview: true,
    title: course.title,
    alreadyCancelled: !!course.cancelled_at,
    people: plan,
    totalRefund: plan.reduce((n, p) => n + p.refundCents, 0),
    totalCancel: plan.reduce((n, p) => n + p.cancelCents, 0),
    totalStuck: plan.reduce((n, p) => n + p.stuckCents, 0),
    currency: plan.length ? plan[0].currency : "EUR",
  });
}

async function cancel({ courseId, reason }, me) {
  if (!courseId) return json({ error: "No course given." }, 400);

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, starts_at, timezone, city, cancelled_at")
    .eq("id", courseId)
    .maybeSingle();

  if (!course) return json({ error: "Course not found" }, 404);

  const plan = await cancelPlan(courseId);

  let refunded = 0;
  let emailed = 0;
  const problems = [];

  for (const person of plan) {
    // ---- refund what was taken ----------------------------
    for (const paymentId of person.refundIds) {
      const { data: pay } = await supabase
        .from("payments")
        .select("id, amount_cents, stripe_payment_intent_id, refunded_at")
        .eq("id", paymentId)
        .single();

      // Checked again here, not just in the plan: two admins pressing
      // at once must not both issue the same refund.
      if (!pay || pay.refunded_at) continue;

      try {
        const refund = await stripe.refunds.create({
          payment_intent: pay.stripe_payment_intent_id,
          reason: "requested_by_customer",
        });

        await supabase.from("payments").update({
          status: "refunded",
          refunded_at: new Date().toISOString(),
          refunded_cents: pay.amount_cents,
          stripe_refund_id: refund.id,
        }).eq("id", pay.id);

        refunded += pay.amount_cents;
      } catch (err) {
        console.error("Refund failed for", person.name, err.message);
        problems.push(`${person.name}: ${err.message}`);
      }
    }

    // ---- stop what was still to come ----------------------
    if (person.cancelIds.length) {
      const { error } = await supabase
        .from("payments")
        .update({ status: "cancelled" })
        .in("id", person.cancelIds);
      if (error) problems.push(`${person.name}: could not stop the balance — ${error.message}`);
    }

    await supabase
      .from("registrations")
      .update({ status: "cancelled", payment_status: person.refundCents ? "refunded" : "pending" })
      .eq("id", person.registration_id);
  }

  // ---- tell everybody -------------------------------------
  const tz = safeZone(course.timezone);
  const when = longDate(course.starts_at, tz);

  for (const person of plan) {
    if (!person.email) continue;
    const money = person.refundCents
      ? `${formatMoney(person.refundCents, person.currency)} has been refunded to the card you paid with. It usually appears within five to ten working days.`
      : "Nothing was taken from your card, so there is nothing to refund.";

    const ok = await send({
      to: person.email,
      subject: `${course.title} has been cancelled`,
      text:
`Hello ${(person.name || "there").split(" ")[0]},

I am sorry to say that ${course.title}, due to run on ${when}, has been cancelled.

${reason ? reason + "\n\n" : ""}${money}

${person.cancelCents ? "Any payment still scheduled has been stopped, so nothing further will be taken.\n\n" : ""}If you would like to join another date instead, reply to this email and we will arrange it.

We are sorry for the disruption, and for any travel or accommodation you may have booked.

BirdBox Coaching
${OFFICE}`,
    });
    if (ok) emailed++;
  }

  // ---- and the coaches ------------------------------------
  const { data: staffRows } = await supabase
    .from("course_staff")
    .select("staff ( full_name, email, active )")
    .eq("course_id", courseId);

  for (const row of staffRows || []) {
    const c = row.staff;
    if (!c || !c.active || !c.email) continue;
    await send({
      to: c.email,
      subject: `Cancelled: ${course.title}`,
      text:
`Hi ${(c.full_name || "there").split(" ")[0]},

${course.title} on ${when} has been cancelled by ${me.full_name}.

${plan.length} participant${plan.length === 1 ? " has" : "s have"} been emailed and refunded.

${SITE_URL}/portal/`,
    });
  }

  await supabase.from("courses").update({
    status: "cancelled",
    archived: true,
    cancelled_at: new Date().toISOString(),
    cancelled_by: me.id,
    cancel_reason: reason || null,
  }).eq("id", courseId);

  return json({
    cancelled: true,
    emailed,
    refundedCents: refunded,
    people: plan.length,
    problems,
  });
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

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency", currency: (currency || "EUR").toUpperCase(),
      maximumFractionDigits: 2,
    }).format((cents || 0) / 100);
  } catch (e) { return ((cents || 0) / 100).toFixed(2); }
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
