// Shared by the trainer directory pages. Plain functions, no framework.

export const BRANDS = {
  tcc: { name: "The Coaches Course", short: "TCC", tagline: "Formerly BirdBox Coaching Development", mark: "/brand/tcc-mark.png" },
  tgc: { name: "The Gymnastics Course", short: "TGC", mark: "/brand/tgc-mark.png" },
  tec: { name: "The Endurance Course", short: "TEC", mark: "/brand/tec-mark.png" },
  twc: { name: "The Weightlifting Course", short: "TWC", mark: "/brand/twc-mark.png" },
  birdbox: { name: "BirdBox Coaching", short: "BirdBox", mark: "/brand/birdbox-mark.png" },
};

export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const coachUrl = (slug) => "/trainer-directory/coach/" + encodeURIComponent(slug);

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || "")[0] || "").toUpperCase() + ((parts.length > 1 ? parts[parts.length - 1][0] : "") || "").toUpperCase();
}

// "TGC L2", "TCC L1 Online", "TGC Workshop".
export function badgeText(c) {
  const b = BRANDS[c.brand] || BRANDS.birdbox;
  if (c.kind === "workshop") return b.short + " Workshop";
  if (c.brand === "birdbox") return "BirdBox Online";
  return b.short + (c.level ? " L" + c.level : "") + (c.kind === "online" ? " Online" : "");
}

// One badge per distinct course, highest level first within a family.
export function badges(courses, { compact = false } = {}) {
  const seen = new Set();
  const order = Object.keys(BRANDS);
  const list = [...(courses || [])].sort((a, b) =>
    order.indexOf(a.brand) - order.indexOf(b.brand) || Number(b.level || 0) - Number(a.level || 0));
  const out = [];
  for (const c of list) {
    const t = badgeText(c);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(`<span class="td-badge" style="--b:var(--b-${esc(c.brand)});--t:var(--t-${esc(c.brand)})">${esc(t)}</span>`);
  }
  if (compact && out.length > 4) return out.slice(0, 4).join("") + `<span class="td-badge">+${out.length - 4}</span>`;
  return out.join("");
}

export function place(c) {
  return [c.city, c.country].filter(Boolean).join(", ");
}

export function avatar(c, cls = "td-avatar") {
  if (c.photo) return `<img class="${cls}" src="${esc(c.photo)}" alt="" loading="lazy">`;
  return `<div class="${cls}" aria-hidden="true">${esc(initials(c.name))}</div>`;
}

export function monthYear(ym) {
  if (!ym) return "";
  const [y, m] = String(ym).split("-");
  if (!m) return y;
  return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

// Kilometres between two points, for "near me".
export function distanceKm(a, b) {
  const R = 6371, rad = (d) => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
