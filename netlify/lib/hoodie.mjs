// The free hoodie with a live seminar (Nathan, 20 Nov 2026).
//
// Anyone who books a live seminar between 27 Nov and 30 Dec 2026 (Irish
// time) gets one hoodie from the shop, hoodie and shipping paid by BirdBox.
// They pick it in BirdBox Learn and the order goes straight to Printful
// (confirmed at once, paid from the Printful wallet).
//
// Counts: any live seminar, any way of paying (card, deposit, plan, group
// invoice, gift card). Does not count: workshops, transfers from another
// course, free places, and places paid with a course credit.

import { db } from "./directory.mjs";

// Ireland is on GMT in winter, so these are midnight and 23:59:59 in Dublin.
export const HOODIE_FROM = new Date("2026-11-27T00:00:00Z");
export const HOODIE_TO = new Date("2026-12-30T23:59:59Z");

export const hoodieOfferOn = (when = new Date()) => when >= HOODIE_FROM && when <= HOODIE_TO;

const PRINTFUL = "https://api.printful.com";

async function printful(path, opts = {}) {
  const key = process.env.PRINTFUL_API_KEY;
  if (!key) throw new Error("The hoodie shop is not connected yet. Please write to info@birdboxcoaching.com.");
  const res = await fetch(PRINTFUL + path, {
    ...opts,
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || body?.result || ("Printful " + res.status);
    const err = new Error(typeof msg === "string" ? msg : "Printful " + res.status);
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---- who has a hoodie to claim ------------------------------------------

// Their live seminar bookings made in the window, each with its claim (if
// any). A booking counts once at least the deposit (or the group invoice)
// is paid.
export async function hoodieBookings(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return [];
  const { data: regs, error } = await db.from("registrations")
    .select("id, email, first_name, last_name, created_at, payment_status, amount_paid_cents, transferred_from_course_id, courses!inner(id, title, type, brand, city, starts_at)")
    .ilike("email", e)
    .eq("status", "active")
    .eq("courses.type", "live_seminar")
    .gte("created_at", HOODIE_FROM.toISOString())
    .lte("created_at", HOODIE_TO.toISOString());
  if (error) throw error;
  const live = (regs || []).filter((r) => !r.transferred_from_course_id);
  if (!live.length) return [];

  const ids = live.map((r) => r.id);
  const [{ data: uses }, { data: claims }] = await Promise.all([
    db.from("gift_card_redemptions").select("registration_id, gift_cards(kind)").in("registration_id", ids),
    db.from("hoodie_claims").select("registration_id, product_name, colour, size, status, created_at").in("registration_id", ids),
  ]);
  const credit = new Set(), gift = new Set();
  for (const u of uses || []) (u.gift_cards?.kind === "credit" ? credit : gift).add(u.registration_id);
  const claimOf = new Map((claims || []).map((c) => [c.registration_id, c]));

  return live
    .filter((r) => ["deposit_paid", "paid_in_full"].includes(r.payment_status))
    .filter((r) => !credit.has(r.id))                                  // course credit
    .filter((r) => Number(r.amount_paid_cents) > 0 || gift.has(r.id))  // free places
    .map((r) => ({
      registration_id: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" "),
      course: r.courses.title,
      course_id: r.courses.id,
      brand: String(r.courses.brand || "").toLowerCase(),
      starts_at: r.courses.starts_at,
      claim: claimOf.get(r.id) && claimOf.get(r.id).status !== "failed" ? claimOf.get(r.id) : null,
    }));
}

// Whether a booking just made earns a hoodie (for the confirmation email).
export async function bookingEarnsHoodie(email, courseId) {
  if (!hoodieOfferOn()) return false;
  try {
    const list = await hoodieBookings(email);
    return list.some((b) => !b.claim && (!courseId || b.course_id === courseId));
  } catch { return false; }
}

// ---- the hoodies on offer -----------------------------------------------

// Every hoodie in the Printful store, grouped as the shop shows them:
// course (TGC/TCC) x logo (front/back), with every colour and size from the
// colour sets ("Light Colours", "Bright Colours"...). Kept for 30 minutes.
let cache = null;
export async function hoodieCatalogue() {
  if (cache && Date.now() - cache.at < 30 * 60000) return cache.list;

  const products = [];
  for (let offset = 0; ; offset += 100) {
    const page = await printful(`/store/products?limit=100&offset=${offset}`);
    products.push(...(page.result || []));
    if (!page.paging || offset + 100 >= page.paging.total) break;
  }
  const hoodies = products.filter((p) => /hoodie/i.test(p.name) && !p.is_ignored);

  const details = [];
  for (let i = 0; i < hoodies.length; i += 6) {
    details.push(...await Promise.all(hoodies.slice(i, i + 6).map((p) => printful(`/store/products/${p.id}`).then((d) => d.result))));
  }

  const groups = new Map();
  for (const d of details) {
    const name = String(d.sync_product.name || "").trim();
    const base = name.replace(/\s*\([^)]*\)\s*$/, "").trim();          // "TGC - Course Logo Front Hoodie"
    const brand = (base.match(/^(TGC|TCC|TEC|TWC)\b/i) || [, "birdbox"])[1].toLowerCase();
    const logo = /\bback\b/i.test(base) ? "back" : "front";
    if (!groups.has(base)) groups.set(base, { key: base, name: base, brand, logo, colours: new Map() });
    const g = groups.get(base);
    for (const v of d.sync_variants || []) {
      if (v.is_ignored || v.synced === false) continue;
      if (v.availability_status && !/active/i.test(v.availability_status)) continue;
      const colour = v.color || (v.product?.name || "").split("/").slice(-2, -1)[0]?.trim() || "Colour";
      const preview = (v.files || []).find((f) => f.type === "preview");
      if (!g.colours.has(colour)) g.colours.set(colour, { colour, image: preview?.preview_url || preview?.thumbnail_url || v.product?.image || d.sync_product.thumbnail_url, sizes: [] });
      g.colours.get(colour).sizes.push({ size: v.size || "One size", id: v.id, product: name });
    }
  }

  const ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
  const list = [...groups.values()]
    .filter((g) => g.colours.size)
    .map((g) => ({
      ...g,
      colours: [...g.colours.values()].map((c) => ({
        ...c, sizes: c.sizes.sort((a, b) => ORDER.indexOf(a.size) - ORDER.indexOf(b.size)),
      })),
    }))
    .sort((a, b) => (a.brand + (a.logo === "front" ? 0 : 1)).localeCompare(b.brand + (b.logo === "front" ? 0 : 1)));
  cache = { at: Date.now(), list };
  return list;
}

export async function hoodieVariant(id) {
  const list = await hoodieCatalogue();
  for (const g of list) for (const c of g.colours) for (const s of c.sizes) {
    if (String(s.id) === String(id)) return { id: s.id, product: s.product, colour: c.colour, size: s.size };
  }
  return null;
}

// ---- the order ----------------------------------------------------------

// Confirmed straight away, so Printful charges the wallet and prints it.
export async function placeHoodieOrder({ claimId, variantId, recipient }) {
  const body = {
    external_id: "hoodie-" + String(claimId).replace(/-/g, "").slice(0, 24),
    shipping: "STANDARD",
    recipient,
    items: [{ sync_variant_id: Number(variantId), quantity: 1 }],
  };
  const res = await printful("/orders?confirm=true", { method: "POST", body: JSON.stringify(body) });
  return res.result;
}
