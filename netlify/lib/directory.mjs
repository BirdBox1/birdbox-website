// netlify/lib/directory.mjs
//
// Shared by the trainer directory functions: directory-public (the
// listing everyone sees), directory-me (a coach editing their own
// listing) and directory-admin (the office approving and hiding).
//
// A coach's qualifications are never typed in by the coach. They are
// read from the certificates we issued, through the
// directory_qualifications view, matched on email. Courses from before
// our records began (August 2026) can be added by the coach, but only
// count once the office has verified them.
//
// Who shows up:
//   - has a certificate from us          -> live straight away
//   - imported from Community Box        -> live (they were listed before)
//   - only older, self-reported courses  -> waits for the office to approve
// and in every case only while the coach has "show me" on and the office
// has not hidden them.

import { createClient } from "@supabase/supabase-js";

export const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const OFFICE = "info@birdboxcoaching.com";
export const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
export const SITE_URL = (process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app").replace(/\/+$/, "");

export const BRANDS = {
  // Coaches who did it before the rename know it as BirdBox Coaching
  // Development, so that name stays visible wherever it is listed.
  tcc: { name: "The Coaches Course", short: "TCC", tagline: "Formerly BirdBox Coaching Development" },
  tgc: { name: "The Gymnastics Course", short: "TGC" },
  tec: { name: "The Endurance Course", short: "TEC" },
  twc: { name: "The Weightlifting Course", short: "TWC" },
  birdbox: { name: "BirdBox Coaching", short: "BirdBox" },
};

// Courses that are on sale and can appear on a listing. The Weightlifting
// Course is not released yet, so it is never shown, whatever the data
// says; add "twc" here on the day it launches.
export const RELEASED = new Set(["tcc", "tgc", "tec", "birdbox"]);

export const PROFILE_FIELDS =
  "id, user_id, email, other_emails, slug, full_name, headline, bio, gym_name, city, country, " +
  "latitude, longitude, coaches_online, instagram, website, public_email, photo_path, visible, " +
  "source, submitted_at, approved_at, rejected_at, review_note, hidden_at, seen_at, created_at, updated_at, " +
  "phone, facebook, twitter, linkedin, cb_key, location_approx";

export function photoUrl(path) {
  if (!path) return null;
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/directory/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function json(body, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": cache },
  });
}

// "The Gymnastics Course — Level 2", "TGC Workshop — Handstands",
// "The Coaches Course — Level 1 Online".
export function qualTitle(q) {
  const b = BRANDS[q.brand] || BRANDS.birdbox;
  // Short online courses (behaviour change, mental health and the like)
  // are known by their own name, not a brand and level.
  if (q.course_title && !["tcc", "tgc", "tec", "twc"].includes(q.brand)) return q.course_title;
  if (q.kind === "workshop") return `${b.short} Workshop${q.focus ? " — " + q.focus : ""}`;
  return b.name + (q.level ? ` — Level ${q.level}` : "") + (q.kind === "online" ? " Online" : "");
}

// All emails a profile answers to: its login email and any the office
// has linked (a coach who did a course under a work address, say).
function emailsOf(p) {
  return [p.email, ...(p.other_emails || [])].map((e) => String(e || "").trim().toLowerCase()).filter(Boolean);
}

// Qualifications for a set of profiles, as a Map of profile id -> list,
// newest first. Certificates are always verified; older courses only
// appear when verified, unless withPending is asked for (the coach's own
// page and the office's queue show them with a "waiting" mark).
export async function qualificationsFor(profiles, { withPending = false } = {}) {
  const out = new Map(profiles.map((p) => [p.id, []]));
  if (!profiles.length) return out;

  const byEmail = new Map();
  for (const p of profiles) for (const e of emailsOf(p)) {
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e).push(p.id);
  }

  // For a handful of profiles, ask for just their rows. For the whole
  // directory, read both tables in full and in parallel: two big reads are
  // much quicker than a dozen filtered ones, and the tables are small.
  const emails = [...byEmail.keys()];
  // A coach with no listing yet is looked up with a stand-in id, which has
  // no past courses and is not a real id to search for.
  const ids = profiles.map((p) => p.id).filter((id) => /^[0-9a-f-]{36}$/.test(id));
  const many = profiles.length > 50;
  const quals = () => db.from("directory_qualifications").select("email, brand, level, kind, focus, awarded_on, place, course_title");
  const past = () => {
    let q = db.from("directory_courses").select("id, profile_id, brand, level, kind, course_month, location, note, verified_at");
    if (!withPending) q = q.not("verified_at", "is", null);
    return q;
  };
  const [qualRows, pastRows] = await Promise.all([
    many ? readAll(quals) : chunked(emails, (part) => quals().in("email", part)),
    many ? readAll(past) : chunked(ids, (part) => past().in("profile_id", part)),
  ]);

  for (const q of qualRows) {
    for (const id of byEmail.get(q.email) || []) {
      out.get(id).push({
        brand: q.brand, level: q.level, kind: q.kind, focus: q.focus || null,
        course_title: q.course_title || null,
        date: q.awarded_on, place: q.place, verified: "certificate",
      });
    }
  }
  for (const c of pastRows) {
    const list = out.get(c.profile_id);
    if (!list) continue;
    list.push({
      id: c.id, brand: c.brand, level: c.level, kind: c.kind, focus: null,
      date: c.course_month, place: c.location, note: c.note,
      verified: c.verified_at ? "office" : null,
    });
  }

  for (const [id, all] of out) {
    const list = all.filter((q) => RELEASED.has(q.brand));
    // One line per course: the same course can arrive twice (a
    // certificate and an old Academy completion, or a claim the office
    // has since matched to a certificate).
    const seen = new Set();
    const unique = [];
    list.sort((a, b) => (b.verified === "certificate") - (a.verified === "certificate"));
    for (const q of list) {
      const key = [q.brand, q.level || "", q.kind, q.focus || "", qualTitle(q), q.verified ? "" : q.id].join("|");
      if (q.verified && seen.has(key)) continue;
      seen.add(key);
      unique.push({ ...q, title: qualTitle(q) });
    }
    unique.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    out.set(id, unique);
  }
  return out;
}

