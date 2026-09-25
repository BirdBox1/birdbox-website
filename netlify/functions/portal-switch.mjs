// netlify/functions/portal-switch.mjs
//
// Moves a signed-in coach between the seminars portal
// (birdboxcoaching.com/portal/) and the programming portal
// (app.birdboxcoaching.com) without a second sign-in.
//
// The two sites are on different addresses, so the browser keeps a
// separate login for each. Handing the current session across would
// make the two sites share one refresh token, and Supabase signs both
// out the moment one of them reuses a token the other already spent.
// So instead this makes a brand-new one-time sign-in for the same
// person (a magic link that is never emailed) and the other site
// exchanges it for its own session.
//
// Only active staff can use it. The token is single-use and expires
// with Supabase's normal link lifetime.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const TARGETS = {
  train: "https://app.birdboxcoaching.com/",
  portal: "https://birdboxcoaching.com/portal/",
};

// Where the request may come from. The programming portal calls this
// across sites, so it needs CORS; the seminars portal is same-site.
const ORIGINS = [
  "https://app.birdboxcoaching.com",
  "https://birdbox-train.netlify.app",
  "https://www.birdboxcoaching.com",
  "https://birdboxcoaching.com",
  "https://warm-beijinho-9a5b1c.netlify.app",
];

export default async (request) => {
  const origin = request.headers.get("origin") || "";
  const cors = ORIGINS.includes(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
      }
    : {};

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Use POST" }, 405, cors);

  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return json({ error: "Not signed in" }, 401, cors);

    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth?.user?.email) return json({ error: "Not signed in" }, 401, cors);

    const { data: me } = await supabase
      .from("staff")
      .select("id, active")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (!me || !me.active) return json({ error: "Not a member of staff" }, 403, cors);

    const body = await request.json().catch(() => ({}));
    const base = TARGETS[body.to];
    if (!base) return json({ error: "Unknown destination" }, 400, cors);

    const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: auth.user.email,
    });
    const hashed = link?.properties?.hashed_token;
    if (linkErr || !hashed) {
      console.error("portal-switch generateLink:", linkErr);
      return json({ error: "Could not switch just now" }, 500, cors);
    }

    return json({ url: `${base}?bbswitch=${encodeURIComponent(hashed)}` }, 200, cors);
  } catch (err) {
    console.error("portal-switch failed:", err);
    return json({ error: "Could not switch just now" }, 500, cors);
  }
};

function json(obj, status, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}
