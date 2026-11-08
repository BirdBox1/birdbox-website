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
//
// 8 Nov 2026: it also adds the page's canonical address, and for Google
// the facts in its own format (JSON-LD): each seminar as an event with
// dates, venue and price, so it can show in search results; each blog
// post as an article. A course address that matches no course goes out
// as "not found" to search engines, so old or mistyped links drop out.

const SITE = "https://birdboxcoaching.com";
const SUPABASE_URL = "https://yvdmazpxtpuvidlcifnq.supabase.co";
// The publishable key, the same one the pages themselves use in the
// browser. It can only read what is public anyway.
const SUPABASE_KEY = "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ";

// Google's test tools and other crawlers don't say "bot" (Google-InspectionTool
// runs the Rich Results Test), so they are named here too (8 Nov 2026).
const ROBOTS = /bot\b|google-inspectiontool|googleother|google-extended|adsbot-google|storebot-google|mediapartners-google|bingpreview|crawler|spider|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|linkedin|embedly|pinterest|skype|vkshare|redditbot|applebot|googlebot|bingbot|duckduck|yandex|iframely|preview/i;

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
  let missing = false;
  try {
    if (parts[0] === "c" && parts[1]) { meta = await seminar(parts[1]); missing = !meta; }
    else if (parts[0] === "blog" && parts[1] && parts[1] !== "index.html") meta = await post(parts[1]);
    else if (parts[0] === "trainer-directory" && parts[1] === "coach" && parts[2]) meta = await coach(parts[2], url.origin);
  } catch (err) {
    console.error("share-meta lookup failed", url.pathname, err && err.message);
  }

  const res = await context.next();
  if (missing && (res.headers.get("content-type") || "").includes("text/html")) {
    const headers = new Headers(res.headers);
    headers.set("X-Robots-Tag", "noindex");
    return new Response(res.body, { status: 404, headers });
  }
  if (!meta || !(res.headers.get("content-type") || "").includes("text/html")) return res;

  // one address per page: always with the closing slash, never with ?…
  meta.url = SITE + url.pathname.replace(/\/?$/, "/");
  let html = await res.text();
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(meta.title)}</title>`);
  html = html.replace(/<meta\s+name="description"[^>]*>/i, "");
  html = html.replace("</head>", () => tags(meta) + "</head>");
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
    `<link rel="canonical" href="${esc(m.url)}">`,
    m.ld ? `<script type="application/ld+json">${ld(withUrl(m.ld, m.url))}</script>` : "",
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
  const c = await rest(`courses?slug=eq.${encodeURIComponent(slug)}&select=brand,type,title,summary,venue_name,address,city,country,starts_at,ends_at,timezone,status,archived,cancelled_at,price_cents,currency,language,on_sale_on,created_at&limit=1`);
  if (!c) return null;
  const when = dates(c.starts_at, c.ends_at, c.timezone);
  const where = [c.city, countryName(c.country)].filter(Boolean).join(", ");
  const first = [when, where].filter(Boolean).join(" · ");
  const brand = BRAND[c.brand] || "BirdBox Coaching";
  const description = [first, c.summary || (c.type === "workshop" ? `${brand} workshop.` : `${brand} live seminar.`)].filter(Boolean).join(". ");
  const image = `${SITE}/share/${c.brand === "tgc" || c.brand === "tcc" ? "seminar-" + c.brand : "seminar-birdbox"}.jpg`;
  // Only a course that is on sale (or full) is described as an event.
  const listed = !c.archived && ["published", "full"].includes(c.status) && c.starts_at;
  return {
    title: c.title || brand,
    description,
    image,
    ld: listed ? {
      "@context": "https://schema.org",
      "@type": "EducationEvent",
      name: c.title || brand,
      description,
      image: [image],
      startDate: c.starts_at,
      endDate: c.ends_at || c.starts_at,
      eventStatus: c.cancelled_at ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      inLanguage: c.language || "en",
      location: {
        "@type": "Place",
        name: c.venue_name || where || brand,
        address: {
          "@type": "PostalAddress",
          streetAddress: c.address || undefined,
          addressLocality: c.city || undefined,
          addressCountry: c.country || undefined,
        },
      },
      organizer: { "@type": "Organization", name: "BirdBox Coaching", url: SITE },
      performer: { "@type": "Organization", name: brand },
      offers: c.price_cents ? {
        "@type": "Offer",
        price: (c.price_cents / 100).toFixed(2),
        priceCurrency: String(c.currency || "EUR").toUpperCase(),
        availability: c.status === "full" ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
        // on sale from: the date set in the portal, else the day it was added
        validFrom: c.on_sale_on || c.created_at || undefined,
      } : undefined,
    } : null,
  };
}

async function post(slug) {
  const p = await rest(`blog_posts?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=title,excerpt,hero_path,published_at,updated_at&limit=1`);
  if (!p) return null;
  const image = p.hero_path
    ? `${SUPABASE_URL}/storage/v1/object/public/blog/${p.hero_path.split("/").map(encodeURIComponent).join("/")}`
    : `${SITE}/share/blog.jpg`;
  return {
    type: "article",
    title: p.title,
    description: p.excerpt || "From the BirdBox Coaching blog.",
    image,
    ld: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: p.title,
      description: p.excerpt || undefined,
      image: [image],
      datePublished: p.published_at || undefined,
      dateModified: p.updated_at || p.published_at || undefined,
      author: { "@type": "Organization", name: "BirdBox Coaching", url: SITE },
      publisher: { "@type": "Organization", name: "BirdBox Coaching", logo: { "@type": "ImageObject", url: `${SITE}/icon-512.png` } },
    },
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

// the page's address on the item, and on its price (where to book)
function withUrl(item, url) {
  const out = { ...item, url };
  if (item.offers) out.offers = { ...item.offers, url };
  return out;
}

// JSON for a <script> tag: "<" written as \u003c so text can never close it
function ld(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const config = { path: ["/c/*", "/blog/*", "/trainer-directory/coach/*"] };
