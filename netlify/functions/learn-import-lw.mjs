// netlify/functions/learn-import-lw.mjs
//
// Portal → Online courses → "Import from LearnWorlds" (admins only).
// Copies everyone enrolled in a LearnWorlds course into learn_enrolments
// for the matching BirdBox Learn course(s) (learn_courses.lw_course_id),
// so existing students can log in at birdboxcoaching.com/learn/.
// Nobody is emailed and nothing in LearnWorlds is changed.
//
// POST { action: "preview" }
//   -> { courses: [{ lw_id, slugs, users, pages, sample }] }
//      Reads page 1 of each course so you can check the numbers first.
//
// POST { action: "import", lw_id, page }
//   -> { seen, added, pages }
//      Imports one page of one course. The portal calls it page by page,
//      so a big course never times out. Running it again is safe: people
//      already enrolled are left as they are.

import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BASE = (process.env.LEARNWORLDS_BASE_URL || "").replace(/\/+$/, "");
const ROOT = BASE.replace(/\/v2$/, "");
const CLIENT_ID = process.env.LEARNWORLDS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.LEARNWORLDS_CLIENT_SECRET || "";

const json = (b, status = 200) => new Response(JSON.stringify(b), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

let token = null, tokenUntil = 0;
async function getToken() {
  if (token && Date.now() < tokenUntil) return token;
  const res = await fetch(ROOT + "/oauth2/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Lw-Client": CLIENT_ID },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "client_credentials" }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  const t = body.access_token || (body.tokenData && body.tokenData.access_token);
  if (!res.ok || !t) throw new Error("LearnWorlds login failed (" + res.status + ")");
  token = t; tokenUntil = Date.now() + 50 * 60 * 1000;
  return token;
}
async function lw(path) {
  const res = await fetch(BASE + path, {
    headers: { Authorization: "Bearer " + (await getToken()), "Lw-Client": CLIENT_ID, Accept: "application/json" },
  });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch (e) {}
  return { ok: res.ok, status: res.status, parsed, text };
}

// One page of the people enrolled in a LearnWorlds course.
async function coursePage(lwId, page) {
  const res = await lw(`/courses/${encodeURIComponent(lwId)}/users?page=${page}`);
  if (!res.ok) throw new Error(`LearnWorlds would not list ${lwId} (${res.status}): ${res.text.slice(0, 200)}`);
  const body = res.parsed || {};
  const items = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
  const meta = body.meta || {};
  const pages = Number(meta.totalPages || body.totalPages || 0) || (items.length ? page + 1 : page);
  const total = Number(meta.totalItems || meta.total || body.total || 0) || null;
  return { items, pages, total };
}

// A student's progress in one course. Two LearnWorlds shapes are tried;
// "probe" shows exactly what came back so the reading can be checked.
async function progressRaw(userId, lwId) {
  const tries = [`/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(lwId)}/progress`, `/users/${encodeURIComponent(userId)}/progress`];
  let last = null;
  for (const path of tries) {
    let r = await lw(path);
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 3000)); r = await lw(path); }
    last = { ...r, tried: path };
    if (r.ok) return last;
  }
  return last;
}
function readProgress(body, lwId) {
  if (!body) return null;
  let rec = body;
  const list = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : null;
  if (list) rec = list.find((x) => x && String(x.course_id || x.courseId || (x.course && x.course.id) || "") === String(lwId)) || null;
  if (rec && rec.data && !Array.isArray(rec.data)) rec = rec.data;
  if (!rec) return null;
  const status = String(rec.status || rec.completion_status || "").toLowerCase();
  const rate = Number(rec.progress_rate ?? rec.progressRate ?? rec.progress ?? rec.completion_rate ?? NaN);
  const score = Number(rec.average_score_rate ?? rec.averageScoreRate ?? rec.score ?? NaN);
  let at = rec.completed_at || rec.completedAt || rec.completion_date || rec.certificate_issued_at || null;
  if (typeof at === "number") at = new Date(at < 1e12 ? at * 1000 : at).toISOString();
  else if (typeof at === "string" && /^\d{9,}$/.test(at)) at = new Date(Number(at) * (at.length < 12 ? 1000 : 1)).toISOString();
  else if (typeof at !== "string") at = null;
  const completed = /complete|passed|finished/.test(status) || rate >= 100;
  return { completed, at, progress: isNaN(rate) ? null : Math.round(rate), score: isNaN(score) ? null : (score > 1 ? score / 100 : score) };
}

const pick = (u, ...keys) => { for (const k of keys) if (u && u[k]) return String(u[k]).trim(); return null; };

