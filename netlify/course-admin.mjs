// netlify/functions/course-admin.mjs
//
// Admin-only course actions that need the Stripe secret key:
//
//   POST { action: "reschedule", courseId, startsAt, endsAt }
//   POST { action: "cancel",     courseId, reason? }
//
// The caller must send their Supabase access token as a Bearer token.
// We verify it here and check the staff row is an active admin —
// the browser is never trusted to say who it is.
//
// Three audiences, three different emails:
//   participants — what it means for them, including refunds
//   coaches      — the schedule change only, never any money
//   info@        — the full summary, including anything that failed

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const REPLY_TO = "info@birdboxcoaching.com";
const ADMIN_EMAIL = "info@birdboxcoaching.com";

// Must match create-checkout.mjs
const BALANCE_DAYS_BEFORE = 14;

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const admin = await requireAdmin(req);
    if (!admin) return json({ error: "Not authorised" }, 401);

    const body = await req.json();
    const { action, courseId } = body;
    if (!courseId) return json({ error: "Missing course" }, 400);

    const { data: course } = await supabase
      .from("courses")
      .select("id, title, slug, brand, starts_at, ends_at, timezone, venue_name, city, country, status")
      .eq("id", courseId)
      .single();

    if (!course) return json({ error: "Course not found" }, 404);

    if (action === "reschedule") return await reschedule(course, body, admin);
    if (action === "cancel")     return await cancel(course, body, admin);

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("course-admin failed:", err);
    return json({ error: err.message || "Something went wrong" }, 500);
  }
};

// ---------------------------------------------------------------
// who is asking
// ---------------------------------------------------------------
async function requireAdmin(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: staff } = await supabase
    .from("staff")
    .select("id, full_name, role, active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!staff || !staff.active || staff.role !== "admin") return null;
  return staff;
}

// ---------------------------------------------------------------
// move the date
// ---------------------------------------------------------------
async function reschedule(course, body, admin) {
  const { startsAt, endsAt } = body;
  if (!startsAt) return json({ error: "Missing the new date" }, 400);

  const oldStart = course.starts_at;

  const { error } = await supabase
    .from("courses")
    .update({ starts_at: startsAt, ends_at: endsAt || null })
    .eq("id", course.id);

  if (error) return json({ error: error.message }, 500);

  // Any unpaid balance is due against the new date, not the old one.
  const newDue = new Date(startsAt);
  newDue.setDate(newDue.getDate() - BALANCE_DAYS_BEFORE);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dueAt = newDue > tomorrow ? newDue : tomorrow;

  const people = await participants(course.id);
  const ids = people.map((p) => p.id);
  let movedInvoices = 0;

  if (ids.length) {
    const { data: pending } = await supabase
      .from("payments")
      .select("id, stripe_invoice_id, status")
      .in("registration_id", ids)
      .neq("status", "paid");

    for (const p of pending || []) {
      await supabase
        .from("payments")
        .update({ due_date: dueAt.toISOString().slice(0, 10) })
        .eq("id", p.id);

      if (!p.stripe_invoice_id) continue;
      try {
        // Only a draft invoice can be moved. A finalised one is
        // already in flight and is left alone deliberately.
        const inv = await stripe.invoices.retrieve(p.stripe_invoice_id);
        if (inv.status === "draft") {
          await stripe.invoices.update(p.stripe_invoice_id, {
            automatically_finalizes_at: Math.floor(dueAt.getTime() / 1000),
          });
          movedInvoices++;
        }
      } catch (err) {
        console.error("Could not move invoice", p.stripe_invoice_id, err.message);
      }
    }
  }

  // ---- participants ----
  let emailed = 0;
  for (const p of people) {
    const ok = await sendEmail({
      to: p.email,
      subject: `New date for ${course.title}`,
      heading: "Your course has a new date",
      body: [
        `Hi ${escapeHtml(p.first_name)},`,
        `We have had to move <strong>${escapeHtml(course.title)}</strong> to a new date. Your place has moved with it — there is nothing you need to do.`,
        `<strong>Was:</strong> ${longDate(oldStart)}<br><strong>Now:</strong> ${longDate(startsAt)}${endsAt ? " – " + longDate(endsAt) : ""}`,
        venueLine(course),
        `If the new date does not work for you, reply to this email and we will sort it out — we can issue you a credit to use on another course, or refund you if you would rather.`,
        `Sorry for the change, and thanks for bearing with us.`,
      ],
      cta: { label: "View the course", url: courseUrl(course) },
    });
    if (ok) emailed++;
  }

  // ---- coaches: the schedule, nothing else ----
  const coaches = await assignedCoaches(course.id);
  let coachesEmailed = 0;
  for (const c of coaches) {
    const ok = await sendEmail({
      to: c.email,
      subject: `Date change: ${course.title}`,
      heading: "A course you are down to coach has moved",
      body: [
        `Hi ${escapeHtml(firstName(c.full_name))},`,
        `<strong>${escapeHtml(course.title)}</strong> has been moved to a new date.`,
        `<strong>Was:</strong> ${longDate(oldStart)}<br><strong>Now:</strong> ${longDate(startsAt)}${endsAt ? " – " + longDate(endsAt) : ""}`,
        venueLine(course),
        `Let us know as soon as you can if the new date does not work for you. We will confirm before anyone books travel, as usual.`,
      ],
    });
    if (ok) coachesEmailed++;
  }

  await adminSummary(
    `Course rescheduled: ${course.title}`,
    `${admin.full_name} moved ${course.title} from ${longDate(oldStart)} to ${longDate(startsAt)}.\n\n` +
    `${people.length} participant${people.length === 1 ? "" : "s"} emailed: ${emailed} sent.\n` +
    `${coaches.length} coach${coaches.length === 1 ? "" : "es"} emailed: ${coachesEmailed} sent.\n` +
    `${movedInvoices} pending balance invoice${movedInvoices === 1 ? "" : "s"} moved.`
  );

  return json({
    ok: true,
    participants: people.length,
    emailed,
    coachesEmailed,
    movedInvoices,
  });
}

