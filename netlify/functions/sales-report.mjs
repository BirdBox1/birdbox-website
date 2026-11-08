// netlify/functions/sales-report.mjs
//
// One month of sales on one page, for /portal/sales/ (Nathan, 7 Nov 2026).
// Admins only, read only.
//
// GET ?month=YYYY-MM              (this month if left out)
//   -> taken, sold, paid out to the bank, for that month
// GET ?part=outlook
//   -> plan payments still to come, from today on
//
// Which Stripe accounts (Nathan, 8 Nov 2026): every account of the Irish
// company, read only. Never GymProg LLC, and nothing paid into the US
// account. Each account needs its own key in Netlify; an account with no
// key is left out and the page says so.
//
// "Taken" is money Stripe actually took this month, VAT included, in euro
// as Stripe converted it on the day (so a month's figure does not move
// with the exchange rate). A refund counts in the month it was given, not
// against the month of the payment. Each payment is sorted into a kind
// from what it says it is for; anything that cannot be told apart is
// shown as Other, never guessed.
//
// "Paid out" is what Stripe sent to the bank this month (after fees and
// refunds, a few days after the payments). It is the figure to match
// against the Revolut statement.
//
// "New sales" is the full value of what was sold this month, including
// plan payments still to come: seminar places booked, online courses
// bought, gift cards. Programming is month to month (it can be cancelled
// any time), so it counts only what was taken.
//
// "Still to come" (part=outlook) is the plan payments Stripe is set to
// take: seminar instalments (scheduled invoices), invoices sent and not
// yet paid, online course plans, and the old academy's plans. Never
// programming. Our own payments table is not used for this: its status
// is not kept up to date (paid instalments still say pending).

import Stripe from "stripe";
import { db, json, userFrom } from "../lib/directory.mjs";

const ACCOUNTS = [
  { id: "main", name: "BirdBox Coaching (main)", env: "STRIPE_SECRET_KEY" },
  { id: "learnworlds", name: "Old academy (LearnWorlds and Paythen)", env: "STRIPE_READ_KEY_LEARNWORLDS" },
  { id: "coachrx", name: "Old programming (CoachRx)", env: "STRIPE_READ_KEY_COACHRX" },
];
const SEMINAR_KINDS = new Set(["plan_deposit", "plan_deposit_invoice", "plan_instalment", "group_invoice",
  "reg_instalment", "balance_invoice", "retro_invoice", "instalment", "deposit", "seminar"]);
const ONLINE_PLAN_KIND = "online_course_sale";
const KINDS = ["seminars", "online", "programming", "gift_cards", "other"];

export default async (req) => {
  const user = await userFrom(req);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const { data: staff } = await db.from("staff").select("id, role, active").eq("id", user.id).maybeSingle();
  if (!staff || !staff.active || staff.role !== "admin") return json({ error: "Admins only." }, 403);

  const params = new URL(req.url).searchParams;
  const accounts = ACCOUNTS.filter((a) => process.env[a.env])
    .map((a) => ({ ...a, stripe: new Stripe(process.env[a.env]) }));
  const missing = ACCOUNTS.filter((a) => !process.env[a.env]).map((a) => a.name);

  try {
    if (params.get("part") === "outlook") return json({ ...(await outlook(accounts)), missing_accounts: missing });
    return json({ ...(await month(accounts, params.get("month") || "")), missing_accounts: missing });
  } catch (err) {
    console.error("sales-report:", err.message || err);
    return json({ error: "The sales could not be worked out. Try again in a minute." }, 500);
  }
};

/* ---------------- one month ---------------- */

