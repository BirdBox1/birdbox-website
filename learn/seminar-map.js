// Every upcoming seminar and workshop on a map, for BirdBox Learn's My
// seminars tab when someone has nothing booked (Nathan, 20 Nov 2026).
// The same data, pins and colours as the map on /seminars/: country outlines
// from /world.json (no tiles), one pin per venue, its popup listing every
// date there with a Register button. Prices are left to the course page.

const PIN_COLOUR = {
  "tcc:1": "#2F7FD0", "tcc:2": "#6FC2F0", "tcc:workshop": "#A8DBF7",
  "tgc:1": "#B0242B", "tgc:2": "#D8393D", "tgc:workshop": "#F2696C",
  "tec:1": "#2E8B57", "tec:2": "#5FBE8A", "tec:workshop": "#8FD9AE",
  "twc:1": "#BE8A12", "twc:2": "#D9A527", "twc:workshop": "#EFC55E",
};
const BRAND_FALLBACK = { tcc: "#4FA8DE", tgc: "#D8393D", tec: "#5FBE8A", twc: "#D9A527", birdbox: "#8A8385" };
const BRAND_NAME = { tcc: "The Coaches Course", tgc: "The Gymnastics Course", tec: "The Endurance Course", twc: "The Weightlifting Course", birdbox: "BirdBox Coaching" };
const STATE_COUNTRIES = new Set(["US", "CA", "AU", "BR", "MX"]);

const pinKey = (c) => {
  const brand = String(c.brand || "").toLowerCase();
  if (c.type === "workshop") return brand + ":workshop";
  const lvl = String(c.level == null ? "" : c.level).replace(/\D/g, "");
  return lvl ? brand + ":" + lvl : brand;
};
const pinColour = (c) => PIN_COLOUR[pinKey(c)] || BRAND_FALLBACK[String(c.brand || "").toLowerCase()] || BRAND_FALLBACK.birdbox;
const keyLabel = (k) => {
  const [brand, part] = k.split(":");
  const name = BRAND_NAME[brand] || brand;
  return part === "workshop" ? name + " — Workshops" : part ? name + " — Level " + part : name;
};
const pinTitle = (c) => {
  const brand = BRAND_NAME[c.brand] || "BirdBox";
  if (c.type === "workshop") return c.title || brand + " Workshop";
  const lvl = String(c.level == null ? "" : c.level).replace(/\D/g, "");
  return brand + (lvl ? " — Level " + lvl : "");
};
const countryName = (code) => {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch (e) { return code; }
};
const placeName = (c) => {
  const country = String(c.country || "").trim().toUpperCase();
  const state = String(c.state || "").trim().toUpperCase();
  return [c.city, state && STATE_COUNTRIES.has(country) ? state : country ? countryName(country) : ""].filter(Boolean).join(", ");
};
const formatWhen = (startsAt, endsAt, tz) => {
  const zone = tz || "UTC";
  const day = { timeZone: zone, day: "numeric", month: "short" };
  const start = new Date(startsAt);
  const year = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric" }).format(start);
  const s = new Intl.DateTimeFormat("en-GB", day).format(start);
  if (!endsAt) return s + " " + year;
  const e = new Intl.DateTimeFormat("en-GB", day).format(new Date(endsAt));
  return s === e ? s + " " + year : s + " – " + e + " " + year;
};
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  const css = document.createElement("link");
  css.rel = "stylesheet"; css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(css);
  return new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.onload = ok; s.onerror = no;
    document.head.appendChild(s);
  });
}

