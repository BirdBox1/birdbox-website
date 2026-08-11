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
    .select("id, brand, title, city, country, venue_name, address, starts_at, ends_at, timezone, slug, host_name, host_email")
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
      subject: `A change of date for ${course.title}`,
      text:
`Hello ${r.first_name || "there"},

I am sorry — we have had to move the date of ${course.title}, and I know that is not what you were expecting to read.

You booked this in good faith and may well have arranged time off, travel or cover to be there. Changing it on you is not something we do lightly, and I am sorry for the disruption it causes.

THE NEW DATE

It was ${oldWhen}.

It is now ${newWhen}, starting at ${newTime}${where ? `, at ${where}` : ""}.

YOUR PLACE

Nothing else changes. Your place moves with the course, and so does any balance still to pay — you do not need to do anything to keep it.

IF THE NEW DATE DOES NOT WORK

Please just reply to this email and tell us. We will find something that does — a place on another course, or a credit to use when it suits you. There is no deadline on that and no awkwardness in asking.

Thank you for bearing with us. We are looking forward to seeing you.

BirdBox Coaching
${SITE_URL}/c/${course.slug}/`,
      brand: course.brand,
    });
    if (ok) emailed++;
    if (ok) {
      await logEmail({
        courseId: course.id,
        registrationId: r.id,
        kind: "rescheduled",
        subject: `${course.title} has moved to ${newWhen}`,
        body: "Sent automatically when the course was " +
              "moved.",
      });
    }
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

${course.title} has been moved. You are down as ${c.role === "lead_coach" ? "lead coach" : "an assistant"} on this one, so you will want to check your own arrangements.

THE NEW DATE

It was ${oldWhen}.

It is now ${newWhen}, starting at ${newTime}${where ? `, at ${where}` : ""}.

WHAT HAS BEEN DONE

${active.length} participant${active.length === 1 ? " has" : "s have"} been emailed and told they can move to another course or take a credit if the new date does not suit them. Any balance still to collect has moved with the course.

Moved by ${me.full_name}.

${SITE_URL}/portal/`,
      brand: course.brand,
    });
    if (ok) coachesEmailed++;
  }

  // ---- and the host ----------------------------------------
  // Their gym, their staffing, their diary. They were not being told
  // at all, which is the one person who cannot find out from the
  // website that the date has changed.
  let hostEmailed = false;
  if (course.host_email) {
    hostEmailed = await send({
      to: course.host_email,
      subject: `A change of date for ${course.title}`,
      text:
`Hi ${(course.host_name || "there").split(" ")[0]},

Following our conversation, this is to confirm that ${course.title} has now been moved in our system.

THE NEW DATE

It was ${oldWhen}.

It is now ${newWhen}, starting at ${newTime}${where ? `, at ${where}` : ""}.

WHAT HAS BEEN DONE

${active.length} participant${active.length === 1 ? " has" : "s have"} been emailed and told their place moves with the course. Anyone the new date does not suit can move to another one or take a credit.

The registration page is unchanged and now shows the new date, so anything you have already shared still works:
${SITE_URL}/c/${course.slug}/

IF ANYTHING HERE IS NOT AS WE AGREED

Reply and tell us — better now than closer to the day.

Thank you for being flexible with this one.

