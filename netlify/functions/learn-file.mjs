// netlify/functions/learn-file.mjs
//
// Serves the HTML files of a course package from our own address.
//
// Course packages (Rise SCORM exports) live in the Supabase "learn"
// bucket. They have to load from birdboxcoaching.com, not from
// supabase.co, because the course looks for the SCORM player in the
// page around it, and a browser only allows that on the same address.
//
// Everything except .html goes straight through a rewrite in
// _redirects (images, scripts, the big PDFs). HTML comes through here
// because Supabase serves stored .html as plain text for safety, which
// would show the course as source code instead of running it.
//
// Paths contain the version id, so a file never changes once uploaded
// and can be cached for a long time.

const BASE = (process.env.SUPABASE_URL || "https://yvdmazpxtpuvidlcifnq.supabase.co").replace(/\/+$/, "");

export default async (req) => {
  const url = new URL(req.url);
  const rest = url.pathname.replace(/^\/learn\/c\//, "");

  // Only version-id paths ending in .html, nothing that climbs out.
  if (!/^[0-9a-f-]{36}\//.test(rest) || rest.includes("..") || !/\.html?$/i.test(rest)) {
    return new Response("Not found", { status: 404 });
  }

  const upstream = await fetch(`${BASE}/storage/v1/object/public/learn/${rest}`);
  if (!upstream.ok) {
    return new Response("Not found", { status: upstream.status === 404 ? 404 : 502 });
  }

  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Netlify-CDN-Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
};

export const config = { path: "/learn/c/*.html" };
