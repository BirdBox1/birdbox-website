// netlify/functions/abandoned-nudge.mjs
//
// Runs hourly. Finds anybody who tried to register and did not get
// through, and offers them a hand — but only once, and only if they
// have not already come back on their own.
//
// The hour's wait is the whole point. Most people whose card is
// declined try again within minutes, usually with a different card,
// and an email arriving in that window is noise. The ones worth
// writing to are the ones who gave up.
//
// The email is deliberately plain: no banner, no buttons, no branded
// header. It works because it reads as though a person noticed and
// offered to help, and that is exactly what dressing it up would
// destroy.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const SITE_URL = (process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app")
  .replace(/\/+$/, "");

const OFFICE = "info@birdboxcoaching.com";

// How long to wait before offering. Long enough that anybody who was
// going to retry has done so.
const WAIT_HOURS = 1;

// And how far back to look. Without this, a function that has been
// broken for a fortnight would come back to life and write to two
// weeks of people at once, which is worse than never writing at all.
const GIVE_UP_AFTER_DAYS = 7;

export default async () => {
  const now = Date.now();
  const readyBefore = new Date(now - WAIT_HOURS * 3600 * 1000).toISOString();
  const tooOld = new Date(now - GIVE_UP_AFTER_DAYS * 86400 * 1000).toISOString();

  const { data: waiting, error } = await supabase
    .from("abandoned_checkouts")
    .select("id, email, first_name, course_id, abandoned_at, " +
            "courses ( title, slug, city, country, starts_at, timezone, status )")
    .is("recovered_at", null)
    .is("nudged_at", null)
    .lt("abandoned_at", readyBefore)
    .gt("abandoned_at", tooOld)
    .order("abandoned_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Could not read abandoned checkouts:", error.message);
    return new Response("error", { status: 500 });
  }

  if (!waiting || !waiting.length) {
    return new Response("nothing waiting", { status: 200 });
  }

  let sent = 0;
  let skipped = 0;

  for (const row of waiting) {
    const course = row.courses;

    // The course may have been cancelled or filled since they tried.
    // Inviting somebody back to a course they cannot join is worse
    // than staying quiet.
    if (!course || course.status !== "published") {
      await close(row.id, "the course is no longer open");
      skipped++;
      continue;
    }

    // Belt and braces. The webhook closes these off when somebody
    // comes back, but a registration made any other way — a host
    // code, or added by hand in the portal — would not have.
    const { data: already } = await supabase
      .from("registrations")
      .select("id")
      .eq("course_id", row.course_id)
      .ilike("email", row.email)
      .limit(1);

    if (already && already.length) {
      await close(row.id, "they registered another way");
      skipped++;
      continue;
    }

    const ok = await offerHelp(row, course);
    await close(row.id, ok ? "sent" : "the email was rejected");
    if (ok) sent++;
  }

  console.log(`Abandoned checkouts: ${sent} offered help, ${skipped} skipped.`);
  return new Response(`sent ${sent}, skipped ${skipped}`, { status: 200 });
};

// Marked either way. A send that failed is not worth retrying every
// hour for a week — one attempt, then leave them alone.
async function close(id, why) {
  const { error } = await supabase
    .from("abandoned_checkouts")
    .update({ nudged_at: new Date().toISOString() })
    .eq("id", id);

  if (error) console.error("Could not close", id, error.message);
  else console.log("Closed", id, "—", why);
}

async function offerHelp(row, course) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("No RESEND_API_KEY — nothing sent to", row.email);
    return false;
  }

  const first = (row.first_name || "").trim().split(" ")[0] || "there";
  const link = `${SITE_URL}/c/${course.slug}/`;
  const where = [course.city, course.country].filter(Boolean).join(", ");

  const when = course.starts_at
    ? new Date(course.starts_at).toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
        timeZone: safeZone(course.timezone),
      })
    : null;

  const title = course.title + (where ? ` in ${where}` : "") +
                (when ? ` on ${when}` : "");

  // Written the way it would be written by hand, because that is why
  // it works. No subject line about completing a purchase, nothing
  // that reads as though a system noticed rather than a person.
  const text =
`Hi ${first},

I saw you were part way through registering for ${title}, and that it did not go through. That is usually the bank rather than anything you did — a card that does not like a foreign payment, or a limit that needs a tap in a banking app.

Your place is not booked yet, but nothing is lost. You can pick up where you left off here:

${link}

If it will not go through a second time, just reply to this email and tell me. We can take it another way, or sort out a different card, or hold you a place while you get it fixed. It is genuinely no trouble.

Either way I hope to see you there.

Nathan

BirdBox Coaching
${OFFICE}`;

  const html =
`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1a1a1a;max-width:540px;">
<p>Hi ${esc(first)},</p>
<p>I saw you were part way through registering for <strong>${esc(title)}</strong>, and that it did not go through. That is usually the bank rather than anything you did &mdash; a card that does not like a foreign payment, or a limit that needs a tap in a banking app.</p>
<p>Your place is not booked yet, but nothing is lost. You can pick up where you left off here:</p>
<p><a href="${link}" style="color:#2f7fd0;">${link}</a></p>
<p>If it will not go through a second time, just reply to this email and tell me. We can take it another way, or sort out a different card, or hold you a place while you get it fixed. It is genuinely no trouble.</p>
<p>Either way I hope to see you there.</p>
<p>Nathan</p>
<p style="color:#888;font-size:13px;margin-top:24px;">BirdBox Coaching<br>
<a href="mailto:${OFFICE}" style="color:#888;">${OFFICE}</a></p>
</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Nathan at BirdBox Coaching <${process.env.CONFIRM_FROM || OFFICE}>`,
        to: [row.email],
        reply_to: OFFICE,
        subject: `Did you still want a place on ${course.title}?`,
        text,
        html,
      }),
    });

    if (!res.ok) {
      console.error("Resend rejected the offer to", row.email, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Could not write to", row.email, err.message);
    return false;
  }
}

function safeZone(tz) {
  if (!tz) return undefined;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return tz; }
  catch { return undefined; }
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const config = { schedule: "@hourly" };
