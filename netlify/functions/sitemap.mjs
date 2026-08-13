// netlify/functions/sitemap.mjs
//
// Live sitemap.xml — generated fresh from the database each time, so it always
// reflects the current live courses and published blog posts. Served at
// /sitemap.xml via a Netlify redirect (see deploy notes).
//
// Env (already on Netlify): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const SITE = (process.env.SITE_URL || "https://birdboxcoaching.com").replace(/\/+$/, "");

// Key static pages. Add or remove to match your real routes.
const STATIC = [
  { path: "/",                  priority: "1.0", freq: "weekly"  },
  { path: "/tcc",               priority: "0.9", freq: "weekly"  },
  { path: "/tgc",               priority: "0.9", freq: "weekly"  },
  { path: "/tec",               priority: "0.7", freq: "monthly" },
  { path: "/twc",               priority: "0.7", freq: "monthly" },
  { path: "/seminars/",         priority: "0.8", freq: "daily"   },
  { path: "/blog/",             priority: "0.7", freq: "weekly"  },
  { path: "/tcc/online-level-1/", priority: "0.8", freq: "monthly" },
  { path: "/tgc/online-level-1/", priority: "0.8", freq: "monthly" },
  { path: "/trainer-directory/", priority: "0.5", freq: "monthly" },
  { path: "/about",             priority: "0.4", freq: "yearly"  },
];

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);

function urlEntry(loc, lastmod, freq, priority) {
  return [
    "  <url>",
    `    <loc>${esc(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    freq ? `    <changefreq>${freq}</changefreq>` : null,
    priority ? `    <priority>${priority}</priority>` : null,
    "  </url>",
  ].filter(Boolean).join("\n");
}

export default async () => {
  const nowIso = new Date().toISOString();
  const entries = [];

  // Static pages
  for (const s of STATIC) {
    entries.push(urlEntry(`${SITE}${s.path}`, null, s.freq, s.priority));
  }

  // Live, upcoming seminar/registration pages
  try {
    const { data: courses } = await supabase
      .from("courses")
      .select("slug, updated_at, created_at")
      .eq("status", "published")
      .eq("archived", false)
      .gt("starts_at", nowIso);
    for (const c of courses || []) {
      if (!c.slug) continue;
      entries.push(urlEntry(`${SITE}/c/${c.slug}/`, day(c.updated_at || c.created_at), "weekly", "0.8"));
    }
  } catch (_) { /* skip courses if unavailable */ }

  // Published blog posts
  try {
    const { data: posts } = await supabase
      .from("blog_posts")
      .select("slug, updated_at, published_at")
      .eq("status", "published");
    for (const p of posts || []) {
      if (!p.slug) continue;
      entries.push(urlEntry(`${SITE}/blog/${p.slug}/`, day(p.updated_at || p.published_at), "monthly", "0.6"));
    }
  } catch (_) { /* skip posts if unavailable */ }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.join("\n") +
    `\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
