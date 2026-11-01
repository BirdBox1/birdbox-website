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
import { looksLikeGift, findCard, applyCard, seminarVatPercent } from "../lib/gift-cards.mjs";
import { readPass, passUsed, passCode, PASS_PERCENT } from "../lib/learn-pass.mjs";

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
    // code: a discount code or a gift card. gift: a gift card used as
    // well as a discount code (an early-bird code and a card together).
    const { slug, code, gift, pass } = await req.json();
    if (!slug || (!code && !gift && !pass)) return json({ ok: false, error: "Missing details" }, 400);

    // starts_at is required: codes with a relative expiry (early bird)
    // are measured back from the course start, so leaving it out here
    // made every such code look inapplicable on this path, even though
    // create-checkout passes it through fine.
    const { data: course } = await supabase
      .from("courses")
      .select("id, brand, type, level, price_cents, deposit_cents, currency, status, starts_at, country")
      .eq("slug", slug)
      .single();

    if (!course) return json({ ok: false, error: "Course not found" }, 404);

    // A Level 1 Online student's 50% from BirdBox Learn (never with codes)
    if (pass) {
      const r = await priceWithPass(course, pass);
      if (r.error) return json({ ok: false, error: r.error }, 200);
      return json({ ok: true, code: r.row.code, label: r.row.label, code_discount_cents: r.discount,
        discount_cents: r.discount, total_cents: r.total, deposit_cents: r.deposit, free: false, gift: null,
        locked: { first: r.pass.first, last: r.pass.last, email: r.pass.email } });
    }

    const result = await priceWithDiscount(course, code, gift);
    if (result.error) return json({ ok: false, error: result.error }, 200);

    return json({
      ok: true,
      code: result.row.code,
      label: result.row.label || null,
      // With a code and a card: code_discount_cents is the code's share
      // of discount_cents; the card's share is in gift.
      code_discount_cents: result.codeDiscount ?? (result.gift ? 0 : result.discount),
      discount_cents: result.discount,
      total_cents: result.total,
      deposit_cents: result.deposit,
      free: !!result.free,
      // A gift card: what it pays (VAT included) and what is left on it.
      gift: result.gift ? {
        code: result.gift.code,
        covered_cents: result.gift.covered,
        balance_after_cents: result.gift.balanceAfter,
        currency: result.gift.currency,
      } : null,
    });
  } catch (err) {
    console.error("validate-discount failed:", err);
    return json({ ok: false, error: "Could not check that code" }, 500);
  }
};

// Shared by create-checkout and free-registration so the price is never
// trusted from the browser.
//
// code is a discount code or a gift card; giftCode is a gift card used
// on top of a discount code. Then the code comes off first and the card
// pays towards what is left (with VAT), so an early-bird code and a gift
// card work on the same booking.
export async function priceWithDiscount(course, code, giftCode) {
  let clean = String(code || "").trim();
  let gift = String(giftCode || "").trim();
  if (looksLikeGift(clean) && !gift) { gift = clean; clean = ""; }
  if (!clean && !gift) return { error: "Enter a code" };
  if (!clean) return priceWithGiftCard(course, gift, course.price_cents);

  const base = await priceWithCode(course, clean);
  if (base.error || !gift) return base;
  if (base.free) return { error: "That code already covers the whole price, so there is nothing for the gift card to pay." };

  const g = await priceWithGiftCard(course, gift, base.total);
  if (g.error) return g;
  return {
    row: base.row,
    codeDiscount: base.discount,
    discount: course.price_cents - g.total,
    total: g.total,
    deposit: g.deposit,
    free: g.free,
    gift: g.gift,
  };
}

// The Level 1 Online student's 50% (Nathan, 1 Nov 2026): only with a
// pass from their BirdBox Learn page, only on a Level 1 live seminar of
// the same course, and only once. See netlify/lib/learn-pass.mjs.
export async function priceWithPass(course, token) {
  const p = readPass(token);
  if (!p) return { error: "This discount link has expired. Open it again from your BirdBox Learn page." };
  const l1 = String(course.level || "").replace(/\D/g, "") === "1";
  if (course.type !== "live_seminar" || !l1 || String(course.brand).toLowerCase() !== p.brand) {
    return { error: "Your discount is for a " + p.brand.toUpperCase() + " Level 1 live seminar." };
  }
  if (await passUsed(p.email, p.brand)) return { error: "You have already used this discount." };
  const full = course.price_cents;
  const discount = Math.round(full * PASS_PERCENT / 100);
  const total = full - discount;
  const deposit = course.deposit_cents ? Math.min(course.deposit_cents, total) : Math.round(total * DEPOSIT_RATE);
  return { row: { code: passCode(p.brand), label: `Level 1 Online student: ${PASS_PERCENT}% off` },
    discount, total, deposit, free: false, pass: p };
}

// A discount code on its own (discount_codes).
async function priceWithCode(course, clean) {
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

// A gift card pays towards the price including VAT; whatever it does
// not cover is paid by card as normal. The deposit and monthly options
// still work, worked out on what is left. See netlify/lib/gift-cards.mjs.
// net is the price before VAT that the card pays towards: the full
// price, or what is left after a discount code.
async function priceWithGiftCard(course, code, net) {
  const found = await findCard(code, course.currency);
  if (found.error) return { error: found.error };
  const card = found.card;

  const vatPercent = await seminarVatPercent(course);
  const a = applyCard(card, net, vatPercent);
  if (a.covered <= 0) return { error: "That gift card cannot be used on this course" };

  const total = a.remainingNet;
  const deposit = course.deposit_cents
    ? Math.min(course.deposit_cents, total)
    : Math.round(total * DEPOSIT_RATE);

  return {
    row: { code: card.code, label: "Gift card" },
    discount: course.price_cents - total,
    total,
    deposit,
    free: a.free,
    gift: { id: card.id, code: card.code, covered: a.covered, balanceAfter: a.balanceAfter, currency: card.currency },
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
