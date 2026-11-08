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

// Key static pages, always with the trailing slash (without it Netlify
// answers with a redirect, which Google counts against the page).
// Updated 8 Nov 2026: the level, programming, workshop, mentorship and quiz
// pages were missing. Trial, portal, learn and thank-you pages stay out.
const STATIC = [
  { path: "/",                         priority: "1.0", freq: "weekly"  },
  { path: "/tgc/",                     priority: "0.9", freq: "weekly"  },
  { path: "/tcc/",                     priority: "0.9", freq: "weekly"  },
  { path: "/tec/",                     priority: "0.7", freq: "monthly" },
  { path: "/twc/",                     priority: "0.7", freq: "monthly" },
  { path: "/seminars/",                priority: "0.9", freq: "daily"   },
  { path: "/tgc/level-1/",             priority: "0.8", freq: "monthly" },
  { path: "/tgc/level-2/",             priority: "0.8", freq: "monthly" },
  { path: "/tcc/level-1/",             priority: "0.8", freq: "monthly" },
  { path: "/tcc/level-2/",             priority: "0.8", freq: "monthly" },
  { path: "/tgc/online-level-1/",      priority: "0.8", freq: "monthly" },
  { path: "/tcc/online-level-1/",      priority: "0.8", freq: "monthly" },
  { path: "/tgc/programming/",         priority: "0.8", freq: "weekly"  },
  { path: "/tcc/programming/",         priority: "0.7", freq: "monthly" },
  { path: "/tgc/workshops/",           priority: "0.7", freq: "monthly" },
  { path: "/tgc/mentorship/",          priority: "0.6", freq: "monthly" },
  { path: "/tcc/mentorship-essential/", priority: "0.6", freq: "monthly" },
  { path: "/tcc/mentorship-premium/",  priority: "0.6", freq: "monthly" },
  { path: "/quiz/",                    priority: "0.6", freq: "monthly" },
  { path: "/tgc/quiz/",                priority: "0.6", freq: "monthly" },
  { path: "/blog/",                    priority: "0.7", freq: "weekly"  },
  { path: "/trainer-directory/",       priority: "0.6", freq: "weekly"  },
  { path: "/tgc/staff-pathway/",       priority: "0.5", freq: "monthly" },
  { path: "/tcc/staff-pathway/",       priority: "0.5", freq: "monthly" },
  { path: "/tec/staff-pathway/",       priority: "0.5", freq: "monthly" },
  { path: "/twc/staff-pathway/",       priority: "0.5", freq: "monthly" },
  { path: "/about/",                   priority: "0.5", freq: "yearly"  },
  { path: "/birdbox-team/",            priority: "0.4", freq: "yearly"  },
  { path: "/shop/",                    priority: "0.5", freq: "monthly" },
  { path: "/gift/",                    priority: "0.5", freq: "monthly" },
  { path: "/support/",                 priority: "0.4", freq: "yearly"  },
  { path: "/privacy/",                 priority: "0.2", freq: "yearly"  },
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
      .select("slug, created_at")
      .eq("status", "published")
      .eq("archived", false)
      .gt("starts_at", nowIso);
    for (const c of courses || []) {
      if (!c.slug) continue;
      entries.push(urlEntry(`${SITE}/c/${c.slug}/`, day(c.created_at), "weekly", "0.8"));
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

  // Each coach in the trainer directory who is shown publicly
  try {
    const { data: coaches } = await supabase
      .from("directory_profiles")
      .select("slug")
      .eq("visible", true)
      .is("hidden_at", null);
    for (const c of coaches || []) {
      if (!c.slug) continue;
      entries.push(urlEntry(`${SITE}/trainer-directory/coach/${c.slug}/`, null, "monthly", "0.5"));
    }
  } catch (_) { /* skip coaches if unavailable */ }

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
