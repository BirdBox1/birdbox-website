// netlify/functions/learnworlds-check.mjs
//
// TEMPORARY. Delete this file once the product IDs are recorded.
//
// Proves three things in one call:
//   1. the credentials in Netlify are correct
//   2. which OAuth token path this school uses
//   3. the real course IDs, read from LearnWorlds rather than guessed
//      from a page slug
//
// Returns only course ids and titles. The client secret is never
// echoed, and error bodies are truncated in case they quote it back.

const BASE = (process.env.LEARNWORLDS_BASE_URL || "").replace(/\/+$/, "");
const CLIENT_ID = process.env.LEARNWORLDS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.LEARNWORLDS_CLIENT_SECRET || "";

// The API lives under /v2 but the token endpoint may sit above it.
// Rather than assume, try both and report which answered.
const TOKEN_URLS = [
  BASE.replace(/\/v2$/, "") + "/oauth2/access_token",
  BASE + "/oauth2/access_token",
];

const clip = (s) => String(s || "").slice(0, 300);

export default async () => {
  const notes = [];

  if (!BASE || !CLIENT_ID || !CLIENT_SECRET) {
    return json({
      ok: false,
      error: "Missing environment variables",
      have: {
        LEARNWORLDS_BASE_URL: !!BASE,
        LEARNWORLDS_CLIENT_ID: !!CLIENT_ID,
        LEARNWORLDS_CLIENT_SECRET: !!CLIENT_SECRET,
      },
    }, 500);
  }

  // ---- 1. get a token -----------------------------------------
  let token = null;
  let tokenUrlUsed = null;

  for (const url of TOKEN_URLS) {
    try {
      const res = await fetch(url, {
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
      let body = null;
      try { body = JSON.parse(text); } catch (e) { /* not json */ }

      if (res.ok && body && (body.access_token || body.tokenData)) {
        token = body.access_token || (body.tokenData && body.tokenData.access_token);
        tokenUrlUsed = url;
        notes.push(`Token obtained from ${url}`);
        break;
      }
      notes.push(`${url} -> HTTP ${res.status}: ${clip(text)}`);
    } catch (err) {
      notes.push(`${url} -> request failed: ${clip(err.message)}`);
    }
  }

  if (!token) {
    return json({
      ok: false,
      step: "authentication",
      hint: "If both paths returned 401, the Client ID or Secret is wrong. " +
            "If both returned 404, the base URL is wrong.",
      notes,
    }, 502);
  }

  // ---- 2. list the courses ------------------------------------
  const headers = {
    Authorization: "Bearer " + token,
    "Lw-Client": CLIENT_ID,
    Accept: "application/json",
  };

  let courses = [];
  try {
    const res = await fetch(BASE + "/courses?items_per_page=100", { headers });
    const text = await res.text();
    if (!res.ok) {
      return json({
        ok: false,
        step: "listing courses",
        tokenUrlUsed,
        status: res.status,
        body: clip(text),
        notes,
      }, 502);
    }
    const body = JSON.parse(text);
    const rows = Array.isArray(body) ? body : (body.data || body.courses || []);
    courses = rows.map((c) => ({
      id: c.id || c.course_id || c.courseId || null,
      title: c.title || c.name || null,
      access: c.access || null,
    }));
  } catch (err) {
    return json({
      ok: false,
      step: "listing courses",
      tokenUrlUsed,
      error: clip(err.message),
      notes,
    }, 502);
  }

  return json({
    ok: true,
    tokenUrlUsed,
    courseCount: courses.length,
    courses,
    notes,
    reminder: "Delete netlify/functions/learnworlds-check.mjs once the product IDs are saved.",
  });
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
