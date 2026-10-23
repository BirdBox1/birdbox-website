// netlify/edge-functions/share-meta.js
//
// Link previews for the pages that are filled in by the browser.
//
// WhatsApp, iMessage, Facebook, LinkedIn and Google read a page's
// <head> without running its JavaScript. The seminar pages (/c/<slug>),
// blog posts (/blog/<slug>) and coach profiles
// (/trainer-directory/coach/<slug>) are one shared HTML file each that
// fills itself in after loading, so to a link preview they are all the
// same blank page with the bird logo. This adds the right title,
// description and picture to the <head> before the page goes out.
//
// It only does the work for link-preview robots and search engines.
// Everyone else gets the page untouched, with no extra wait.
//
// The fixed pages (home, TGC, TCC...) carry their own tags in their
// HTML; their pictures are in /share/, made by share-source/render.py.

const SITE = "https://birdboxcoaching.com";
const SUPABASE_URL = "https://yvdmazpxtpuvidlcifnq.supabase.co";
// The publishable key, the same one the pages themselves use in the
// browser. It can only read what is public anyway.
const SUPABASE_KEY = "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ";

const ROBOTS = /bot\b|crawler|spider|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|linkedin|embedly|pinterest|skype|vkshare|redditbot|applebot|googlebot|bingbot|duckduck|yandex|iframely|preview/i;

const BRAND = {
  tgc: "The Gymnastics Course",
  tcc: "The Coaches Course",
  tec: "The Endurance Course",
  twc: "The Weightlifting Course",
};

export default async (request, context) => {
  const ua = request.headers.get("user-agent") || "";
  if (!ROBOTS.test(ua)) return context.next();

  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  let meta = null;
  try {
    if (parts[0] === "c" && parts[1]) meta = await seminar(parts[1]);
    else if (parts[0] === "blog" && parts[1] && parts[1] !== "index.html") meta = await post(parts[1]);
    else if (parts[0] === "trainer-directory" && parts[1] === "coach" && parts[2]) meta = await coach(parts[2], url.origin);
  } catch (err) {
    console.error("share-meta lookup failed", url.pathname, err && err.message);
  }

  const res = await context.next();
  if (!meta || !(res.headers.get("content-type") || "").includes("text/html")) return res;

  meta.url = SITE + url.pathname;
  let html = await res.text();
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(meta.title)}</title>`);
  html = html.replace(/<meta\s+name="description"[^>]*>/i, "");
  html = html.replace("</head>", tags(meta) + "</head>");
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(html, { status: res.status, headers });
};

function tags(m) {
  return [
    `<meta name="description" content="${esc(m.description)}">`,
    `<meta property="og:type" content="${m.type || "website"}">`,
    `<meta property="og:site_name" content="BirdBox Coaching">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`,
    `<meta property="og:url" content="${esc(m.url)}">`,
    `<meta property="og:image" content="${esc(m.image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    "",
  ].join("\n");
}

async function rest(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows && rows[0] ? rows[0] : null;
}

// A seminar or workshop: its title, dates and place. The picture is the
// course's own "Live seminar" image: courses.image_url is the host gym's
// logo, too small and plain for a link preview.
async function seminar(slug) {
  const c = await rest(`courses?slug=eq.${encodeURIComponent(slug)}&select=brand,type,title,summary,city,country,starts_at,ends_at,timezone,status&limit=1`);
  if (!c) return null;
  const when = dates(c.starts_at, c.ends_at, c.timezone);
  const where = [c.city, countryName(c.country)].filter(Boolean).join(", ");
  const first = [when, where].filter(Boolean).join(" · ");
  const brand = BRAND[c.brand] || "BirdBox Coaching";
  return {
    title: c.title || brand,
    description: [first, c.summary || (c.type === "workshop" ? `${brand} workshop.` : `${brand} live seminar.`)].filter(Boolean).join(". "),
    image: `${SITE}/share/${c.brand === "tgc" || c.brand === "tcc" ? "seminar-" + c.brand : "seminar-birdbox"}.jpg`,
  };
}

async function post(slug) {
  const p = await rest(`blog_posts?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=title,excerpt,hero_path&limit=1`);
  if (!p) return null;
  return {
    type: "article",
    title: p.title,
    description: p.excerpt || "From the BirdBox Coaching blog.",
    image: p.hero_path
      ? `${SUPABASE_URL}/storage/v1/object/public/blog/${p.hero_path.split("/").map(encodeURIComponent).join("/")}`
      : `${SITE}/share/blog.jpg`,
  };
}

async function coach(slug, origin) {
  const r = await fetch(`${origin}/.netlify/functions/directory-public?slug=${encodeURIComponent(slug)}`);
  if (!r.ok) return null;
  const { coach: k } = await r.json();
  if (!k) return null;
  const where = [k.gym, k.city, countryName(k.country)].filter(Boolean).join(", ");
  return {
    title: `${k.name} | BirdBox Trainer Directory`,
    description: [k.headline, where].filter(Boolean).join(" · ") || "A BirdBox-trained coach.",
    // Their own card: their photo framed as a BirdBox Trainer Directory
    // picture (coach-card.js). ?p= changes with the photo, so a new photo
    // is not hidden behind the cached old card.
    image: k.photo ? `${SITE}/share/coach/${slug}.png?p=${shortHash(k.photo)}` : `${SITE}/share/coach.jpg`,
  };
}

// "10–11 Oct 2026", "30 Oct – 1 Nov 2026" or "10 Oct 2026", in the venue's time zone.
function dates(start, end, tz) {
  if (!start) return "";
  const f = (d, o) => new Date(d).toLocaleDateString("en-GB", { timeZone: tz || "UTC", ...o });
  const s = { d: f(start, { day: "numeric" }), m: f(start, { month: "short" }), y: f(start, { year: "numeric" }) };
  if (!end) return `${s.d} ${s.m} ${s.y}`;
  const e = { d: f(end, { day: "numeric" }), m: f(end, { month: "short" }), y: f(end, { year: "numeric" }) };
  if (s.d === e.d && s.m === e.m && s.y === e.y) return `${s.d} ${s.m} ${s.y}`;
  if (s.m === e.m && s.y === e.y) return `${s.d}–${e.d} ${s.m} ${s.y}`;
  return `${s.d} ${s.m} – ${e.d} ${e.m} ${e.y}`;
}

function shortHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function countryName(code) {
  if (!code) return "";
  if (String(code).length !== 2) return code;
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(String(code).toUpperCase()) || code; } catch { return code; }
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const config = { path: ["/c/*", "/blog/*", "/trainer-directory/coach/*"] };