// ---------------------------------------------------------------
// cancel and refund
// ---------------------------------------------------------------
async function cancel(course, body, admin) {
  const reason = (body.reason || "").trim();
  const people = await participants(course.id);

  const results = [];
  let refundedTotal = 0;
  let currency = null;

  for (const p of people) {
    const { data: pays } = await supabase
      .from("payments")
      .select("id, sequence, amount_cents, status, stripe_payment_intent_id, stripe_invoice_id")
      .eq("registration_id", p.id)
      .order("sequence", { ascending: true });

    let personRefunded = 0;
    const problems = [];

    for (const pay of pays || []) {
      // Money already taken comes back.
      if (pay.status === "paid" && pay.stripe_payment_intent_id) {
        try {
          const refund = await stripe.refunds.create({
            payment_intent: pay.stripe_payment_intent_id,
            reason: "requested_by_customer",
            metadata: { course_slug: course.slug, cancelled_by: admin.full_name },
          });
          personRefunded += refund.amount || pay.amount_cents || 0;
          await supabase.from("payments")
            .update({ status: "refunded", last_error: null })
            .eq("id", pay.id);
        } catch (err) {
          problems.push(`instalment ${pay.sequence}: ${err.message}`);
          await supabase.from("payments")
            .update({ last_error: "Refund failed: " + err.message })
            .eq("id", pay.id);
        }
        continue;
      }

      // Money not yet taken must never be taken. Voiding the invoice
      // matters more than the refunds — without it Stripe would still
      // charge the balance for a course that is not happening.
      if (pay.stripe_invoice_id) {
        try {
          const inv = await stripe.invoices.retrieve(pay.stripe_invoice_id);
          if (inv.status === "draft") {
            await stripe.invoices.del(pay.stripe_invoice_id);
          } else if (inv.status === "open") {
            await stripe.invoices.voidInvoice(pay.stripe_invoice_id);
          }
          await supabase.from("payments")
            .update({ status: "refunded", last_error: null })
            .eq("id", pay.id);
        } catch (err) {
          problems.push(`unpaid balance: ${err.message}`);
        }
      }
    }

    await supabase.from("registrations")
      .update({ payment_status: "refunded" })
      .eq("id", p.id);

    refundedTotal += personRefunded;
    currency = currency || p.currency;
    results.push({ email: p.email, refunded: personRefunded, problems });
  }

  // Off sale, out of the list.
  await supabase.from("courses")
    .update({ status: "cancelled", archived: true })
    .eq("id", course.id);

  // ---- participants: the apology and the money ----
  let emailed = 0;
  for (const p of people) {
    const r = results.find((x) => x.email === p.email);
    const amount = r && r.refunded ? money(r.refunded, p.currency) : null;

    const ok = await sendEmail({
      to: p.email,
      subject: `${course.title} has been cancelled`,
      heading: "We have had to cancel this course",
      body: [
        `Hi ${escapeHtml(p.first_name)},`,
        `I am sorry to say we have had to cancel <strong>${escapeHtml(course.title)}</strong> on ${longDate(course.starts_at)}.`,
        reason ? escapeHtml(reason) : `This was our decision and not something you did — we would rather cancel than run a course that would not be worth your time.`,
        amount
          ? `<strong>You will be refunded ${amount} in full.</strong> The refund has already been sent back to your card and normally lands within five to ten working days, depending on your bank. You do not need to do anything.`
          : `<strong>You will be refunded in full.</strong> We are processing this now — it normally lands within five to ten working days.`,
        `If you would rather move to another date or another location, reply to this email and we will arrange it.`,
        `Apologies again for the disruption.`,
      ],
    });
    if (ok) emailed++;
  }

  // ---- coaches: it is off. No money, no travel assumptions. ----
  const coaches = await assignedCoaches(course.id);
  let coachesEmailed = 0;
  for (const c of coaches) {
    const ok = await sendEmail({
      to: c.email,
      subject: `Cancelled: ${course.title}`,
      heading: "A course you were down to coach has been cancelled",
      body: [
        `Hi ${escapeHtml(firstName(c.full_name))},`,
        `<strong>${escapeHtml(course.title)}</strong> on ${longDate(course.starts_at)} is no longer going ahead, so you can take it out of your diary.`,
        venueLine(course),
        `If you had booked anything for it, reply to this email and we will sort it out.`,
        `Participants have been contacted directly.`,
      ],
    });
    if (ok) coachesEmailed++;
  }

  const failures = results.filter((r) => r.problems.length);
  await adminSummary(
    `Course cancelled: ${course.title}`,
    `${admin.full_name} cancelled ${course.title} (${longDate(course.starts_at)}).\n\n` +
    `${people.length} participant${people.length === 1 ? "" : "s"}, ${emailed} emailed.\n` +
    `${coaches.length} coach${coaches.length === 1 ? "" : "es"}, ${coachesEmailed} emailed.\n` +
    `Refunded: ${money(refundedTotal, currency || "EUR")}\n\n` +
    (failures.length
      ? "NEEDS ATTENTION — these did not refund cleanly:\n" +
        failures.map((f) => `  ${f.email}: ${f.problems.join("; ")}`).join("\n")
      : "All refunds went through cleanly.")
  );

  return json({
    ok: true,
    participants: people.length,
    emailed,
    coachesEmailed,
    refunded_cents: refundedTotal,
    problems: failures,
  });
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

async function participants(courseId) {
  const { data } = await supabase
    .from("registrations")
    .select("id, first_name, last_name, email, currency, payment_status")
    .eq("course_id", courseId)
    .not("payment_status", "in", '("refunded","failed")');
  return data || [];
}

async function assignedCoaches(courseId) {
  const { data } = await supabase
    .from("course_staff")
    .select("staff ( id, full_name, email, active )")
    .eq("course_id", courseId);

  return (data || [])
    .map((r) => r.staff)
    .filter((s) => s && s.active && s.email);
}

function firstName(full) {
  return String(full || "").trim().split(" ")[0] || "there";
}

function courseUrl(course) {
  const site = process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app";
  return `${site.replace(/\/$/, "")}/c/${course.slug}/`;
}

function venueLine(course) {
  const where = [course.venue_name, course.city, course.country].filter(Boolean).join(", ");
  return where ? `<strong>Where:</strong> ${escapeHtml(where)} — unchanged.` : "";
}

function longDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function money(cents, currency) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency", currency: currency || "EUR",
  }).format((cents || 0) / 100);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// A plain, well-set email. No images, no columns — it renders the
