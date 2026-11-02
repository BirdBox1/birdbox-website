// netlify/lib/programming-shop.mjs
//
// What programming can be bought, in the visitor's currency as the app's
// checkout charges it (Nathan, 1 Nov 2026). Used by BirdBox Learn's
// Programming tab (learn-account) and by the public programming sales
// pages (programming-shop), so both always show the same prices. Prices
// come from the app's own price list; blocks are the ones put Live on the
// coach portal's Block programming page.

import { db } from "./directory.mjs";

const train = () => db.schema("train");

const EUROPE = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "CH", "NO", "IS", "LI", "AD", "MC", "SM", "VA", "AL", "BA", "ME", "MK", "RS", "XK", "MD", "UA", "GI", "FO", "GL"]);
export function currencyFor(country) {
  const c = String(country || "").toUpperCase();
  if (["GB", "IM", "JE", "GG"].includes(c)) return "gbp";
  if (c === "AU") return "aud";
  if (c === "CA") return "cad";
  if (EUROPE.has(c)) return "eur";
  return "usd";
}
// what each plan includes, as on the TGC programming page
const INCLUDES = {
  1: ["{programming}"],
  2: ["{programming}", "Premium community", "Group call", "Feedback via the community"],
  3: ["{programming}", "Premium community", "Group call", "Written and video feedback from your coach"],
  4: ["Bespoke programme", "Premium community", "1:1 coach call", "Feedback written, by Loom or DM"],
  5: ["Bespoke programme", "Premium community", "1:1 coach call", "Feedback written, by Loom or DM"],
};
// the first line of Tiers 1 to 3 is the course's own programming
// (Nathan, 2 Nov 2026: "Gymnastics programming", not "Blog programme")
const PROGRAMMING = { tgc: "Gymnastics programming", tec: "Endurance programming", twc: "Weightlifting programming" };
// the names on the TGC programming page; Tiers 4 and 5 are by application
const NAMES = { 4: "Bespoke 1:1, Skill Only", 5: "Full CF Programme, 1:1" };
// One tab per course (Nathan, 1 Nov 2026): TGC has the trial, the blog
// plans (tiers 1 to 3), one-to-one (4 and 5) and its blocks; TCC has
// one-to-one only; TEC and TWC say Coming soon until something is on sale.
const COURSES = ["tgc", "tcc", "tec", "twc"];
const APPLY = { tgc: "/tgc/programming/#apply", tcc: "/tcc/programming/#apply" };
const ONE_TO_ONE = ["tgc", "tcc"];

// The currency they paid in before (Stripe keeps one currency per
// customer), otherwise where they are (Nathan, 1 Nov 2026).
// A country they chose ("Change country", Nathan, 1 Nov 2026) comes before
// where they are browsing from; someone who has paid before keeps that
// currency whatever they choose.
async function currencyOf(a, country) {
  if (a) {
    const { data: paid } = await train().from("payments").select("currency")
      .eq("athlete_id", a.id).not("currency", "is", null).order("paid_at", { ascending: false }).limit(1);
    const cur = String(paid?.[0]?.currency || "").toLowerCase();
    if (["eur", "gbp", "usd", "aud", "cad"].includes(cur)) return { currency: cur, locked: true };
  }
  return { currency: currencyFor(country), locked: false };
}

// a: their athlete record, or null for a visitor (the sales pages)
export async function shopFor(context, a, chosen) {
  const where = String(context?.geo?.country?.code || "").toUpperCase();
  const country = /^[A-Z]{2}$/.test(chosen || "") ? chosen : where;
  const { currency, locked } = await currencyOf(a, country);
  const { data: prices } = await train().from("stripe_prices")
    .select("tier, label, amounts, tracks:track_id(brand)")
    .eq("active", true).in("tier", [1, 2, 3, 4, 5]).like("price_id", "price_%").order("tier");
  const plan = (p, brand) => {
    const cur = p.amounts?.[currency] != null ? currency : "eur";
    const includes = (INCLUDES[p.tier] || []).map((x) => x === "{programming}" ? (PROGRAMMING[brand] || "Programming") : x);
    return { tier: p.tier, name: NAMES[p.tier] || p.label, amount: p.amounts?.[cur] ?? null, currency: cur,
      includes, apply: p.tier >= 4 };
  };
  const courses = COURSES.map((brand) => ({ brand, plans: [], one_to_one: [], blocks: [],
    apply_url: APPLY[brand] || null }));
  const at = (b) => courses.find((c) => c.brand === b);
  for (const p of prices || []) {
    if (p.tier <= 3) {
      const b = String(p.tracks?.brand || "tgc").toLowerCase();
      at(b)?.plans.push(plan(p, b));
    } else for (const b of ONE_TO_ONE) at(b).one_to_one.push(plan(p, b));
  }

  const { data: rate } = await train().from("block_rates").select("week_cents, feedback_cents").eq("currency", currency).maybeSingle();
  const { data: tpls } = await train().from("tracks").select("id, name, brand, weeks, description, level, cover_url, sale_info, owner_staff_id, week_rate_cents, feedback_rate_cents")
    .eq("kind", "block").eq("is_template", true).eq("sale_status", "live").order("name");
  // who wrote each block, for the sales page
  const ids = [...new Set((tpls || []).map((t) => t.owner_staff_id).filter(Boolean))];
  const { data: staff } = ids.length ? await db.from("staff").select("id, full_name").in("id", ids) : { data: [] };
  const author = new Map((staff || []).map((s) => [s.id, s.full_name]));
  for (const t of tpls || []) {
    const week = currency === "eur" ? (t.week_rate_cents || 995) : (rate?.week_cents || 995);
    const fb = currency === "eur" ? (t.feedback_rate_cents || 1995) : (rate?.feedback_cents || 1995);
    // only TGC sells blocks for now; a block for another course waits
    const c = at(String(t.brand || "tgc").toLowerCase());
    if (c && c.brand === "tgc") c.blocks.push({
      id: t.id, name: t.name, weeks: t.weeks || null, description: t.description || null,
      level: t.level || null, cover_url: t.cover_url || null, author: author.get(t.owner_staff_id) || null,
      // the author's answers from the submit form: intentions, focus,
      // equipment, who it is for
      sales: t.sale_info || {},
      week: week, feedback_week: fb, from: week * (t.weeks || 1), currency,
    });
  }
  for (const c of courses) {
    // TCC sells one-to-one only for now (Nathan, 1 Nov 2026)
    if (c.brand === "tcc") { c.plans = []; c.blocks = []; }
    c.coming_soon = !c.plans.length && !c.one_to_one.length && !c.blocks.length;
  }
  return { currency, country, locked, courses };
}
