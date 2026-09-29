// netlify/functions/learnworlds.mjs
//
// Everything that talks to LearnWorlds. Used by the Stripe webhook
// and by the portal's manual grant, so there is one implementation
// to fix rather than two.
//
// Every request shape below was verified against the live school
// rather than taken from documentation:
//
//   token   POST {root}/oauth2/access_token   (note: NOT under /v2)
//   find    GET  {base}/users/{email}         200 = found, 404 = absent
//   create  POST {base}/users                 201, returns the id
//   enrol   POST {base}/users/{id}/enrollment 200 {"success":true}
//
//   list    GET  {base}/courses?page=N       every course in the school
//
// The enrolment body accepts EXACTLY five keys — productId,
// productType, justification, price, send_enrollment_email. A sixth
// is rejected with a 422.

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const BASE = (process.env.LEARNWORLDS_BASE_URL || "").replace(/\/+$/, "");
const ROOT = BASE.replace(/\/v2$/, "");
const CLIENT_ID = process.env.LEARNWORLDS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.LEARNWORLDS_CLIENT_SECRET || "";

export const learnworldsConfigured = () =>
  !!(BASE && CLIENT_ID && CLIENT_SECRET);

// Tokens are reused for the life of the function instance, which
// saves a round trip when several people register at once.
let cachedToken = null;
let cachedUntil = 0;

async function getToken() {
  if (cachedToken && Date.now() < cachedUntil) return cachedToken;

  const res = await fetch(ROOT + "/oauth2/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Lw-Client": CLIENT_ID,
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
    }).toString(),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Token request failed (${res.status})`);

  let body;
  try { body = JSON.parse(text); }
  catch (e) { throw new Error("Token response was not JSON"); }

  const token = body.access_token || (body.tokenData && body.tokenData.access_token);
  if (!token) throw new Error("No access token in the response");

  // Expire our copy early so we never present one mid-expiry.
  const seconds = Number(body.expires_in || body.tokenData?.expires_in || 3600);
  cachedToken = token;
  cachedUntil = Date.now() + Math.max(60, seconds - 120) * 1000;
  return token;
}

async function call(method, path, body) {
  const token = await getToken();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Lw-Client": CLIENT_ID,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* not json */ }
  return { ok: res.ok, status: res.status, parsed, text };
}

// Which product a brand, level and language maps to. Returns null
// when nothing is set up, which means nothing is given away.
export async function findProduct(supabase, { brand, level, language }) {
  const digits = String(level == null ? "" : level).replace(/\D/g, "");
  if (!brand || !digits || !language) return null;

  const { data, error } = await supabase
    .from("learnworlds_products")
    .select("brand, level, language, product_id, product_type, label, active")
    .eq("brand", brand)
    .eq("language", language)
    .eq("active", true);

  if (error) throw new Error("Product lookup failed: " + error.message);

  return (data || []).find(
    (r) => String(r.level || "").replace(/\D/g, "") === digits && r.product_id
  ) || null;
}

// The API's own filtering does NOT work — ?email= and ?search= return
// the entire user list regardless of what is asked for. So the path
// route is used, and the address on whatever comes back is checked
// before the id is trusted. Without that check this would enrol the
// wrong person.
async function findUser(email) {
  const res = await call("GET", `/users/${encodeURIComponent(email)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`User lookup failed (${res.status})`);

  const u = res.parsed;
  if (!u || !u.id) return null;
  if (String(u.email || "").toLowerCase() !== String(email).toLowerCase()) {
    throw new Error("Lookup returned a different user — refusing to continue");
  }
  return u.id;
}

async function createUser({ email, firstName, lastName }) {
  const res = await call("POST", "/users", {
    email,
    username: [firstName, lastName].filter(Boolean).join(" ") || email.split("@")[0],
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    // This is what sends them the set-your-password link. Without it
    // the account exists but nobody can get into it.
    send_registration_email: true,
  });

  if (!res.ok) throw new Error(`Could not create the user (${res.status})`);
  const id = res.parsed?.id || res.parsed?.user_id || null;
  if (!id) throw new Error("User created but no id came back");
  return id;
}

// Find or create the person, then enrol them at no charge.
// Never throws: the caller is usually mid-payment and must not fail
// because an LMS was slow. Returns what happened instead.
export async function grantOnlineCourse(supabase, {
  email, firstName, lastName, brand, level, language, justification,
}) {
  if (!learnworldsConfigured()) {
    return { status: "failed", error: "LearnWorlds is not configured" };
  }
  if (!email) return { status: "failed", error: "No email address" };

  try {
    const product = await findProduct(supabase, { brand, level, language });
    if (!product) {
      return {
        status: "failed",
        error: `No online course set up for ${brand} level ${level} in ${language || "no language"}`,
      };
    }

    const res = await enrolById({
      email, firstName, lastName,
      productId: product.product_id,
      productType: product.product_type || "course",
      justification: justification || "Included free with the live seminar",
    });
    if (res.status !== "enrolled") return res;
    const userId = res.userId;
    const created = res.userWasCreated;

    return {
      status: "enrolled",
      userId,
      userWasCreated: created,
      productId: product.product_id,
      label: product.label || language,
      onSite: !!res.onSite,
    };
  } catch (err) {
    return { status: "failed", error: String(err.message || err).slice(0, 300) };
  }
}