async function month(accounts, q) {
  const now = new Date();
  const [y, m] = /^\d{4}-\d{2}$/.test(q) ? q.split("-").map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const from = Date.UTC(y, m - 1, 1) / 1000;
  const to = Date.UTC(y, m, 1) / 1000;
  const fromIso = new Date(from * 1000).toISOString();
  const toIso = new Date(to * 1000).toISOString();

  // every account at once: payments, refunds and payouts this month
  const perAccount = await Promise.all(accounts.map((a) => accountMonth(a, from, to)));

  const kinds = Object.fromEntries(KINDS.map((k) => [k, { eur_cents: 0, count: 0, by_currency: {} }]));
  const perCourse = {};
  const payments = [];
  const courseIds = new Set();
  let totalEur = 0, feesEur = 0, refundsEur = 0, unconverted = false;

  for (const acc of perAccount) {
    for (const p of acc.items) {
      const k = kinds[p.kind];
      if (!p.refund) k.count++;
      k.by_currency[p.currency] = (k.by_currency[p.currency] || 0) + p.cents;
      if (p.eur === null) unconverted = true;
      else { k.eur_cents += p.eur; totalEur += p.eur; if (p.refund) refundsEur += p.eur; }
      if (p.fee_eur) feesEur += p.fee_eur;
      if (p.courseId) courseIds.add(p.courseId);
      payments.push(p);
    }
  }

  const { data: courses } = courseIds.size
    ? await db.from("courses").select("id, title").in("id", [...courseIds])
    : { data: [] };
  const courseName = Object.fromEntries((courses || []).map((c) => [c.id, c.title]));
  for (const p of payments) {
    if (p.kind !== "seminars") continue;
    const name = (p.courseId && courseName[p.courseId]) || p.label || "Seminar";
    const row = (perCourse[name] ||= { name, payments: 0, by_currency: {}, eur_cents: 0, places: 0 });
    if (!p.refund) row.payments++;
    row.by_currency[p.currency] = (row.by_currency[p.currency] || 0) + p.cents;
    if (p.eur !== null) row.eur_cents += p.eur;
  }

  // sold this month, from our own records, at full value
  const sold = await soldThisMonth(fromIso, toIso, perCourse);
  const todayRates = await euroRates([...new Set([
    ...Object.keys(sold.value_by_kind.seminars), ...Object.keys(sold.value_by_kind.online),
    ...Object.keys(sold.value_by_kind.gift_cards)])]);
  const toEur = (byCur) => Object.entries(byCur).reduce((t, [c, v]) =>
    t + (c === "EUR" ? v : todayRates[c] ? Math.round(v / todayRates[c]) : 0), 0);
  const newSales = {
    seminars: { by_currency: sold.value_by_kind.seminars, eur_cents: toEur(sold.value_by_kind.seminars) },
    online: { by_currency: sold.value_by_kind.online, eur_cents: toEur(sold.value_by_kind.online) },
    gift_cards: { by_currency: sold.value_by_kind.gift_cards, eur_cents: toEur(sold.value_by_kind.gift_cards) },
    programming: { by_currency: { ...kinds.programming.by_currency }, eur_cents: kinds.programming.eur_cents },
  };
  const newSalesTotal = Object.values(newSales).reduce((t, x) => t + (x.eur_cents || 0), 0);

  // paid out to the bank
  const payouts = perAccount.flatMap((a) => a.payouts).sort((a, b) => a.arrival - b.arrival);
  const paidOut = {};
  for (const p of payouts) paidOut[p.currency] = (paidOut[p.currency] || 0) + p.cents;

  return {
    month: `${y}-${String(m).padStart(2, "0")}`,
    accounts: accounts.map((a) => a.name),
    total_eur_cents: totalEur,
    refunds_eur_cents: refundsEur,
    fees_eur_cents: feesEur,
    unconverted,
    kinds,
    sold: {
      seminar_places: sold.places,
      online_courses: sold.online_courses,
      programming_plans: sold.programming_plans,
      programming_trials: sold.programming_trials,
      gift_cards: sold.gift_cards,
      gift_card_value: sold.value_by_kind.gift_cards,
    },
    new_sales: { ...newSales, total_eur_cents: newSalesTotal },
    paid_out: { by_currency: paidOut, payouts },
    seminars: Object.values(perCourse).sort((a, b) => b.eur_cents - a.eur_cents || b.places - a.places),
    payments: payments.sort((a, b) => b.at - a.at).map((p) => ({
      at: p.at, kind: p.kind, refund: !!p.refund, account: p.account,
      what: (p.courseId && courseName[p.courseId]) || p.label || "", cents: p.cents, currency: p.currency,
    })),
  };
}

