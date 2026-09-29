// netlify/functions/learn-rate.mjs
//
// The rating link a learner sends to a colleague or an athlete from their
// portfolio (birdboxcoaching.com/learn/rate/?t=<token>). The rater does not
// need an account: the token in the link is the only key.
//
// GET  ?t=<token>
//   -> { ok, first_name, role, qualities: [..], submitted }
// POST { t, name, ratings: { "<quality>": 1-10, ... } }
//   -> { ok }   saves once; the learner sees the scores in their portfolio.

import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(token) {
  if (!UUID.test(token || "")) return null;
  const { data: inv } = await db.from("learn_portfolio_invites")
    .select("id, role, submitted_at, portfolio_id, user_id").eq("token", token).maybeSingle();
  if (!inv) return null;
  const { data: doc } = await db.from("learn_portfolio").select("data, email, user_id").eq("id", inv.portfolio_id).maybeSingle();
  if (!doc) return null;
  const qualities = [];
  const seen = new Set();
  for (const r of doc.data?.rows || []) {
    const q = String(r.q || "").trim();
    if (q && !seen.has(q.toLowerCase())) { seen.add(q.toLowerCase()); qualities.push(q); }
  }
  // Their first name, from their course record if we have one.
  let first = "";
  const email = String(doc.email || "").toLowerCase();
  if (email) {
    const { data: e } = await db.from("learn_enrolments").select("first_name").eq("email", email).not("first_name", "is", null).limit(1);
    first = e?.[0]?.first_name || "";
  }
  if (!first && doc.user_id) {
    const { data: u } = await db.auth.admin.getUserById(doc.user_id);
    const m = u?.user?.user_metadata || {};
    first = m.first_name || String(m.full_name || m.name || "").split(" ")[0] || "";
  }
  return { inv, qualities, first: first || "Your coach" };
}

export default async (req) => {
  try {
    if (req.method === "GET") {
      const t = new URL(req.url).searchParams.get("t");
      const found = await load(t);
      if (!found) return json({ ok: false, error: "This rating link is not valid. Ask for a new one." }, 404);
      return json({ ok: true, first_name: found.first, role: found.inv.role, qualities: found.qualities, submitted: !!found.inv.submitted_at });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const found = await load(body.t);
      if (!found) return json({ ok: false, error: "This rating link is not valid. Ask for a new one." }, 404);
      if (found.inv.submitted_at) return json({ ok: false, error: "These ratings have already been sent. Thank you!" }, 409);

      const ratings = {};
      const given = body.ratings && typeof body.ratings === "object" ? body.ratings : {};
      for (const q of found.qualities) {
        const v = Number(given[q.toLowerCase()] ?? given[q]);
        if (Number.isInteger(v) && v >= 1 && v <= 10) ratings[q.toLowerCase()] = v;
      }
      if (!Object.keys(ratings).length) return json({ ok: false, error: "Please give at least one score." }, 400);

      const name = String(body.name || "").trim().slice(0, 80) || null;
      const { error } = await db.from("learn_portfolio_invites")
        .update({ ratings, rater_name: name, submitted_at: new Date().toISOString() })
        .eq("id", found.inv.id).is("submitted_at", null);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "Use GET or POST" }, 405);
  } catch (err) {
    console.error("learn-rate:", err);
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
