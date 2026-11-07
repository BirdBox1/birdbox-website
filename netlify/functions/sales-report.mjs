// netlify/functions/sales-report.mjs
//
// One month of sales on one page, for /portal/sales/ (Nathan, 7 Nov 2026).
// Admins only, read only.
//
// GET ?month=YYYY-MM   (this month if left out)
//   -> { month, kinds: { seminars, online, programming, gift_cards, other },
//        seminars: [ per course ], due: [...], total_eur, rates_ok, ... }
//
// "Taken" is money Stripe actually took this month: every successful charge
// on our Stripe account, less anything refunded, VAT included. Each charge
// is sorted into a kind from what it says it is for:
//   - a seminar or workshop: "TGC — …" style descriptions, a deposit plan,
//     or an invoice for a course (instalments, balances, group invoices)
//   - an online course: "… Online …", or an online course invoice
//   - programming: the app's subscriptions and blocks
//   - a gift card: the gift card invoice
// Anything that cannot be told apart is shown as Other, never guessed.
//
// "Sold" counts come from our own records: seminar places booked this
// month, online courses bought, new paid programming plans, gift cards.

import Stripe from "stripe";
import { db, json, userFrom } from "../lib/directory.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SEMINAR_KINDS = new Set(["plan_deposit", "plan_deposit_invoice", "plan_instalment", "group_invoice",
  "reg_instalment", "balance_invoice", "retro_invoice", "instalment", "deposit", "seminar"]);

export default async (req) => {
  const user = await userFrom(req);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const { data: staff } = await db.from("staff").select("id, role, active").eq("id", user.id).maybeSingle();
  if (!staff || !staff.active || staff.role !== "admin") return json({ error: "Admins only." }, 403);

  const q = new URL(req.url).searchParams.get("month") || "";
  const now = new Date();
  const [y, m] = /^\d{4}-\d{2}$/.test(q) ? q.split("-").map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const from = Date.UTC(y, m - 1, 1) / 1000;
  const to = Date.UTC(y, m, 1) / 1000;
  const fromIso = new Date(from * 1000).toISOString();
  const toIso = new Date(to * 1000).toISOString();

  try {
    // every charge this month
    const charges = [];
    for await (const c of stripe.charges.list({ created: { gte: from, lt: to }, limit: 100 })) charges.push(c);
    const ok = charges.filter((c) => c.status === "succeeded" && c.amount > c.amount_refunded);

    // the course names, for seminar charges found through an invoice
    const courseIds = new Set();
    const sorted = [];
    // the charges whose description says nothing: find their invoice, a few at a time
    const unclear = ok.filter((c) => !sortByCharge(c));
    const invoiceOf = {};
    for (let i = 0; i < unclear.length; i += 8) {
      await Promise.all(unclear.slice(i, i + 8).map(async (c) => {
        if (!c.payment_intent) return;
        const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent.id;
        // straight to the API: the stripe package here is older than invoice payments
        const r = await fetch("https://api.stripe.com/v1/invoice_payments?payment[type]=payment_intent"
          + `&payment[payment_intent]=${encodeURIComponent(pi)}&expand[]=data.invoice`,
          { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } })
          .then((x) => (x.ok ? x.json() : null)).catch(() => null);
        const inv = r?.data?.[0]?.invoice;
        if (inv && typeof inv === "object") invoiceOf[c.id] = inv;
      }));
    }

    for (const c of ok) {
      const s = sortByCharge(c) || sortByInvoice(invoiceOf[c.id]) || { kind: "other", label: c.description || "Payment" };
      if (s.courseId) courseIds.add(s.courseId);
      sorted.push({ ...s, cents: c.amount - c.amount_refunded, refunded: c.amount_refunded, currency: c.currency.toUpperCase(), at: c.created });
    }

    const { data: courses } = courseIds.size
      ? await db.from("courses").select("id, title, brand, starts_at").in("id", [...courseIds])
      : { data: [] };
    const courseName = Object.fromEntries((courses || []).map((c) => [c.id, c.title]));

    // euro, at today's rate (Stripe's, else the ECB's)
    const currencies = [...new Set(sorted.map((s) => s.currency))];
    const rates = await euroRates(currencies);
    const eur = (cents, cur) => cur === "EUR" ? cents : rates[cur] ? Math.round(cents / rates[cur]) : null;

    const KINDS = ["seminars", "online", "programming", "gift_cards", "other"];
    const kinds = Object.fromEntries(KINDS.map((k) => [k, { eur_cents: 0, count: 0, by_currency: {} }]));
    const perCourse = {};
    let totalEur = 0, unconverted = false;
    for (const s of sorted) {
      const k = kinds[s.kind];
      k.count++;
      k.by_currency[s.currency] = (k.by_currency[s.currency] || 0) + s.cents;
      const e = eur(s.cents, s.currency);
      if (e === null) unconverted = true; else { k.eur_cents += e; totalEur += e; }
      if (s.kind === "seminars") {
        const name = (s.courseId && courseName[s.courseId]) || s.label || "Seminar";
        const p = (perCourse[name] ||= { name, payments: 0, by_currency: {}, eur_cents: 0, places: 0 });
        p.payments++;
        p.by_currency[s.currency] = (p.by_currency[s.currency] || 0) + s.cents;
        if (e !== null) p.eur_cents += e;
      }
    }

    // sold this month, from our own records
    const [{ data: regs }, { data: onl }, { data: gifts }, { data: due }] = await Promise.all([
      db.from("registrations").select("id, course_id, status, courses ( title )")
        .gte("created_at", fromIso).lt("created_at", toIso).neq("status", "cancelled"),
      db.from("online_sales").select("id, label, amount_paid_cents, currency")
        .gte("created_at", fromIso).lt("created_at", toIso),
      db.from("gift_cards").select("id, amount_cents, currency")
        .gte("created_at", fromIso).lt("created_at", toIso),
      db.from("payments").select("amount_cents, due_date, status, registrations ( currency, courses ( title ) )")
        .gte("due_date", fromIso.slice(0, 10)).lt("due_date", toIso.slice(0, 10)).eq("status", "pending"),
    ]);
    for (const r of regs || []) {
      const name = r.courses?.title || "Seminar";
      (perCourse[name] ||= { name, payments: 0, by_currency: {}, eur_cents: 0, places: 0 }).places++;
    }
    const tr = db.schema("train");
    const { data: plans } = await tr.from("enrolments").select("id, tier")
      .gte("created_at", fromIso).lt("created_at", toIso)
      .eq("is_trial", false).eq("is_free", false).not("stripe_subscription_id", "is", null);
    const { data: trials } = await tr.from("enrolments").select("id")
      .gte("created_at", fromIso).lt("created_at", toIso).eq("is_trial", true);

    // seminar instalments still due this month
    const dueBy = {};
    for (const d of due || []) {
      const cur = (d.registrations?.currency || "EUR").toUpperCase();
      dueBy[cur] = (dueBy[cur] || 0) + (d.amount_cents || 0);
    }

    return json({
      month: `${y}-${String(m).padStart(2, "0")}`,
      total_eur_cents: totalEur,
      unconverted,
      rates,
      kinds,
      sold: {
        seminar_places: (regs || []).length,
        online_courses: (onl || []).length,
        programming_plans: (plans || []).length,
        programming_trials: (trials || []).length,
        gift_cards: (gifts || []).length,
        gift_card_value: (gifts || []).reduce((a, g) => ((a[(g.currency || "EUR").toUpperCase()] = (a[(g.currency || "EUR").toUpperCase()] || 0) + g.amount_cents), a), {}),
      },
      seminars: Object.values(perCourse).sort((a, b) => b.eur_cents - a.eur_cents || b.places - a.places),
      due_seminar_instalments: { count: (due || []).length, by_currency: dueBy },
      payments: sorted.sort((a, b) => b.at - a.at).map((s) => ({
        at: s.at, kind: s.kind, what: (s.courseId && courseName[s.courseId]) || s.label || "", cents: s.cents, currency: s.currency, refunded: s.refunded,
      })),
    });
  } catch (err) {
    console.error("sales-report:", err.message || err);
    return json({ error: "The sales could not be worked out. Try again in a minute." }, 500);
  }
};