// One account's month: payments and refunds (in euro as settled), payouts.
async function accountMonth(a, from, to) {
  const s = a.stripe;
  const [charges, refunds, payouts] = await Promise.all([
    listAll(s.charges, { created: { gte: from, lt: to }, expand: ["data.balance_transaction"] }),
    listAll(s.refunds, { created: { gte: from, lt: to }, expand: ["data.balance_transaction", "data.charge"] }),
    listAll(s.payouts, { arrival_date: { gte: from, lt: to }, expand: ["data.destination"] }),
  ]);

  const ok = charges.filter((c) => c.status === "succeeded" && c.captured);
  const okRefunds = refunds.filter((r) => r.status === "succeeded" || r.status === "pending");

  // what each payment was for
  const sortOf = new Map();
  const unclear = [];
  for (const c of [...ok, ...okRefunds.map((r) => r.charge).filter((c) => c && typeof c === "object")]) {
    if (sortOf.has(c.id) || unclear.some((u) => u.id === c.id)) continue;
    const sorted = sortFor(a.id, c);
    if (sorted) sortOf.set(c.id, sorted); else unclear.push(c);
  }
  if (a.id === "main") {
    for (let i = 0; i < unclear.length; i += 8) {
      await Promise.all(unclear.slice(i, i + 8).map(async (c) => {
        const inv = await invoiceOf(a, c);
        sortOf.set(c.id, sortByInvoice(inv) || { kind: "other", label: c.description || "Payment" });
      }));
    }
  }
  for (const c of unclear) if (!sortOf.has(c.id)) sortOf.set(c.id, { kind: "other", label: c.description || "Payment" });

  const items = [];
  for (const c of ok) {
    const bt = c.balance_transaction;
    items.push({
      ...sortOf.get(c.id), account: a.name, at: c.created,
      cents: c.amount, currency: c.currency.toUpperCase(),
      eur: await settledEur(bt, c.amount, c.currency, c.created),
      fee_eur: bt && typeof bt === "object" && bt.fee
        ? (bt.currency === "eur" ? bt.fee : await dayRateEur(bt.fee, bt.currency, c.created)) || 0
        : 0,
    });
  }
  for (const r of okRefunds) {
    const c = typeof r.charge === "object" ? r.charge : null;
    const sorted = (c && sortOf.get(c.id)) || { kind: "other", label: "" };
    const eur = await settledEur(r.balance_transaction, r.amount, r.currency, r.created);
    items.push({
      ...sorted, label: "Refund: " + (sorted.label || "payment"), refund: true, account: a.name, at: r.created,
      cents: -r.amount, currency: r.currency.toUpperCase(), eur: eur === null ? null : -Math.abs(eur),
    });
  }

  const outs = payouts.filter((p) => p.status === "paid" || p.status === "in_transit").map((p) => ({
    account: a.name, arrival: p.arrival_date, status: p.status,
    cents: p.amount, currency: p.currency.toUpperCase(),
    bank: p.destination && typeof p.destination === "object"
      ? [p.destination.bank_name, p.destination.last4 ? "ending " + p.destination.last4 : ""].filter(Boolean).join(" ")
      : "",
  }));

  return { items, payouts: outs };
}

// The euro Stripe actually booked for a payment. An account that settles
// in another currency is converted at that day's ECB rate, so the figure
// never moves afterwards.
async function settledEur(bt, fallbackCents, fallbackCur, at) {
  if (bt && typeof bt === "object") {
    if (bt.currency === "eur") return Math.abs(bt.amount);
    return dayRateEur(Math.abs(bt.amount), bt.currency, at);
  }
  if (fallbackCur === "eur") return fallbackCents;
  return dayRateEur(fallbackCents, fallbackCur, at);
}

