// netlify/functions/validate-discount.mjs
//
// POST { slug: "tgc-l1-london-nov", code: "GROUP5" }
//   -> { ok: true, code, label, discount_cents, total_cents, deposit_cents }
//   -> { ok: false, error: "..." }
//
// Runs server-side using the service key. The discount_codes table has
// no public read policy on purpose — if the browser could query it,
// anyone could list every live code.

import { createClient } from "@supabase/supabase-js";

// Must match create-checkout.mjs
const DEPOSIT_RATE = 0.25;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { slug, code } = await req.json();
    if (!slug || !code) return json({ ok: false, error: "Missing details" }, 400);

    // starts_at is required: codes with a relative expiry (early bird)
    // are measured back from the course start, so leaving it out here
    // made every such code look inapplicable on this path, even though
    // create-checkout passes it through fine.
    const { data: course } = await supabase
      .from("courses")
      .select("id, brand, type, price_cents, deposit_cents, currency, status, starts_at")
      .eq("slug", slug)
      .single();

    if (!course) return json({ ok: false, error: "Course not found" }, 404);

    const result = await priceWithDiscount(course, code);
    if (result.error) return json({ ok: false, error: result.error }, 200);

    return json({
      ok: true,
      code: result.row.code,
      label: result.row.label || null,
      discount_cents: result.discount,
      total_cents: result.total,
      deposit_cents: result.deposit,
      free: !!result.free,
    });
  } catch (err) {
    console.error("validate-discount failed:", err);
    return json({ ok: false, error: "Could not check that code" }, 500);
  }
};

// Shared by create-checkout so the price is never trusted from the browser.
export async function priceWithDiscount(course, code) {
  const clean = String(code || "").trim();
  if (!clean) return { error: "Enter a code" };

  const { data: rows } = await supabase
    .from("discount_codes")
    .select("*")
    .ilike("code", clean);

  if (!rows || !rows.length) return { error: "That code isn't recognised" };

  // A code may exist both as a row for one specific course and as a
  // global row covering everything. The specific row wins; the global
  // one is the fallback. Taking rows[0] would hand a Munich customer
  // the Warsaw row and then refuse it as not applying.
  const row = rows.find((r) => r.course_id === course.id) ||
              rows.find((r) => !r.course_id);

  if (!row) return { error: "That code doesn't apply to this course" };
  if (!row.active) return { error: "That code is no longer active" };

  const now = new Date();
  if (row.starts_at && new Date(row.starts_at) > now) {
    return { error: "That code isn't active yet" };
  }
  if (row.expires_at && new Date(row.expires_at) < now) {
    return { error: "That code has expired" };
  }

  // Relative expiry — "stops working N days before the course starts".
  // This is what lets ONE global row (EB10) serve every seminar: the
  // deadline is worked out against whichever course is being bought,
  // instead of being a single fixed date shared by all of them.
  //
  // It is checked as well as expires_at, not instead of it, so a code
  // can carry both a hard end date and a per-course cut-off.
  const daysBefore = row.expires_days_before_course;
  if (daysBefore !== null && daysBefore !== undefined && daysBefore !== "") {
    // No start date means the cut-off cannot be worked out. Refusing is
    // the safe direction: the alternative is honouring an early bird
    // discount with no deadline at all.
    if (!course.starts_at) {
      return { error: "That code doesn't apply to this course" };
    }
    const cutoff = new Date(course.starts_at);
    cutoff.setDate(cutoff.getDate() - Number(daysBefore));
    if (cutoff < now) {
      return { error: "The early booking period for this course has closed" };
    }
  }

  if (row.max_redemptions !== null && row.times_redeemed >= row.max_redemptions) {
    return { error: "That code has already been used" };
  }
  if (row.brand && row.brand !== course.brand) {
    return { error: "That code doesn't apply to this course" };
  }
  if (row.course_type && row.course_type !== course.type) {
    return { error: "That code doesn't apply to this course" };
  }
  if (row.course_id && row.course_id !== course.id) {
    return { error: "That code doesn't apply to this course" };
  }

  const full = course.price_cents;
  let discount = 0;

  if (row.kind === "percent") {
    discount = Math.round(full * (Number(row.percent_off) / 100));
  } else {
    // A fixed credit only makes sense in the currency it was issued in.
    if (String(row.currency).toUpperCase() !== String(course.currency).toUpperCase()) {
      return { error: "That credit is in a different currency to this course" };
    }
    discount = row.amount_off_cents;
  }

  if (discount > full) discount = full;
  const total = full - discount;

  // A code that covers the whole price is a free place — a host claiming
  // one of theirs, or somebody a gym has paid for upfront. That is not
  // a payment at all, so it skips Stripe entirely rather than trying to
  // charge zero, which Stripe refuses.
  const free = total === 0;

  // Anything above zero still has to clear Stripe's minimum. A code
  // leaving 40 cents to pay would fail at checkout with a far worse
  // message than this one.
  if (!free && total < 100) {
    return { error: "That code cannot be used on this course" };
  }

  // Deposit is recalculated off the discounted total, so a 25% code
  // does not leave someone paying a deposit against the old price.
  const deposit = course.deposit_cents
    ? Math.min(course.deposit_cents, total)
    : Math.round(total * DEPOSIT_RATE);

  return { row, discount, total, deposit, free };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