async function courseMap() {
  const { data, error } = await db.from("learn_courses").select("id, slug, lw_course_id").not("lw_course_id", "is", null);
  if (error) throw new Error(error.message);
  const map = new Map();
  for (const c of data) {
    const k = String(c.lw_course_id);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  }
  return map;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const t = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    const { data: auth } = await db.auth.getUser(t);
    const user = auth && auth.user;
    if (!user) return json({ error: "Please log in again." }, 401);
    const { data: me } = await db.from("staff").select("role, active").eq("id", user.id).maybeSingle();
    if (!me || !me.active || me.role !== "admin") return json({ error: "Only an admin can do this." }, 403);
    if (!BASE || !CLIENT_ID || !CLIENT_SECRET) return json({ error: "LearnWorlds is not configured on the site." }, 500);

    const body = await req.json().catch(() => ({}));
    const map = await courseMap();

    if (body.action === "preview") {
      const out = [];
      for (const [lwId, rows] of map) {
        try {
          const p = await coursePage(lwId, 1);
          const s = p.items[0] || {};
          out.push({ lw_id: lwId, slugs: rows.map((r) => r.slug), users: p.total, pages: p.pages, perPage: p.items.length,
            sample: { email: pick(s, "email"), first: pick(s, "first_name", "firstName"), last: pick(s, "last_name", "lastName"), keys: Object.keys(s).slice(0, 25) } });
        } catch (e) { out.push({ lw_id: lwId, slugs: rows.map((r) => r.slug), error: e.message }); }
      }
      return json({ courses: out });
    }

    // ---- completions: who finished the course on LearnWorlds ----
    if (body.action === "probe") {
      const lwId = String(body.lw_id || "");
      const p = await coursePage(lwId, 1);
      const u = p.items.find((x) => x && x.id) || {};
      const raw = await progressRaw(u.id, lwId);
      return json({ user: pick(u, "email"), tried: raw.tried, status: raw.status, body: raw.parsed || raw.text, read: readProgress(raw.parsed, lwId) });
    }
    if (body.action === "completions") {
      const lwId = String(body.lw_id || ""), page = Math.max(1, parseInt(body.page, 10) || 1), save = !!body.save;
      const rows = map.get(lwId);
      if (!rows) return json({ error: "No BirdBox Learn course is linked to " + lwId }, 400);
      const p = await coursePage(lwId, page);
      const done = [];
      let checked = 0, failed = 0;
      for (const u of p.items) {
        const email = (pick(u, "email") || "").toLowerCase();
        if (!u.id || !email) continue;
        checked++;
        try {
          const raw = await progressRaw(u.id, lwId);
          const r = readProgress(raw.parsed, lwId);
          if (r && r.completed) done.push({ email, name: [pick(u, "first_name", "firstName"), pick(u, "last_name", "lastName")].filter(Boolean).join(" "), at: r.at, score: r.score, progress: r.progress });
        } catch (e) { failed++; }
      }
      if (save) {
        for (const d of done) {
          const { error } = await db.from("learn_enrolments")
            .update({ lw_completed_at: d.at || new Date().toISOString(), lw_score: d.score, lw_progress: d.progress })
            .eq("email", d.email).in("course_id", rows.map((r) => r.id));
          if (error) throw new Error(error.message);
        }
      }
      return json({ checked, failed, completed: done.length, people: done.slice(0, 50), pages: p.pages });
    }

    if (body.action === "import") {
      const lwId = String(body.lw_id || ""), page = Math.max(1, parseInt(body.page, 10) || 1);
      const rows = map.get(lwId);
      if (!rows) return json({ error: "No BirdBox Learn course is linked to " + lwId }, 400);
      const p = await coursePage(lwId, page);
      const people = [];
      for (const u of p.items) {
        const email = (pick(u, "email") || "").toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
        const first = pick(u, "first_name", "firstName"), last = pick(u, "last_name", "lastName");
        for (const c of rows) people.push({ course_id: c.id, email, source: "learnworlds import", first_name: first ? first.slice(0, 80) : null, last_name: last ? last.slice(0, 80) : null });
      }
      let added = 0;
      if (people.length) {
        const { data, error } = await db.from("learn_enrolments").upsert(people, { onConflict: "course_id,email", ignoreDuplicates: true }).select("id");
        if (error) throw new Error(error.message);
        added = (data || []).length;
      }
      return json({ seen: p.items.length, added, pages: p.pages });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error("learn-import-lw:", err && (err.message || err));
    return json({ error: String((err && err.message) || err) }, 500);
  }
};