const dayRates = new Map();
async function dayRateEur(cents, cur, at) {
  const day = new Date(at * 1000).toISOString().slice(0, 10);
  const C = cur.toUpperCase();
  const key = day + C;
  if (!dayRates.has(key)) {
    dayRates.set(key, fetch(`https://api.frankfurter.app/${day}?from=EUR&to=${C}`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => d?.rates?.[C] || null).catch(() => null));
  }
  const rate = await dayRates.get(key);
  return rate ? Math.round(cents / rate) : null;
}

async function invoiceOf(a, c) {
  if (!c.payment_intent) return null;
  const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent.id;
  // straight to the API: the stripe package here is older than invoice payments
  const r = await fetch("https://api.stripe.com/v1/invoice_payments?payment[type]=payment_intent"
    + `&payment[payment_intent]=${encodeURIComponent(pi)}&expand[]=data.invoice`,
    { headers: { Authorization: `Bearer ${process.env[a.env]}` } })
    .then((x) => (x.ok ? x.json() : null)).catch(() => null);
  const inv = r?.data?.[0]?.invoice;
  return inv && typeof inv === "object" ? inv : null;
}

// what a payment is for, by account
function sortFor(account, c) {
  if (account === "coachrx") return { kind: "programming", label: "Programming (CoachRx)" };
  if (account === "learnworlds") return sortOldAcademy(c);
  return sortByCharge(c);
}

// The old academy account: LearnWorlds course sales and plans, Paythen
// seminar plans, and RegFox seminar payments.
function sortOldAcademy(c) {
  const d = (c.description || "").trim();
  const tidy = d.replace(/_/g, " ").replace(/\s+[a-z0-9]{10}\s+plan$/i, "").replace(/\s+/g, " ");
  if (/online/i.test(d)) return { kind: "online", label: tidy };
  if (/regfox|\bt[gcew]c[ _]l\d|^(TGC|TCC|TEC|TWC|BB) L\d|seminar|workshop/i.test(d)) return { kind: "seminars", label: tidy };
  if (/^(Subscription (creation|update)|Payment for order)$/i.test(d)) return { kind: "online", label: "Online course (old academy)" };
  return { kind: "other", label: tidy || "Payment (old academy)" };
}

// what a charge on the main account says it is for, when it says
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
  if (md.kind === "online_course_sale" || md.kind === "online_course_invoice" || md.kind === "online" || /online/i.test(d)) {
    return { kind: "online", label: md.label || d.split(" — ").slice(-1)[0] };
  }
  if (md.course_id || md.registration_id || md.plan_id || SEMINAR_KINDS.has(md.kind)) {
    return { kind: "seminars", courseId: md.course_id || null, label: d.replace(/^(Deposit|Remaining balance|Balance for|Monthly payment[^—]*|Payment \d+ of \d+) —? ?/i, "") };
  }
  if (md.kind === "programming" || md.purchase_id || inv.parent?.subscription_details || inv.subscription || /athlete|programming|block/i.test(d)) {
    return { kind: "programming", label: "Programming" };
  }
  return null;
}

