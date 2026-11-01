// netlify/lib/learn-pass.mjs
//
// The Level 1 discounts shown in BirdBox Learn (Nathan, 1 Nov 2026), so
// people do not have to ask for them afterwards:
//
//   online -> live   bought TGC (or TCC) Level 1 Online: 50% off a Level 1
//                    live seminar of the same course. Reached only from
//                    their logged-in BirdBox Learn page, through a pass.
//   live -> online   attended a TGC (or TCC) Level 1 live seminar: 50% off
//                    Level 1 Online of the same course, through their
//                    personal offer link (online_offers, as already sent
//                    after seminars).
//
// Never across courses: TGC to TGC, TCC to TCC. Once used, it is gone.
//
// The pass is not a code. It is signed here, names one person (their
// login, email and the name already on their BirdBox record), one course
// family, and lasts a day. The seminar checkout checks it again, takes the
// 50% off, and books the seat in that name and email, which cannot be
// changed there. So passing it on gets nobody else anything.

import crypto from "node:crypto";
import { db } from "./directory.mjs";

const SECRET = process.env.LEARN_PASS_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "x";
const DAY = 86400000;
export const PASS_PERCENT = 50;
export const BRANDS = ["tgc", "tcc"];

// on the registration, so a second 50% booking can be refused
export const passCode = (brand) => `L1ONLINE50-${String(brand).toUpperCase()}`;

const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (body) => crypto.createHmac("sha256", SECRET).update("learn-pass:" + body).digest("base64url");

export function makePass({ user, email, first, last, brand }) {
  const body = b64(JSON.stringify({ u: user, e: email, f: first, l: last, b: brand, x: Date.now() + DAY }));
  return body + "." + sign(body);
}

export function readPass(token) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const want = sign(body);
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p.x || p.x < Date.now() || !BRANDS.includes(p.b)) return null;
    return { user: p.u, email: p.e, first: p.f, last: p.l, brand: p.b };
  } catch (e) { return null; }
}

const like = (email) => String(email || "").replace(/[%_\\]/g, "\\$&");
const isL1 = (level) => String(level || "").replace(/\D/g, "") === "1";

// The Level 1 online courses they own, by course family
async function onlineL1(email) {
  const { data } = await db.from("learn_enrolments")
    .select("learn_courses(brand, level)").ilike("email", like(email));
  return new Set((data || []).map((r) => r.learn_courses).filter((c) => c && isL1(c.level))
    .map((c) => String(c.brand || "").toLowerCase()));
}

// Their Level 1 live seminar registrations, attended or not
async function liveL1(email) {
  const { data } = await db.from("registrations")
    .select("id, first_name, last_name, attended, status, discount_code, created_at, courses(brand, type, level)")
    .ilike("email", like(email)).order("created_at", { ascending: false });
  return (data || []).filter((r) => r.courses && r.courses.type === "live_seminar" && isL1(r.courses.level));
}

const split = (name) => {
  const n = String(name || "").replace(/\s+/g, " ").trim();
  const i = n.lastIndexOf(" ");
  return i > 0 ? { first: n.slice(0, i), last: n.slice(i + 1) } : n ? { first: n, last: "" } : null;
};

// The name the seat is booked in: as on their BirdBox certificate, else
// their last seminar registration, else their account.
export async function lockedName(user, email) {
  const { data: oc } = await db.from("learn_certificates").select("name")
    .or(`user_id.eq.${user.id},email.ilike.${like(email)}`).order("created_at", { ascending: false }).limit(1);
  if (oc?.[0]?.name) { const n = split(oc[0].name); if (n?.last) return { ...n, from: "certificate" }; }
  const { data: regs } = await db.from("registrations").select("id, first_name, last_name")
    .ilike("email", like(email)).order("created_at", { ascending: false }).limit(5);
  const ids = (regs || []).map((r) => r.id);
  if (ids.length) {
    const { data: lc } = await db.from("certificates").select("participant_name").in("registration_id", ids)
      .order("issued_at", { ascending: false }).limit(1);
    if (lc?.[0]?.participant_name) { const n = split(lc[0].participant_name); if (n?.last) return { ...n, from: "certificate" }; }
    const r = regs.find((x) => x.first_name && x.last_name && x.first_name !== "—");
    if (r) return { first: r.first_name, last: r.last_name };
  }
  const m = user.user_metadata || {};
  if (m.first_name && m.last_name) return { first: m.first_name, last: m.last_name };
  return split(m.full_name || m.name);
}

// What they are owed, for the My courses tab
export async function discountsFor(user, email) {
  const [online, live] = await Promise.all([onlineL1(email), liveL1(email)]);
  const out = [];
  for (const b of BRANDS) {
    const lives = live.filter((r) => String(r.courses.brand).toLowerCase() === b);
    const active = lives.filter((r) => (r.status || "active") !== "cancelled");
    // online -> live: not yet booked a Level 1 seminar of this course
    if (online.has(b) && !active.length) out.push({ kind: "seminar", brand: b });
    // live -> online: attended, and no online course yet
    const attended = active.find((r) => r.attended === true);
    if (attended && !online.has(b)) out.push({ kind: "online", brand: b, registration_id: attended.id });
  }
  return out;
}

// Has this person already booked with their 50%?
export async function passUsed(email, brand) {
  const { count } = await db.from("registrations").select("id", { count: "exact", head: true })
    .ilike("email", like(email)).eq("discount_code", passCode(brand)).neq("status", "cancelled");
  return (count || 0) > 0;
}
