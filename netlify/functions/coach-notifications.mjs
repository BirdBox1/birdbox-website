// netlify/functions/coach-notifications.mjs
//
// Runs once a day at 08:00 UTC. Tells each lead coach who is waiting
// for a welcome email, and chases anyone still waiting after three
// days.
//
// Deliberately a scheduled sweep rather than something fired at the
// moment of registration. A trigger would miss the case that matters
// most: a course with people already booked that only gets a lead
// coach assigned months later. This asks "who is owed a welcome"
// every morning, so that case needs no special handling.
//
// Nothing is sent when there is nothing to say. A coach with no new
// registrations hears nothing at all.

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

// How long a participant may wait before the coach is chased.
const OVERDUE_DAYS = 3;

export default async () => {
  try {
    const now = new Date();

    // ---- courses still ahead of us ----------------------------
    const { data: courses, error: cErr } = await supabase
      .from("courses")
      .select("id, title, city, country, starts_at, timezone, status, archived")
      .eq("archived", false)
      .neq("status", "cancelled")
      .gte("starts_at", now.toISOString());

    if (cErr) throw new Error("courses: " + cErr.message);
    if (!courses || !courses.length) return done("no upcoming courses");

    const courseIds = courses.map((c) => c.id);
    const courseById = Object.fromEntries(courses.map((c) => [c.id, c]));

    // ---- who leads them ---------------------------------------
    const { data: leads, error: lErr } = await supabase
      .from("course_staff")
      .select("course_id, staff_id, staff ( id, full_name, email, active )")
      .in("course_id", courseIds)
      .eq("role", "lead_coach");

    if (lErr) throw new Error("course_staff: " + lErr.message);

    const leadByCourse = {};
    for (const row of leads || []) {
      const s = row.staff;
      if (s && s.active && s.email) leadByCourse[row.course_id] = s;
    }

    const ledCourseIds = Object.keys(leadByCourse);
    if (!ledCourseIds.length) return done("no courses have a lead coach yet");

    // ---- who is registered ------------------------------------
    const { data: regs, error: rErr } = await supabase
      .from("registrations")
      .select("id, course_id, first_name, last_name, email, status, payment_status, created_at")
      .in("course_id", ledCourseIds)
      .order("created_at", { ascending: true });

    if (rErr) throw new Error("registrations: " + rErr.message);

    const active = (regs || []).filter(
      (r) => (r.status || "active") === "active" &&
             r.payment_status !== "refunded" &&
             r.payment_status !== "failed"
    );
    if (!active.length) return done("nobody registered on led courses");

    // ---- who has already been welcomed ------------------------
    // Read from the same table the portal's pill reads, so the two can
    // never disagree about whether an email went out.
    const { data: welcomes, error: wErr } = await supabase
      .from("course_emails")
      .select("registration_id, status")
      .in("course_id", ledCourseIds)
      .eq("kind", "welcome");

    if (wErr) throw new Error("course_emails: " + wErr.message);

    const welcomed = new Set(
      (welcomes || [])
        .filter((w) => w.registration_id && w.status === "sent")
        .map((w) => w.registration_id)
    );

    // ---- what each coach has already been told ----------------
    const { data: told, error: nErr } = await supabase
      .from("coach_notifications")
      .select("registration_id, staff_id, kind")
      .in("course_id", ledCourseIds);

    if (nErr) throw new Error("coach_notifications: " + nErr.message);

    const alreadyTold = new Set(
      (told || []).map((t) => `${t.registration_id}|${t.staff_id}|${t.kind}`)
    );

    // ---- work out who is owed what ----------------------------
    const perCoach = {};

    for (const r of active) {
      // Someone the coach has already written to is not mentioned at
      // all — including on the first pass. A coach who is on top of it
      // should hear nothing.
      if (welcomed.has(r.id)) continue;

      const coach = leadByCourse[r.course_id];
      if (!coach) continue;

      const ageDays = (now - new Date(r.created_at)) / 86400000;
      const kind = ageDays >= OVERDUE_DAYS ? "welcome_overdue" : "welcome_due";
      if (alreadyTold.has(`${r.id}|${coach.id}|${kind}`)) continue;

      const bucket = (perCoach[coach.id] = perCoach[coach.id] || {
        coach, due: [], overdue: [], rows: [],
      });

      (kind === "welcome_overdue" ? bucket.overdue : bucket.due).push({
        reg: r, course: courseById[r.course_id],
      });

      bucket.rows.push({
        registration_id: r.id,
        course_id: r.course_id,
        staff_id: coach.id,
        kind,
      });

      // Someone who is already overdue on the first pass would
      // otherwise be reported again tomorrow as "new". Record both.
      if (kind === "welcome_overdue" &&
          !alreadyTold.has(`${r.id}|${coach.id}|welcome_due`)) {
        bucket.rows.push({
          registration_id: r.id,
          course_id: r.course_id,
          staff_id: coach.id,
          kind: "welcome_due",
        });
      }
    }

    const coaches = Object.values(perCoach);
    if (!coaches.length) return done("every registration is up to date");

    // ---- one digest each --------------------------------------
    let sent = 0;
    const problems = [];

    for (const bucket of coaches) {
      const ok = await sendDigest(bucket);

      if (ok) {
        sent++;
        // Only recorded once the email actually went, so a Resend
        // outage means the coach is told tomorrow rather than never.
        const { error: insErr } = await supabase
          .from("coach_notifications")
          .upsert(bucket.rows, {
            onConflict: "registration_id,staff_id,kind",
            ignoreDuplicates: true,
          });
        if (insErr) console.error("Could not record notifications:", insErr.message);
      } else {
        problems.push(bucket.coach.full_name);
      }
    }

    if (problems.length) {
      console.error("Digest failed for:", problems.join(", "));
    }

    return done(`${sent} digest(s) sent` +
      (problems.length ? `, ${problems.length} failed` : ""));
  } catch (err) {
    console.error("coach-notifications failed:", err);
    return new Response("error", { status: 500 });
  }
};