// what a charge says it is for, when it says
function sortByCharge(c) {
  const md = c.metadata || {};
  const d = (c.description || "").trim();
  if (md.kind === "gift_card" || md.gift_card_id) return { kind: "gift_cards", label: "Gift card" };
  if (md.course_id || SEMINAR_KINDS.has(md.kind)) return { kind: "seminars", courseId: md.course_id || null, label: d.replace(/^(TGC|TCC|TEC|TWC) — /, "") || null };
  if (/online/i.test(d)) return { kind: "online", label: d.split(" — ")[0] };
  if (/^(TGC|TCC|TEC|TWC) — /.test(d)) return { kind: "seminars", label: d.replace(/^(TGC|TCC|TEC|TWC) — /, "") };
  if (/^Subscription (creation|update)$/i.test(d)) return { kind: "programming", label: "Programming" };
  return null;
}

// what its invoice says it is for
function sortByInvoice(inv) {
  if (!inv) return null;
  const md = inv.metadata || {};
  const line = inv.lines?.data?.[0] || {};
  const d = (line.description || inv.description || "").trim();
  if (md.kind === "gift_card") return { kind: "gift_cards", label: "Gift card" };
  if (md.kind === "online_course_sale" || md.kind === "online" || /online/i.test(d)) return { kind: "online", label: md.label || d.split(" — ")[0] };
  if (md.course_id || md.registration_id || md.plan_id || SEMINAR_KINDS.has(md.kind)) {
    return { kind: "seminars", courseId: md.course_id || null, label: d.replace(/^(Deposit|Remaining balance|Monthly payment[^—]*|Payment \d+ of \d+) — /i, "") };
  }
  if (md.kind === "programming" || md.purchase_id || inv.parent?.subscription_details || /athlete|programming|block/i.test(d)) {
    return { kind: "programming", label: "Programming" };
  }
  return null;
}

// how many of each currency one euro buys
async function euroRates(currencies) {
  const want = currencies.filter((c) => c !== "EUR");
  if (!want.length) return {};
  const out = {};
  try {
    const r = await fetch("https://api.stripe.com/v1/exchange_rates/eur",
      { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
    if (r.ok) {
      const d = await r.json();
      for (const c of want) if (d.rates?.[c.toLowerCase()]) out[c] = d.rates[c.toLowerCase()];
    }
  } catch { /* try the ECB below */ }
  const missing = want.filter((c) => !out[c]);
  if (missing.length) {
    try {
      const r = await fetch(`https://api.frankfurter.app/latest?from=EUR&to=${missing.join(",")}`);
      if (r.ok) { const d = await r.json(); for (const c of missing) if (d.rates?.[c]) out[c] = d.rates[c]; }
    } catch { /* shown without euro */ }
  }
  return out;
}