// mapEl: the map box; noteEl: the line under it; keyEl: the <ul> colour key.
// offer (optional): { brands: Set of "tgc"/"tcc", percent, pass(brand) } for an
// online student's Level 1 seminar discount. Their Level 1 seminar pins say
// so, and Register fetches their pass first so the booking page takes it off.
export async function seminarMap(db, mapEl, noteEl, keyEl, offer) {
  const [{ data, error }] = await Promise.all([
    db.from("courses")
      .select("slug, brand, type, level, title, city, country, state, starts_at, ends_at, timezone, status, latitude, longitude")
      .in("status", ["published", "full"])
      .in("type", ["live_seminar", "workshop"])
      .eq("archived", false)
      .gte("starts_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("starts_at", { ascending: true }),
    loadLeaflet(),
  ]);
  if (error) { noteEl.textContent = "Seminar dates are unavailable right now."; return; }
  const now = Date.now();
  const rows = (data || []).filter((c) => new Date(c.ends_at || c.starts_at).getTime() >= now);
  const placed = rows.filter((c) => c.latitude != null && c.longitude != null);
  if (!placed.length) { noteEl.textContent = "No dates scheduled just now. New ones are added regularly."; return; }

  const L = window.L;
  const map = L.map(mapEl, { scrollWheelZoom: false, minZoom: 1, maxZoom: 7, worldCopyJump: true }).setView([25, 10], 2);
  fetch("/world.json").then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((geo) => {
    L.geoJSON(geo, { className: "bb-world", style: { fillOpacity: 1 }, interactive: false }).addTo(map);
    map.attributionControl.addAttribution('Boundaries <a href="https://www.naturalearthdata.com/">Natural Earth</a>');
  }).catch(() => {});

  const spots = new Map(), bounds = [];
  for (const c of placed) {
    const colour = pinColour(c);
    const key = (+c.latitude).toFixed(4) + "," + (+c.longitude).toFixed(4);
    if (!spots.has(key)) {
      const icon = L.divIcon({ className: "", iconSize: [16, 16], iconAnchor: [8, 8],
        html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${colour};border:2px solid #F2EFEF;box-shadow:0 0 10px ${colour}"></span>` });
      spots.set(key, { marker: L.marker([c.latitude, c.longitude], { icon }).addTo(map), html: [] });
    }
    const spot = spots.get(key);
    const full = c.status === "full";
    const lvl = String(c.level == null ? "" : c.level).replace(/\D/g, "");
    const half = !full && offer && c.type === "live_seminar" && lvl === "1" && offer.brands.has(String(c.brand || "").toLowerCase());
    spot.html.push(
      `<div class="sm-pin__what">${esc(pinTitle(c))}</div>` +
      `<div class="sm-pin__where">${esc(placeName(c))}</div>` +
      `<div class="sm-pin__when">${esc(formatWhen(c.starts_at, c.ends_at, c.timezone))}${full ? " · Full" : ""}</div>` +
      (half ? `<div class="sm-pin__off">${esc(offer.percent)}% off for you as an online student</div>` : "") +
      `<a class="sm-pin__go" style="background:${colour}" href="/c/${encodeURIComponent(c.slug)}/"` +
      (half ? ` data-pass="${esc(String(c.brand).toLowerCase())}"` : "") + `>${full ? "View" : "Register"}</a>`);
    spot.marker.bindPopup(spot.html.join('<hr style="border:0;border-top:1px solid currentColor;opacity:0.25;margin:10px 0">'), { maxHeight: 320 });
    bounds.push([c.latitude, c.longitude]);
  }
  // Register on a discounted pin: get their pass, then go
  if (offer) mapEl.addEventListener("click", async (e) => {
    const a = e.target.closest && e.target.closest("a[data-pass]");
    if (!a) return;
    e.preventDefault();
    const label = a.textContent; a.textContent = "Opening…";
    try { await offer.pass(a.dataset.pass); } catch (err) { /* the normal price, never stuck */ }
    a.textContent = label;
    location.href = a.getAttribute("href");
  });
  if (bounds.length === 1) map.setView(bounds[0], 5); else map.fitBounds(bounds, { padding: [40, 40] });

  const seen = new Map();
  for (const c of placed) if (!seen.has(pinKey(c))) seen.set(pinKey(c), pinColour(c));
  keyEl.textContent = "";
  for (const k of [...seen.keys()].sort()) {
    const li = document.createElement("li");
    const dot = document.createElement("i"); dot.style.background = seen.get(k);
    const label = document.createElement("span"); label.textContent = keyLabel(k);
    li.append(dot, label); keyEl.append(li);
  }
  const n = spots.size;
  noteEl.textContent = n + (n === 1 ? " location" : " locations") + " on the map. Select a pin for dates and registration.";
}