// same in Gmail, Outlook and Apple Mail, which matters more here
// than anything decorative.
function template({ heading, body, cta }) {
  const paras = body
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#16181b">${p}</p>`)
    .join("");

  const button = cta
    ? `<p style="margin:28px 0 8px">
         <a href="${cta.url}" style="display:inline-block;background:#16181b;color:#ffffff;
            text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:4px">
           ${cta.label}</a>
       </p>`
    : "";

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f3f0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f0">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border:1px solid #e0ddd7;border-radius:6px">
        <tr><td style="padding:14px 28px;background:#0d0e10;border-radius:5px 5px 0 0">
          <span style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#9aa1a9;
                       font-family:Helvetica,Arial,sans-serif">BirdBox Coaching</span>
        </td></tr>
        <tr><td style="padding:28px;font-family:Helvetica,Arial,sans-serif">
          <h1 style="margin:0 0 18px;font-size:21px;line-height:1.25;color:#16181b;font-weight:650">
            ${heading}</h1>
          ${paras}
          ${button}
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #e0ddd7;
                       font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6c7178">
          Questions? Just reply to this email.<br>
          BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendEmail({ to, subject, heading, body, cta }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) {
    console.warn("Email not sent (no key or no address):", subject, to);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox Coaching <${FROM}>`,
        to: [to],
        reply_to: REPLY_TO,
        subject,
        html: template({ heading, body, cta }),
      }),
    });
    if (!res.ok) {
      console.error("Resend rejected email to", to, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Could not send email to", to, err.message);
    return false;
  }
}

// Goes to info@ only. Never to coaches.
async function adminSummary(subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("ADMIN SUMMARY:", subject, text); return; }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox <${FROM}>`,
        to: [ADMIN_EMAIL],
        subject: "[BirdBox] " + subject,
        text,
      }),
    });
  } catch (err) {
    console.error("Could not send admin summary:", err.message);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