BirdBox Coaching
${OFFICE}`,
      brand: course.brand,
    });

    if (hostEmailed) {
      await logEmail({
        courseId: course.id,
        kind: "rescheduled_host",
        subject: `A change of date for ${course.title}`,
        body: `Confirmed to ${course.host_email} that the date moved to ${newWhen}.`,
      });
    }
  }

  return json({
    moved: true,
    participants: active.length,
    emailed,
    coachesEmailed,
    hostEmailed,
  });
}

// ---------------------------------------------------------------
// Resend somebody their registration confirmation.

async function sendRegistrationEmail({ registration_id }) {
  if (!registration_id) return json({ error: "No registration given." }, 400);

  const { data: reg, error } = await supabase
    .from("registrations")
    .select("id, first_name, last_name, email, course_id, courses ( brand, title, starts_at, ends_at, timezone, venue_name, address, city, country, slug )")
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
    brand: course.brand,
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
    .select("id, registration_id, sequence, amount_cents, status, charged_at, stripe_payment_intent_id, refunded_at")
    .in("registration_id", active.map((r) => r.id));

  if (pErr) throw new Error("payments: " + pErr.message);

  const byReg = {};
  for (const p of pays || []) (byReg[p.registration_id] = byReg[p.registration_id] || []).push(p);

  return active.map((r) => {
    const rows = byReg[r.id] || [];

    // Whether money actually moved is answered by charged_at, not by
    // the status label. An earlier version of this filtered on a status
    // value that does not exist in the enum, so nothing matched and
    // four charged payments were marked cancelled instead of refunded.
    // charged_at is a fact about what happened; status is a label that
    // can be wrong.
    const wasTaken = (p) => !!p.charged_at && p.status !== "refunded" && !p.refunded_at;

    // Taken, and not yet given back.
    const toRefund = rows.filter((p) => wasTaken(p) && p.stripe_payment_intent_id);

    // Never taken, so there is nothing to give back — these are simply
    // stopped so nobody is charged for a course that is not happening.
    const toCancel = rows.filter(
      (p) => !p.charged_at && p.status !== "refunded" && p.status !== "cancelled"
    );

    // Taken, but with no Stripe reference recorded, so it cannot be
    // refunded automatically. Flagged rather than quietly skipped.
    const stuck = rows.filter((p) => wasTaken(p) && !p.stripe_payment_intent_id);

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
    .select("id, brand, title, starts_at, timezone, cancelled_at")
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
    .select("id, brand, title, starts_at, timezone, city, cancelled_at, host_name, host_email")
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
        .select("id, amount_cents, status, charged_at, stripe_payment_intent_id, refunded_at")
        .eq("id", paymentId)
        .single();

      // Checked again here, not just in the plan: two admins pressing
      // at once must not both issue the same refund, and a payment that
      // was never charged must never be refunded.
      if (!pay || pay.refunded_at || pay.status === "refunded") continue;
      if (!pay.charged_at || !pay.stripe_payment_intent_id) continue;

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

I am very sorry. We have had to cancel ${course.title}, which was due to run on ${when}.

${reason ? reason + "\n\n" : `This is not a decision we wanted to make. There were not enough registrations to cover bringing a coach out to you, and running it anyway was not something we could do. That is on us rather than on you, and I know it does not make it any less annoying to read.\n\n`}WHAT HAPPENS WITH YOUR MONEY

${money}
${person.cancelCents ? "\nAny payment still scheduled has been stopped, so nothing further will be taken from your card.\n" : ""}
You do not need to ask for it or chase it. If it has not appeared within a week, reply to this email and we will look into it.

IF YOU STILL WANT TO DO THE COURSE

We would very much like you there. Reply to this email and we will find you a place on another date — and we will keep an eye out for anything running near you.

I am sorry too for any travel or time off you had already arranged around this. If that has cost you something, tell us and we will see what we can do.

Thank you for booking with us in the first place, and I hope we get another chance.

BirdBox Coaching
${OFFICE}`,
      brand: course.brand,
    });
    if (ok) emailed++;
    if (ok) {
      await logEmail({
        courseId: course.id,
        registrationId: person.registration_id || null,
        kind: "cancelled",
        subject: `${course.title} has been cancelled`,
        body: "Sent automatically when the course was " +
              "cancelled.",
      });
    }
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

${plan.length} participant${plan.length === 1 ? " has" : "s have"} been emailed and refunded, and the host has been told.

If you had travel booked for this one, sort it out now rather than later, and put anything you cannot recover on your next invoice.

${SITE_URL}/portal/`,
      brand: course.brand,
    });
  }

  // ---- and the host ----------------------------------------
  // It is their gym and their diary. They were not being told at all.
  let hostEmailed = false;
  if (course.host_email) {
    hostEmailed = await send({
      to: course.host_email,
      subject: `${course.title} has been cancelled`,
      text:
`Hi ${(course.host_name || "there").split(" ")[0]},

Following our conversation, this is to confirm that ${course.title}, due to run at your gym on ${when}, has now been cancelled on our side.

${reason ? reason + "\n\n" : `As discussed, registrations did not reach the point where we could cover bringing a coach out to you.\n\n`}WHAT HAS BEEN DONE

${plan.length} participant${plan.length === 1 ? " has" : "s have"} been emailed and refunded in full. Nobody is out of pocket and nobody will arrive on the day. You do not need to contact anyone.

The registration page has been taken down.

You can release the space and stand down whatever you had arranged.

WHAT WE WOULD LIKE NEXT

We would still very much like to come to you. If you are willing to host another date, tell us roughly when suits and we will work around you — and we will give it longer to fill next time.

Thank you for your patience with this one, and for having us in the first place.

BirdBox Coaching
${OFFICE}`,
      brand: course.brand,
    });

    if (hostEmailed) {
      await logEmail({
        courseId: course.id,
        kind: "cancelled_host",
        subject: `${course.title} has been cancelled`,
        body: `Confirmed to ${course.host_email} that the course was cancelled.`,
      });
    }
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
    hostEmailed,
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

function emailHtml(text, brand) {
  const mark = brandMark(brand);

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

// Written after the fact so a failed send is not recorded as a
// success. registration_id set means one participant; null means the
// host or the team.
async function logEmail({ courseId, registrationId, kind, subject, body }) {
  const { error } = await supabase.from("course_emails").insert({
    course_id: courseId,
    registration_id: registrationId || null,
    kind,
    subject,
    body,
    status: "sent",
    sent_at: new Date().toISOString(),
  });
  if (error) console.error("Could not record the", kind, "email:", error.message);
}

async function send({ to, subject, text, brand }) {
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
        html: emailHtml(text, brand),
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
