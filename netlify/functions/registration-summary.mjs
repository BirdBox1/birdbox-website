// netlify/functions/registration-summary.mjs
//
// GET /.netlify/functions/registration-summary?session_id=cs_...
//   -> everything the thank-you page needs to show what was bought.
//
// The session ID is only known to the person who just paid and to us,
// so it acts as the key. Even so, this returns the course and the
// amount and nothing else personal beyond a first name — never the
// email, phone or address.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const BALANCE_DAYS_BEFORE = 14;

const BRAND = {
  tcc: { name: "The Coaches Course",       colour: "#2f7fd0", icon: "/brand/tcc.png" },
  tgc: { name: "The Gymnastics Course",    colour: "#9e2029", icon: "/brand/tgc.png" },
  tec: { name: "The Endurance Course",     colour: "#1c6b3f", icon: "/brand/tec.png" },
  twc: { name: "The Weightlifting Course", colour: "#e8a317", icon: "/brand/twc.png" },
};

// Manuals exist for these brands at level 1 only, for now.
const HAS_MANUAL = ["tcc", "tgc"];

export default async (req) => {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) return json({ error: "Missing session_id" }, 400);

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer_details"],
    });

    const meta = session.metadata || {};
    const details = session.customer_details || {};

    const { data: course } = await supabase
      .from("courses")
      .select("brand, level, type, title, venue_name, address, city, country, starts_at, ends_at, timezone")
      .eq("id", meta.course_id)
      .single();

    if (!course) return json({ error: "Course not found" }, 404);

    const brandKey = String(course.brand || "").toLowerCase();
    const brand = BRAND[brandKey] || {
      name: "BirdBox Coaching", colour: "#2f7fd0", icon: "/brand/birdBox.png",
    };

    const levelDigits = String(course.level == null ? "" : course.level).replace(/\D/g, "");
    const isWorkshop = String(course.type || "").toLowerCase() === "workshop";

    // On a workshop the typed name is the point; on a seminar the
    // brand and level say it better than the internal title.
    const courseName = isWorkshop
      ? course.title
      : brand.name + (levelDigits ? " — Level " + levelDigits : "");

    const field = (key) =>
      session.custom_fields?.find((f) => f.key === key)?.text?.value?.trim();

    const firstName =
      field("firstname") ||
      (details.name || "").trim().split(" ")[0] ||
      null;

    const currency = (session.currency || "eur").toUpperCase();
    const money = (cents) =>
      new Intl.NumberFormat("en-GB", {
        style: "currency", currency, maximumFractionDigits: 0,
      }).format((cents || 0) / 100);

    const option = meta.payment_option || "full";
    const balanceCents = Number(meta.balance_cents || 0);
    const isDeposit = option === "deposit" && balanceCents > 0;

    const manualUrl =
      !isWorkshop && levelDigits === "1" && HAS_MANUAL.includes(brandKey)
        ? "/manuals/" + brandKey + "-l1/"
        : null;

    return json({
      ok: true,
      paid: session.payment_status === "paid",
      firstName,
      brand: brandKey,
      brandName: brand.name,
      colour: brand.colour,
      icon: brand.icon,
      courseName,
      isWorkshop,
      dates: formatDates(course),
      venueName: course.venue_name || null,
      address: addressLine(course),
      amountPaid: money(session.amount_total),
      isDeposit,
      balance: isDeposit ? money(balanceCents) : null,
      balanceDate: isDeposit ? formatDay(meta.balance_due_at, course.timezone) : null,
      balanceDaysBefore: BALANCE_DAYS_BEFORE,
      manualUrl,
      emailedTo: maskEmail(details.email),
    });
  } catch (err) {
    console.error("registration-summary failed:", err);
    return json({ error: "Could not load your registration" }, 500);
  }
};

// n****n@gmail.com — enough to recognise, not enough to harvest.
function maskEmail(email) {
  const value = String(email || "");
  const at = value.indexOf("@");
  if (at < 1) return null;
  const name = value.slice(0, at);
  const rest = value.slice(at);
  if (name.length <= 2) return name[0] + "***" + rest;
  return name[0] + "*".repeat(Math.min(name.length - 2, 5)) + name.slice(-1) + rest;
}

// The address field often already carries the city and country.
function addressLine(course) {
  const address = String(course.address || "").trim();
  const seen = address.toLowerCase();
  const parts = address ? [address] : [];
  for (const bit of [course.city, course.country]) {
    const value = String(bit || "").trim();
    if (!value) continue;
    if (seen.includes(value.toLowerCase())) continue;
    parts.push(value);
  }
  return parts.join(", ");
}

function formatDay(iso, zone) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: zone || "UTC",
    });
  } catch (e) {
    return null;
  }
}

function formatDates(course) {
  const zone = course.timezone || "UTC";
  const long = { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: zone };
  const start = new Date(course.starts_at);
  const startStr = start.toLocaleDateString("en-GB", long);
  if (!course.ends_at) return startStr;

  const end = new Date(course.ends_at);
  const dayIn = (d) => d.toLocaleDateString("en-GB", { timeZone: zone });
  if (dayIn(start) === dayIn(end)) return startStr;

  const part = (d, opts) => d.toLocaleDateString("en-GB", { ...opts, timeZone: zone });
  const sameMonth =
    part(start, { month: "long", year: "numeric" }) ===
    part(end, { month: "long", year: "numeric" });

  if (sameMonth) {
    return part(start, { day: "numeric" }) + "–" +
           part(end, { day: "numeric", month: "long", year: "numeric" });
  }
  return part(start, { day: "numeric", month: "long" }) + " – " +
         part(end, { day: "numeric", month: "long", year: "numeric" });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
