// netlify/functions/free-registration.mjs
//
// A place that costs nothing: a host claiming one of the free spots
// they get for hosting, or somebody a gym has paid for upfront.
//
// Stripe is not involved at all — it cannot process a zero-amount
// payment, and there is nothing to collect anyway. That means this
// function has to do everything the webhook normally does: check the
// code, check there is room, record the waiver, write the
// registration, burn the redemption, and send the confirmation.
//
// Nothing here trusts the browser. The code is revalidated and the
// price recalculated server-side, so a page with the numbers edited
// gets exactly the same answer as an honest one.

import { createClient } from "@supabase/supabase-js";
import { priceWithDiscount } from "./validate-discount.mjs";
import { sendConfirmation } from "./stripe-webhook.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Must match the wording at /agreements/.
const WAIVER_VERSION = "2026-08-v1";

const OFFICE = "info@birdboxcoaching.com";
const FROM = process.env.ALERT_FROM || OFFICE;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const body = await req.json();
    const slug = String(body.slug || "").trim();
    const code = String(body.code || "").trim();
    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const accepted = body.accepted === true;

    if (!slug || !code) return json({ error: "Missing details" }, 400);
    if (!firstName || !lastName) return json({ error: "Both names are needed — your certificate uses them." }, 400);
    if (!email || !email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
      return json({ error: "A valid email address is needed." }, 400);
    }
    if (!accepted) {
      return json({ error: "The terms and the waiver have to be accepted." }, 400);
    }

    // ---- the course -------------------------------------------
    const { data: course, error: cErr } = await supabase
      .from("courses")
      .select("id, brand, type, level, title, slug, price_cents, deposit_cents, currency, capacity, status, starts_at, ends_at, grants_online_course")
      .eq("slug", slug)
      .single();

    if (cErr || !course) return json({ error: "Course not found" }, 404);
    if (course.status !== "published") {
      return json({ error: "This course is not open for registration" }, 409);
    }
    if (new Date(course.ends_at || course.starts_at) < new Date()) {
      return json({ error: "This course has already finished" }, 409);
    }

    // ---- the code, checked here and not taken on trust ---------
    const priced = await priceWithDiscount(course, code);
    if (priced.error) return json({ error: priced.error }, 409);

    // Someone could send any code they like to this endpoint. Only a
    // code that genuinely covers the whole price gets a free place;
    // anything else belongs at Stripe.
    if (!priced.free) {
      return json({ error: "That code does not cover the whole price." }, 409);
    }

    // ---- is there room ----------------------------------------
    // Advisory only — the database trigger is the real gate, and it is
    // checked again by the insert below.
    const { count } = await supabase
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .eq("course_id", course.id)
      .not("payment_status", "in", '("refunded","failed")');

    if (count !== null && course.capacity != null && count >= course.capacity) {
      return json({ error: "This course is full" }, 409);
    }

    // ---- already registered -----------------------------------
    // A host clicking twice should not end up with two places, and the
    // message should say so rather than looking like a failure.
    const { data: already } = await supabase
      .from("registrations")
      .select("id, status")
      .eq("course_id", course.id)
      .ilike("email", email)
      .maybeSingle();

    if (already && (already.status || "active") === "active") {
      return json({
        error: "That email address is already registered for this course.",
      }, 409);
    }

    // ---- write it ---------------------------------------------
    const { data: registration, error: rErr } = await supabase
      .from("registrations")
      .insert({
        course_id: course.id,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        waiver_signed_at: new Date().toISOString(),
        waiver_version: WAIVER_VERSION,
        payment_status: "paid_in_full",
        amount_paid_cents: 0,
        currency: course.currency,
        discount_code: priced.row.code,
        discount_cents: priced.discount,
        source: "host_code",
        source_note: `Free place — ${priced.row.label || priced.row.code}`,
      })
      .select("id")
      .single();

    if (rErr) {
      // 23514 is the capacity trigger. Anything else is unexpected and
      // worth knowing about, because nobody has paid and nobody has a
      // place either.
      console.error("Free registration failed", { slug, email, error: rErr });
      return json({
        error: rErr.code === "23514"
          ? "This course is full"
          : "Something went wrong registering you. Email " + OFFICE + " and we will sort it.",
      }, 409);
    }

    // A place that cost nothing still gets a payment row, so the course
    // list adds up and nobody looks at it later wondering what happened.
    await supabase.from("payments").insert({
      registration_id: registration.id,
      sequence: 1,
      amount_cents: 0,
      due_date: new Date().toISOString().slice(0, 10),
      charged_at: new Date().toISOString(),
      status: "paid",
    });

    // ---- burn the redemption ----------------------------------
    // This is what stops a host code being shared beyond its two uses.
    const { error: bumpErr } = await supabase.rpc("bump_discount_redemption", {
      p_code: priced.row.code,
      p_course_id: course.id,
    });
    if (bumpErr) {
      console.error("Could not count free redemption", priced.row.code, bumpErr);
      await alert(
        "Free place taken but not counted",
        `${firstName} ${lastName} (${email}) used ${priced.row.code} on ` +
        `${course.slug}, but the redemption count did not increase. The code ` +
        `may now be usable more times than intended.`
      );
    }

    // ---- the same confirmation everyone else gets --------------
    await sendConfirmation({
      courseId: course.id,
      email,
      firstName,
      option: "full",
      balanceCents: 0,
      online: null,
    });

    return json({ ok: true, registrationId: registration.id });
  } catch (err) {
    console.error("free-registration failed:", err);
    return json({ error: "Could not complete that registration" }, 500);
  }
};

async function alert(subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("ALERT:", subject, text); return; }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox Coaching <${FROM}>`,
        to: [OFFICE],
        subject: "[BirdBox] " + subject,
        text,
      }),
    });
  } catch (err) {
    console.error("Could not send alert:", err.message);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