// Sold this month at full value, from our own records.
async function soldThisMonth(fromIso, toIso, perCourse) {
  const add = (o, cur, cents) => { const c = (cur || "EUR").toUpperCase(); o[c] = (o[c] || 0) + (cents || 0); };
  const value = { seminars: {}, online: {}, gift_cards: {} };

  const [{ data: regs, error: regErr }, { data: onl }, { data: invs }, { data: gifts }] = await Promise.all([
    db.from("registrations")
      .select("id, course_id, status, currency, amount_paid_cents, courses!registrations_course_id_fkey ( title )")
      .gte("created_at", fromIso).lt("created_at", toIso).neq("status", "cancelled"),
    db.from("online_sales").select("id, option, months, amount_paid_cents, deposit_cents, currency")
      .gte("created_at", fromIso).lt("created_at", toIso),
    db.from("online_invoices").select("id, total_cents, currency")
      .eq("status", "paid").gte("paid_at", fromIso).lt("paid_at", toIso),
    db.from("gift_cards").select("id, amount_cents, currency")
      .gte("created_at", fromIso).lt("created_at", toIso),
  ]);
  if (regErr) throw new Error("registrations: " + regErr.message);

  // a seminar place: the whole plan when it has one, else what was paid
  const ids = (regs || []).map((r) => r.id);
  const planOf = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data: pays } = await db.from("payments").select("registration_id, amount_cents, status")
      .in("registration_id", ids.slice(i, i + 200));
    for (const p of pays || []) {
      if (p.status === "cancelled" || p.status === "refunded") continue;
      planOf[p.registration_id] = (planOf[p.registration_id] || 0) + (p.amount_cents || 0);
    }
  }
  for (const r of regs || []) {
    const name = r.courses?.title || "Seminar";
    (perCourse[name] ||= { name, payments: 0, by_currency: {}, eur_cents: 0, places: 0 }).places++;
    add(value.seminars, r.currency, Math.max(planOf[r.id] || 0, r.amount_paid_cents || 0));
  }

  // an online course: every monthly payment of a plan, or the one payment
  for (const s of onl || []) {
    const full = s.option === "plan" ? (s.amount_paid_cents || 0) * (s.months || 1) : (s.amount_paid_cents || 0);
    add(value.online, s.currency, full + (s.deposit_cents || 0));
  }
  for (const i of invs || []) add(value.online, i.currency, i.total_cents);
  for (const g of gifts || []) add(value.gift_cards, g.currency, g.amount_cents);

  const tr = db.schema("train");
  const [{ data: plans }, { data: trials }] = await Promise.all([
    tr.from("enrolments").select("id").gte("created_at", fromIso).lt("created_at", toIso)
      .eq("is_trial", false).eq("is_free", false).not("stripe_subscription_id", "is", null),
    tr.from("enrolments").select("id").gte("created_at", fromIso).lt("created_at", toIso).eq("is_trial", true),
  ]);

  return {
    places: (regs || []).length,
    online_courses: (onl || []).length + (invs || []).length,
    gift_cards: (gifts || []).length,
    programming_plans: (plans || []).length,
    programming_trials: (trials || []).length,
    value_by_kind: value,
  };
}

/* ---------------- still to come ---------------- */

