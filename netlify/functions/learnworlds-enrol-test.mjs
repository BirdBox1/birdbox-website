// netlify/functions/learnworlds-enrol-test.mjs
//
// TEMPORARY. Delete alongside learnworlds-check.mjs.
//
// Works out the exact request shapes for the three calls the webhook
// will make, by trying each candidate against the real school and
// reporting which one answered:
//
//   1. find a user by email
//   2. create one if they do not exist
//   3. enrol them in a product at no charge
//
// Call it with:
//   ?email=you+lwtest@example.com&product=l2esp&type=course
//
// THIS CREATES A REAL USER AND A REAL ENROLMENT. Use an address you
// control, and delete the user in LearnWorlds afterwards.

const BASE = (process.env.LEARNWORLDS_BASE_URL || "").replace(/\/+$/, "");
const ROOT = BASE.replace(/\/v2$/, "");
const CLIENT_ID = process.env.LEARNWORLDS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.LEARNWORLDS_CLIENT_SECRET || "";

const clip = (s) => String(s || "").slice(0, 400);

export default async (req) => {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").trim();
  const product = (url.searchParams.get("product") || "").trim();
  const type = (url.searchParams.get("type") || "course").trim();

  if (!email || !product) {
    return json({ ok: false, error: "Add ?email=...&product=...&type=course" }, 400);
  }

  const log = [];

  // ---- token (path already proven by learnworlds-check) --------
  let token;
  try {
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
    const body = await res.json();
    token = body.access_token || body.tokenData?.access_token;
    if (!token) return json({ ok: false, step: "token", body: clip(JSON.stringify(body)) }, 502);
  } catch (err) {
    return json({ ok: false, step: "token", error: clip(err.message) }, 502);
  }

  const H = {
    Authorization: "Bearer " + token,
    "Lw-Client": CLIENT_ID,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const attempt = async (label, method, path, body) => {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: H,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      log.push({ label, method, path, status: res.status, body: clip(text) });
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) { /* not json */ }
      return { ok: res.ok, status: res.status, parsed };
    } catch (err) {
      log.push({ label, method, path, error: clip(err.message) });
      return { ok: false, status: 0, parsed: null };
    }
  };

  // ---- 1. find the user ----------------------------------------
  let userId = null;

  const lookups = [
    ["lookup by query", "GET", `/users?email=${encodeURIComponent(email)}`],
    ["lookup by path", "GET", `/users/${encodeURIComponent(email)}`],
    ["lookup by search", "GET", `/users?search=${encodeURIComponent(email)}`],
  ];

  for (const [label, method, path] of lookups) {
    const r = await attempt(label, method, path);
    if (!r.ok || !r.parsed) continue;
    const rows = Array.isArray(r.parsed)
      ? r.parsed
      : (r.parsed.data || r.parsed.users || (r.parsed.id ? [r.parsed] : []));
    const hit = rows.find((u) =>
      String(u.email || "").toLowerCase() === email.toLowerCase()) || null;
    if (hit) { userId = hit.id || hit.user_id || null; break; }
  }

  // ---- 2. create if missing ------------------------------------
  let created = false;
  if (!userId) {
    const r = await attempt("create user", "POST", "/users", {
      email,
      username: email.split("@")[0],
      send_registration_email: true,
    });
    if (r.ok && r.parsed) {
      userId = r.parsed.id || r.parsed.user_id || r.parsed.data?.id || null;
      created = !!userId;
    }
  }

  if (!userId) {
    return json({
      ok: false,
      step: "no user id",
      hint: "Read the log below — the successful call shows the shape to use.",
      log,
    }, 502);
  }

  // ---- 3. enrol at no charge -----------------------------------
  const enrolBody = {
    productId: product,
    productType: type,
    justification: "Included free with the TCC Level 2 live seminar",
    price: 0,
    send_enrollment_email: true,
    sendEnrollmentEmail: true,
  };

  const enrolPaths = [
    ["enrol nested", "POST", `/users/${encodeURIComponent(userId)}/enrollment`],
    ["enrol nested plural", "POST", `/users/${encodeURIComponent(userId)}/enrollments`],
  ];

  let enrolled = false;
  for (const [label, method, path] of enrolPaths) {
    const r = await attempt(label, method, path, enrolBody);
    if (r.ok) { enrolled = true; break; }
  }

  return json({
    ok: enrolled,
    userId,
    userWasCreated: created,
    enrolled,
    log,
    next: enrolled
      ? "Working. Tell me which labels succeeded and I will write the webhook."
      : "Enrolment failed — the log shows what the API said.",
  });
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
