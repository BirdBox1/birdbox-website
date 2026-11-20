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

// The hoodies in the shop, by Ecwid product id, with the shop's own front
// and back picture of each colour ([front, back] Ecwid image ids, 800 px).
// Sorted 20 Nov 2026 and checked by eye. Printful also holds older copies
// with the same names that are not in the shop, so only these are offered.
// Add a new hoodie here when one goes on sale.
const SHOP_HOODIE_PICTURES = {
  "878548948": {"Navy Blazer": ["6418380880", "6418380886"], "Team Royal": ["6418400357", "6418407570"], "Forest Green": ["6418407576", "6418400360"]},
  "878551185": {"Black": ["6418380892", "6418407588"], "Charcoal Heather": ["6418400375", "6418407594"]},
  "878551186": {"Carbon Grey": ["6418380910", "6418380916"], "Bone": ["6418380907", "6418380922"], "White": ["6418400386", "6418407626"]},
  "878548952": {"Team Red": ["6418400408", "6418407638"], "Dusty Rose": ["6418380943", "6418400414"]},
  "878551247": {"Navy Blazer": ["6418858444", "6418926052"], "Team Royal": ["6418970266", "6418926049"]},
  "878577019": {"Black": ["6418858450", "6418926061"], "Charcoal Heather": ["6418926064", "6418970272"]},
  "878579020": {"Carbon Grey": ["6418970290", "6418858456"], "Bone": ["6418970284", "6418926076"], "White": ["6418858462", "6418926073"]},
  "878579757": {"Team Red": ["6418858471", "6418926090"], "Dusty Rose": ["6418858480", "6418858474"]},
  "878622403": {"Navy Blazer": ["6420739604", "6420739610"], "Team Royal": ["6420737943", "6420739616"]},
  "878548713": {"Black": ["6418407704", "6418400484"], "Charcoal Heather": ["6418407701", "6418407710"]},
  "878548725": {"Bone": ["6418407740", "6418570808"], "White": ["6418590011", "6418590026"]},
  "878622404": {"Team Red": ["6420739622", "6420737426"], "Dusty Rose": ["6420737953", "6420737432"], "Carbon Grey": ["6420737420", "6420737438"]},
  "878622405": {"Navy Blazer": ["6420737956", "6420739631"], "Team Royal": ["6420739634", "6420737444"]},
  "878579022": {"Black": ["6418970308", "6418970314"], "Charcoal Heather": ["6419022010", "6418970305"]},
  "878577025": {"Bone": ["6419022016", "6418926123"], "White": ["6418970320", "6418970326"]},
  "878631582": {"Team Red": ["6420739661", "6420737462"], "Dusty Rose": ["6420737480", "6420737468"], "Carbon Grey": ["6420737968", "6420737474"]}
};
const SHOP_HOODIES = new Set(Object.keys(SHOP_HOODIE_PICTURES));
const shopPicture = (ecwidId, imageId) =>
  `https://d2j6dbq0eux0bg.cloudfront.net/images/140532633/products/${ecwidId}/${imageId}.jpg`;

// Every hoodie in the Printful store, grouped as the shop shows them:
// course (TGC/TCC) x logo (front/back), with every colour and size from the
// colour sets ("Light Colours", "Bright Colours"...). Kept for 30 minutes.
let cache = null;
export async function hoodieCatalogue() {
  if (cache && Date.now() - cache.at < 30 * 60000) return cache.list;

  const products = [];
  for (let offset = 0; ; offset += 100) {
    const page = await printful(`/sync/products?limit=100&offset=${offset}`);
    products.push(...(page.result || []));
    if (!page.paging || offset + 100 >= page.paging.total) break;
  }
  // Only the hoodies the shop sells: Printful also holds older copies with
  // the same names that are not in Ecwid (Nathan, 20 Nov 2026).
  const hoodies = products.filter((p) => /hoodie/i.test(p.name) && !p.is_ignored && SHOP_HOODIES.has(String(p.external_id)));

  const details = [];
  for (let i = 0; i < hoodies.length; i += 6) {
    details.push(...await Promise.all(hoodies.slice(i, i + 6).map((p) => printful(`/sync/products/${p.id}`).then((d) => d.result))));
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
      const pics = SHOP_HOODIE_PICTURES[String(d.sync_product.external_id)]?.[colour];
      if (!g.colours.has(colour)) g.colours.set(colour, {
        colour,
        image: pics ? shopPicture(d.sync_product.external_id, pics[0]) : (preview?.preview_url || preview?.thumbnail_url || v.product?.image || d.sync_product.thumbnail_url),
        back: pics ? shopPicture(d.sync_product.external_id, pics[1]) : null,
        sizes: [],
      });
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
    if (String(s.id) === String(id)) return { id: s.id, product: s.product, colour: c.colour, size: s.size, brand: g.brand };
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
