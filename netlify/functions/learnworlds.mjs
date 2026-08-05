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
// The enrolment body accepts EXACTLY five keys — productId,
// productType, justification, price, send_enrollment_email. A sixth
// is rejected with a 422.

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

    let userId = await findUser(email);
    const created = !userId;
    if (!userId) userId = await createUser({ email, firstName, lastName });

    // A brand new account already gets LearnWorlds' password email,
    // and setting a password triggers a confirmation after it — so a
    // third email naming the course is noise, and lands before they
    // can even log in.
    //
    // An account that already exists gets neither of those, so the
    // enrolment email is the only thing that tells them a new course
    // has appeared. That covers repeat customers and every manual
    // grant made from the portal.
    const res = await call("POST", `/users/${encodeURIComponent(userId)}/enrollment`, {
      productId: product.product_id,
      productType: product.product_type || "course",
      justification: justification || "Included free with the live seminar",
      price: 0,
      send_enrollment_email: !created,
    });

    if (!res.ok) {
      return {
        status: "failed",
        userId,
        productId: product.product_id,
        error: `Enrolment rejected (${res.status}): ${String(res.text || "").slice(0, 200)}`,
      };
    }

    return {
      status: "enrolled",
      userId,
      userWasCreated: created,
      productId: product.product_id,
      label: product.label || language,
    };
  } catch (err) {
    return { status: "failed", error: String(err.message || err).slice(0, 300) };
  }
}