// Find or create the person, then enrol them in one LearnWorlds
// course by its id. Same rules as above: never throws, and a brand
// new account relies on LearnWorlds' own set-password email.
export async function enrolById({
  email, firstName, lastName, productId, productType, justification,
}) {
  // Our own course area gets the same enrolment first, so every
  // way of selling or granting a course also opens it on
  // birdboxcoaching.com/learn/. Never throws.
  const mirror = await mirrorToLearn({ email, productId, justification, firstName, lastName });

  // A course that has moved to birdboxcoaching.com/learn/ is not given
  // in LearnWorlds any more, so the buyer gets one set of emails and one
  // place to log in. Callers see onSite: true and word their emails for it.
  if (mirror.status === "enrolled" && mirror.onSite) {
    return { status: "enrolled", userId: null, userWasCreated: false, productId, onSite: true };
  }
  if (mirror.status === "failed" && mirror.onSite) {
    return { status: "failed", productId, onSite: true, error: "Could not add them to the course on birdboxcoaching.com: " + mirror.error };
  }

  if (!learnworldsConfigured()) {
    return { status: "failed", error: "LearnWorlds is not configured" };
  }
  if (!email) return { status: "failed", error: "No email address" };
  if (!productId) return { status: "failed", error: "No course chosen" };

  try {
    let userId = await findUser(email);
    const created = !userId;
    if (!userId) userId = await createUser({ email, firstName, lastName });

    const res = await call("POST", `/users/${encodeURIComponent(userId)}/enrollment`, {
      productId,
      productType: productType || "course",
      justification: justification || "Enrolled by BirdBox",
      price: 0,
      send_enrollment_email: !created,
    });

    if (!res.ok) {
      return {
        status: "failed",
        userId,
        productId,
        error: `Enrolment rejected (${res.status}): ${String(res.text || "").slice(0, 200)}`,
      };
    }
    return { status: "enrolled", userId, userWasCreated: created, productId };
  } catch (err) {
    return { status: "failed", error: String(err.message || err).slice(0, 300) };
  }
}

// Every course in the school, read live, so a new course or a new
// language shows up in the portal without anything being set up.
// Drafts are left out. Pages are followed until one comes back short.
export async function listCourses() {
  if (!learnworldsConfigured()) throw new Error("LearnWorlds is not configured");

  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await call("GET", `/courses?page=${page}`);
    if (!res.ok) throw new Error(`Could not list the academy courses (${res.status})`);

    const body = res.parsed || {};
    const items = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
    for (const c of items) {
      if (!c || !c.id) continue;
      const access = String(c.access || "").toLowerCase();
      if (access === "draft") continue;
      out.push({ id: String(c.id), title: String(c.title || c.id), access });
    }

    const meta = body.meta || {};
    const total = Number(meta.totalPages || body.totalPages || 0);
    if (total ? page >= total : items.length === 0) break;
  }

  return out.sort((a, b) => a.title.localeCompare(b.title));
}

// ---- BirdBox Learn ---------------------------------------------
// Adds the person to learn_enrolments for every learn_courses row
// whose lw_course_id is this LearnWorlds course. A course that has
// not been set up in BirdBox Learn yet is simply skipped. Never throws:
// a failure here must not stop the LearnWorlds enrolment or a payment.
let learnDb = null;
export async function mirrorToLearn({ email, productId, justification, firstName, lastName }) {
  try {
    if (!email || !productId) return { status: "skipped" };
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { status: "skipped" };
    if (!learnDb) {
      learnDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } });
    }
    var { data: courses, error } = await learnDb
      .from("learn_courses").select("id, on_site").eq("lw_course_id", String(productId)).eq("active", true);
    if (error) throw error;
    if (!courses || !courses.length) return { status: "skipped" };
    var onSite = courses.every((c) => c.on_site === true);

    const rows = courses.map((c) => ({
      course_id: c.id,
      email: String(email).trim().toLowerCase(),
      source: String(justification || "auto").slice(0, 120),
      first_name: firstName ? String(firstName).trim().slice(0, 80) : null,
      last_name: lastName ? String(lastName).trim().slice(0, 80) : null,
    }));
    const { error: insErr } = await learnDb
      .from("learn_enrolments")
      .upsert(rows, { onConflict: "course_id,email", ignoreDuplicates: true });
    if (insErr) throw insErr;
    return { status: "enrolled", count: rows.length, onSite };
  } catch (err) {
    console.error("BirdBox Learn enrolment failed:", err && (err.message || err));
    return { status: "failed", onSite: typeof onSite === "boolean" ? onSite : false, error: String((err && err.message) || err).slice(0, 300) };
  }
}

// True when this LearnWorlds course id has moved to birdboxcoaching.com/learn/.
export async function isOnSite(productId) {
  try {
    if (!productId || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
    if (!learnDb) {
      learnDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } });
    }
    const { data } = await learnDb.from("learn_courses").select("on_site")
      .eq("lw_course_id", String(productId)).eq("active", true);
    return !!(data && data.length && data.every((c) => c.on_site === true));
  } catch (e) { return false; }
}

// Where students of on-site courses log in.
export const LEARN_URL = "https://birdboxcoaching.com/learn/";

// A personal "set up my account" link for welcome emails. It carries the
// email and an expiry, signed so it cannot be altered. Opening it goes to
// /learn/start, which logs them straight in (making the account the first
// time) -- no need to ask for a login link. Valid for 30 days; after that
// the page asks them to request a fresh link by email.
const LINK_SECRET = () => process.env.LEARN_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export function signLearnLink(email, expires) {
  return crypto.createHmac("sha256", LINK_SECRET()).update(String(email).toLowerCase() + "." + expires).digest("base64url");
}
export function learnStartLink(email, days = 30) {
  const e = String(email || "").trim().toLowerCase();
  const x = Math.floor(Date.now() / 1000) + days * 86400;
  return "https://birdboxcoaching.com/learn/start?e=" + encodeURIComponent(e) + "&x=" + x + "&s=" + signLearnLink(e, x);
}
