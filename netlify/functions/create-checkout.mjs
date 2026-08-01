// netlify/functions/create-checkout.mjs
//
// POST { slug, option: "full" | "deposit" | "klarna", code?: "GROUP5" }
//   -> { url: "https://checkout.stripe.com/..." }
//
// Runs server-side only. The service key never reaches the browser,
// and the discounted price is recalculated here — never trusted from
// the page, which only ever sends the code itself.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { priceWithDiscount } from "./validate-discount.mjs";

// Bump this whenever the wording at /agreements/ changes.
const WAIVER_VERSION = "2026-08-v1";

// Deposit is 25% unless the course carries its own deposit_cents.
const DEPOSIT_RATE = 0.25;

// The balance is taken from the saved card this many days before
// the course starts, so nobody attends without having paid.
const BALANCE_DAYS_BEFORE = 14;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    const body = await req.json();
    const slug = body.slug;
    const option = body.option || "full";
    const code = body.code ? String(body.code).trim() : null;

    if (!slug) return json({ error: "Missing slug" }, 400);
    if (!["full", "deposit", "klarna"].includes(option)) {
      return json({ error: "Unknown payment option" }, 400);
    }

    // ---- look up the course ------------------------------------
    const { data: course, error } = await supabase
      .from("courses")
      .select("id, brand, type, title, summary, slug, price_cents, deposit_cents, currency, capacity, status, starts_at, city, country")
      .eq("slug", slug)
      .single();

    if (error || !course) return json({ error: "Course not found" }, 404);

    if (course.status !== "published") {
      return json({ error: "This course is not open for registration" }, 409);
    }

    // ---- seats left (advisory: the DB trigger is the real gate) --
    const { count } = await supabase
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .eq("course_id", course.id)
      .not("payment_status", "in", '("refunded","failed")');

    if (count !== null && count >= course.capacity) {
      return json({ error: "This course is full" }, 409);
    }

    // ---- price, after any discount -----------------------------
    let full = course.price_cents;
    let discountCents = 0;
    let appliedCode = null;
    let deposit = course.deposit_cents || Math.round(full * DEPOSIT_RATE);

    if (code) {
      const priced = await priceWithDiscount(course, code);
      if (priced.error) return json({ error: priced.error }, 409);
      full = priced.total;
      discountCents = priced.discount;
      deposit = priced.deposit;
      appliedCode = priced.row.code;
    }

    // Klarna cannot save a card, so it is full payment only.
    // Klarna pays us upfront and carries the customer's credit risk.
    const payingNow = option === "deposit" ? deposit : full;
    const balance = option === "deposit" ? full - deposit : 0;

    if (option === "deposit" && balance <= 0) {
      return json({ error: "Deposit is not available on this course" }, 409);
    }

    // Balance date: BALANCE_DAYS_BEFORE ahead of the start, but never
    // in the past — a late booking is charged the next day instead.
    let balanceDueAt = null;
    if (balance > 0) {
      const due = new Date(course.starts_at);
      due.setDate(due.getDate() - BALANCE_DAYS_BEFORE);