async function outlook(accounts) {
  const nowS = Math.floor(Date.now() / 1000);
  const rows = []; // { at, cents, currency, kind, overdue?, unknown_end? }

  await Promise.all(accounts.map(async (a) => {
    if (a.id === "coachrx") return; // programming only: never counted as future money
    const s = a.stripe;

    if (a.id === "main") {
      const [drafts, open, subs] = await Promise.all([
        listAll(s.invoices, { status: "draft" }),
        listAll(s.invoices, { status: "open" }),
        listAll(s.subscriptions, { status: "active" }),
      ]);
      // seminar instalments Stripe is set to take on their date
      for (const inv of drafts) {
        const md = inv.metadata || {};
        if (!(md.registration_id || md.course_id || SEMINAR_KINDS.has(md.kind))) continue;
        rows.push({ at: inv.automatically_finalizes_at || null, cents: inv.amount_due, currency: inv.currency, kind: "seminars" });
      }
      // invoices sent and not paid yet
      for (const inv of open) {
        const sorted = sortByInvoice(inv) || { kind: "other" };
        if (sorted.kind === "programming") continue;
        const overdue = !!(inv.due_date && inv.due_date < nowS);
        rows.push({ at: overdue ? null : (inv.due_date || nowS), cents: inv.amount_remaining, currency: inv.currency,
          kind: sorted.kind, overdue });
      }
      // online course plans: they stop by themselves after the last payment
      const planSubs = subs.filter((x) => x.metadata?.kind === ONLINE_PLAN_KIND && x.cancel_at);
      const { data: sales } = planSubs.length
        ? await db.from("online_sales").select("stripe_subscription_id, amount_paid_cents")
          .in("stripe_subscription_id", planSubs.map((x) => x.id))
        : { data: [] };
      const eachOf = Object.fromEntries((sales || []).map((x) => [x.stripe_subscription_id, x.amount_paid_cents]));
      for (const sub of planSubs) {
        const amount = eachOf[sub.id] || unitAmount(sub);
        for (const at of monthly(periodEnd(sub), sub.cancel_at)) {
          rows.push({ at, cents: amount, currency: sub.currency, kind: "online" });
        }
      }
    }

    if (a.id === "learnworlds") {
      const subs = await listAll(s.subscriptions, { status: "active" });
      for (const sub of subs) {
        const md = sub.metadata || {};
        const amount = unitAmount(sub);
        if (md.created_via === "Paythen" && md.expected_completion_date) {
          const end = Date.parse(md.expected_completion_date + " UTC") / 1000 + 86400;
          for (const at of monthly(periodEnd(sub), end)) rows.push({ at, cents: amount, currency: sub.currency, kind: "seminars" });
        } else if (sub.cancel_at) {
          for (const at of monthly(periodEnd(sub), sub.cancel_at)) rows.push({ at, cents: amount, currency: sub.currency, kind: "online" });
        } else {
          // a LearnWorlds plan with no end date in Stripe: only the next payment is counted
          rows.push({ at: periodEnd(sub), cents: amount, currency: sub.currency, kind: "online", unknown_end: true });
        }
      }
    }
  }));

  const rates = await euroRates([...new Set(rows.map((r) => r.currency.toUpperCase()))]);
  const eur = (c, cur) => cur === "EUR" ? c : rates[cur] ? Math.round(c / rates[cur]) : 0;

  const byMonth = {};
  const total = { eur_cents: 0, by_currency: {}, count: 0 };
  const overdue = { eur_cents: 0, by_currency: {}, count: 0 };
  let unknownEnd = 0;
  for (const r of rows) {
    const cur = r.currency.toUpperCase();
    const e = eur(r.cents, cur);
    total.eur_cents += e; total.count++;
    total.by_currency[cur] = (total.by_currency[cur] || 0) + r.cents;
    if (r.unknown_end) unknownEnd++;
    if (r.overdue) {
      overdue.eur_cents += e; overdue.count++;
      overdue.by_currency[cur] = (overdue.by_currency[cur] || 0) + r.cents;
      continue;
    }
    const key = r.at ? new Date(r.at * 1000).toISOString().slice(0, 7) : "unknown";
    const b = (byMonth[key] ||= { month: key, eur_cents: 0, count: 0, by_kind: {} });
    b.eur_cents += e; b.count++;
    b.by_kind[r.kind] = (b.by_kind[r.kind] || 0) + e;
  }

  return {
    total,
    overdue,
    unknown_end: unknownEnd,
    months: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

function unitAmount(sub) {
  const it = sub.items?.data?.[0];
  return (it?.price?.unit_amount || 0) * (it?.quantity || 1);
}
function periodEnd(sub) {
  return sub.items?.data?.[0]?.current_period_end || sub.current_period_end || sub.billing_cycle_anchor;
}
// the monthly payment dates from `first`, before `end`
function monthly(first, end) {
  const out = [];
  if (!first) return out;
  const d = new Date(first * 1000);
  for (let i = 0; i < 36; i++) {
    const t = Math.floor(d.getTime() / 1000);
    if (end && t >= end) break;
    out.push(t);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/* ---------------- shared ---------------- */

async function listAll(resource, params) {
  const out = [];
  for await (const x of resource.list({ limit: 100, ...params })) out.push(x);
  return out;
}

// how many of each currency one euro buys today (estimates only)
async function euroRates(currencies) {
  const want = currencies.filter((c) => c && c !== "EUR");
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