// ---------------------------------------------------------------

function where(course) {
  return [course.city, course.country].filter(Boolean).join(", ");
}

function fmtDate(iso, tz) {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: tz || "UTC",
    });
  } catch (e) {
    return new Date(iso).toLocaleDateString("en-GB");
  }
}

function line(item) {
  const c = item.course;
  const w = where(c);
  return `${item.reg.first_name} ${item.reg.last_name} — ${c.title}` +
    (w ? `, ${w}` : "") + `, ${fmtDate(c.starts_at, c.timezone)}`;
}

async function sendDigest({ coach, due, overdue }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("No Resend key; digest not sent to", coach.full_name);
    return false;
  }

  const total = due.length + overdue.length;
  const subject = overdue.length
    ? `${overdue.length} participant${overdue.length === 1 ? " is" : "s are"} still waiting to hear from you`
    : `${total} new registration${total === 1 ? "" : "s"} on your courses`;

  const parts = [`Hi ${coach.full_name.split(" ")[0]},`, ""];

  if (overdue.length) {
    parts.push(
      overdue.length === 1
        ? `This person registered more than ${OVERDUE_DAYS} days ago and has not had a welcome email yet:`
        : `These people registered more than ${OVERDUE_DAYS} days ago and have not had a welcome email yet:`,
      ...overdue.map((i) => "  - " + line(i)),
      ""
    );
  }

  if (due.length) {
    parts.push(
      due.length === 1 ? "New registration:" : "New registrations:",
      ...due.map((i) => "  - " + line(i)),
      ""
    );
  }

  parts.push(
    "You can send each of them a welcome from the portal — open the course,",
    "find them in the list, and use Send welcome.",
    "",
    SITE_URL + "/portal/",
    "",
    "BirdBox Coaching"
  );

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox Coaching <${FROM}>`,
        to: [coach.email],
        reply_to: OFFICE,
        subject: "[BirdBox] " + subject,
        text: parts.join("\n"),
      }),
    });
    if (!res.ok) {
      console.error("Resend rejected digest for", coach.full_name, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Could not send digest to", coach.full_name, err.message);
    return false;
  }
}

function done(note) {
  console.log("coach-notifications:", note);
  return new Response("ok", { status: 200 });
}

// 08:00 UTC — 09:00 in Berlin, 08:00 in Dublin.
export const config = { schedule: "0 8 * * *" };