// Every row of a query, a page at a time (the database hands back at most
// 1,000 rows per request).
async function readAll(make) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw new Error("Could not read the directory: " + error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function chunked(values, make) {
  const rows = [];
  for (let i = 0; i < values.length; i += 200) {
    const { data, error } = await make(values.slice(i, i + 200));
    if (error) throw new Error("Could not read the directory: " + error.message);
    rows.push(...(data || []));
  }
  return rows;
}

export function hasCertificate(quals) {
  return quals.some((q) => q.verified === "certificate");
}

// Live, waiting for the office, or not showing — and why.
export function statusOf(p, quals) {
  if (p.hidden_at) return "hidden";
  if (!p.visible) return "off";
  if (hasCertificate(quals) || p.approved_at || p.source !== "self") return "live";
  if (p.rejected_at) return "rejected";
  return "pending";
}

// What the public sees. No email, no phone, no internal notes.
export function publicProfile(p, quals) {
  return {
    slug: p.slug,
    name: p.full_name,
    headline: p.headline || null,
    bio: p.bio || null,
    gym: p.gym_name || null,
    city: p.city || null,
    country: p.country || null,
    lat: p.latitude == null ? null : Number(p.latitude),
    lng: p.longitude == null ? null : Number(p.longitude),
    online: !!p.coaches_online,
    instagram: p.instagram || null,
    website: p.website || null,
    facebook: p.facebook || null,
    twitter: p.twitter || null,
    linkedin: p.linkedin || null,
    // No email or phone: visitors send a contact request instead, which
    // is emailed to the coach (see directory-contact).
    photo: photoUrl(p.photo_path),
    courses: quals.filter((q) => q.verified).map((q) => ({
      brand: q.brand, level: q.level, kind: q.kind, title: q.title,
      tagline: (BRANDS[q.brand] || {}).tagline || null,
      date: q.date ? String(q.date).slice(0, 7) : null, place: q.place || null, verified: q.verified,
    })),
  };
}

export function slugify(s) {
  return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "coach";
}

export async function uniqueSlug(name, exceptId) {
  const base = slugify(name);
  for (let n = 1; n < 200; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const { data } = await db.from("directory_profiles").select("id").eq("slug", slug).maybeSingle();
    if (!data || data.id === exceptId) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// The signed-in person behind a request, from the Bearer token.
export async function userFrom(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function sendMail({ to, subject, text, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("No Resend key; email not sent to", to, subject); return false; }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox Coaching <${FROM}>`, to: [to], reply_to: replyTo || OFFICE, subject, text, html,
      }),
    });
    if (!res.ok) { console.error("Resend rejected", subject, "to", to, await res.text()); return false; }
    return true;
  } catch (err) {
    console.error("Could not send", subject, "to", to, err.message);
    return false;
  }
}

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// The few lines added to every certificate email, in person and online.
export function directoryInvite() {
  const link = `${SITE_URL}/learn/directory/`;
  return {
    text:
`GET LISTED IN THE TRAINER DIRECTORY

This course now shows on your profile in the BirdBox Trainer Directory, where athletes and gyms look for coaches. Add your photo, gym and location and your listing goes live straight away:
${link}`,
    html: `<p style="margin:26px 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#16181b">Get listed in the Trainer Directory</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#16181b">This course now shows on your profile in the BirdBox Trainer Directory, where athletes and gyms look for coaches. Add your photo, gym and location and your listing goes live straight away.</p>
<p style="margin:0 0 16px"><a href="${link}" style="display:inline-block;background:#4FA8DE;color:#0C1116;text-decoration:none;font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:13px;padding:12px 22px">Create my listing</a></p>`,
  };
}
