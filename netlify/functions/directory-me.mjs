// netlify/functions/directory-me.mjs
//
// A coach's own listing in the trainer directory. Signed in with the
// Learn / directory login (Authorization: Bearer <token>).
//
// GET                                   -> { profile, status, courses, url }
// POST { action: "save", ...fields }    -> the same, after saving
// POST { action: "add_course", brand, level, kind, month, location, note }
// POST { action: "remove_course", id }  (only courses still waiting)
// POST { action: "delete" }             -> removes the listing entirely
//
// A listing is found by login, then by email — which is how a coach
// imported from Community Box, or set up by the office, picks up the
// profile that was already waiting for them.

import {
  db, json, OFFICE, SITE_URL, BRANDS, PROFILE_FIELDS, qualificationsFor, statusOf,
  uniqueSlug, userFrom, sendMail, esc, photoUrl, qualTitle,
} from "../lib/directory.mjs";

const MAX_PENDING_COURSES = 20;

export default async (req) => {
  const user = await userFrom(req);
  if (!user) return json({ error: "Please log in again." }, 401);
  const email = String(user.email || "").toLowerCase();

  try {
    let profile = await findProfile(user, email);

    if (req.method === "GET") return json(await view(profile, user));
    if (req.method !== "POST") return json({ error: "Use GET or POST" }, 405);

    const body = await req.json().catch(() => ({}));
    const action = body.action || "save";

    if (action === "save") {
      const res = await save(profile, user, email, body);
      if (res.error) return json(res, 400);
      profile = res.profile;
    } else if (action === "add_course") {
      if (!profile) return json({ error: "Save your profile first." }, 400);
      const res = await addCourses(profile, Array.isArray(body.courses) ? body.courses : [body]);
      if (res.error) return json(res, 400);
      await tellOffice(profile, res.added);
    } else if (action === "remove_course") {
      if (!profile) return json({ error: "No listing yet." }, 400);
      await db.from("directory_courses").delete()
        .eq("id", String(body.id || "")).eq("profile_id", profile.id).is("verified_at", null);
    } else if (action === "delete") {
      if (profile) {
        await removePhotos(user.id);
        await db.from("directory_profiles").delete().eq("id", profile.id);
      }
      return json(await view(null, user));
    } else {
      return json({ error: "Unknown action." }, 400);
    }

    return json(await view(await findProfile(user, email), user));
  } catch (err) {
    console.error("directory-me:", err.message || err);
    return json({ error: "Something went wrong. Try again, or write to " + OFFICE + "." }, 500);
  }
};

async function findProfile(user, email) {
  const { data: mine } = await db.from("directory_profiles").select(PROFILE_FIELDS)
    .eq("user_id", user.id).maybeSingle();
  if (mine) return mine;

  let { data: found } = await db.from("directory_profiles").select(PROFILE_FIELDS)
    .is("user_id", null).eq("email", email).maybeSingle();
  if (!found) {
    const { data: linked } = await db.from("directory_profiles").select(PROFILE_FIELDS)
      .is("user_id", null).contains("other_emails", [email]).limit(1);
    found = linked && linked[0];
  }
  if (!found) return null;
  const { data: claimed } = await db.from("directory_profiles")
    .update({ user_id: user.id }).eq("id", found.id).select(PROFILE_FIELDS).single();
  return claimed;
}

async function view(profile, user) {
  if (!profile) {
    // No listing yet: still show what they have done with us, so they
    // can see straight away whether they go live without waiting.
    const ghost = { id: "new", email: String(user.email || "").toLowerCase(), other_emails: [] };
    const quals = (await qualificationsFor([ghost])).get("new");
    const meta = user.user_metadata || {};
    return { profile: null, status: "none", courses: titled(quals), suggested_name: meta.full_name || meta.name || "" };
  }
  const quals = (await qualificationsFor([profile], { withPending: true })).get(profile.id);
  const verified = quals.filter((q) => q.verified);
  // for the Trainer Directory tab in BirdBox Learn: how many people asked
  // to work with them in the last 90 days (requests we passed on only)
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { count: contacts } = await db.from("directory_contact_requests")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profile.id).eq("status", "sent").gte("created_at", since);
  return {
    profile: {
      full_name: profile.full_name, headline: profile.headline, qualifications: profile.qualifications, bio: profile.bio,
      gym_name: profile.gym_name, city: profile.city, country: profile.country,
      latitude: profile.latitude, longitude: profile.longitude, location_approx: profile.location_approx,
      coaches_online: profile.coaches_online, instagram: profile.instagram, website: profile.website,
      public_email: profile.public_email, phone: profile.phone,
      facebook: profile.facebook, twitter: profile.twitter, linkedin: profile.linkedin,
      photo: photoUrl(profile.photo_path), photo_path: profile.photo_path,
      visible: profile.visible, slug: profile.slug, review_note: profile.rejected_at ? profile.review_note : null,
    },
    status: statusOf(profile, verified),
    courses: titled(quals),
    contacts_90: contacts || 0,
    url: `${SITE_URL}/trainer-directory/coach/${encodeURIComponent(profile.slug)}`,
  };
}

const titled = (list) => (list || []).map((q) => ({ ...q, title: qualTitle(q) }));

const clean = (v, max) => {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

function cleanUrl(v) {
  let s = clean(v, 200);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u.toString() : null; }
  catch (e) { return null; }
}

function cleanInstagram(v) {
  const s = clean(v, 100);
  if (!s) return null;
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const handle = (m ? m[1] : s).replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

async function save(profile, user, email, b) {
  const full_name = clean(b.full_name, 80);
  if (!full_name || full_name.length < 3) return { error: "Add your full name." };
  const bio = b.bio == null ? null : String(b.bio).replace(/\r/g, "").trim().slice(0, 2000) || null;
  const public_email = clean(b.public_email, 254);
  if (public_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(public_email)) return { error: "That contact email does not look right." };
  if (b.website && !cleanUrl(b.website)) return { error: "That website address does not look right." };
  if (b.instagram && !cleanInstagram(b.instagram)) return { error: "Add your Instagram handle, like @birdboxcoaching." };
  for (const k of ["facebook", "twitter", "linkedin"]) {
    if (b[k] && !cleanUrl(b[k])) return { error: `That ${k === "twitter" ? "X / Twitter" : k[0].toUpperCase() + k.slice(1)} link does not look right.` };
  }

  const lat = Number(b.latitude), lng = Number(b.longitude);
  const hasPoint = b.latitude != null && b.latitude !== "" && Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  // A photo is uploaded straight to storage by the page, into the
  // coach's own folder; only a path inside that folder is accepted.
  let photo_path = profile ? profile.photo_path : null;
  if (b.photo_path === null || b.photo_path === "") photo_path = null;
  else if (typeof b.photo_path === "string" && b.photo_path.startsWith(user.id + "/") && !b.photo_path.includes("..")) photo_path = b.photo_path;

  const fields = {
    full_name,
    headline: clean(b.headline, 90),
    qualifications: clean(b.qualifications, 160),
    bio,
    gym_name: clean(b.gym_name, 90),
    city: clean(b.city, 80),
    country: clean(b.country, 60),
    latitude: hasPoint ? lat : null,
    longitude: hasPoint ? lng : null,
    // A pin the coach chose themselves replaces one we worked out for
    // them; saving other changes leaves a rough pin marked as rough.
    location_approx: !!(profile && profile.location_approx &&
      Number(profile.latitude) === lat && Number(profile.longitude) === lng),
    coaches_online: !!b.coaches_online,
    instagram: cleanInstagram(b.instagram),
    website: cleanUrl(b.website),
    public_email,
    phone: clean(b.phone, 40),
    facebook: cleanUrl(b.facebook),
    twitter: cleanUrl(b.twitter),
    linkedin: cleanUrl(b.linkedin),
    photo_path,
    visible: b.visible !== false,
    updated_at: new Date().toISOString(),
  };
  // Every coach has a pin on the map, online coaches included (theirs is
  // where they are based).
  if (!hasPoint) return { error: "Search for your gym or town and pick it from the list, so you show on the map." };

  let saved;
  if (profile) {
    if (fields.full_name !== profile.full_name && profile.source === "self" && !profile.approved_at) {
      fields.slug = await uniqueSlug(fields.full_name, profile.id);
    }
    // Changing anything after a "not this time" puts it back in the queue.
    if (profile.rejected_at) { fields.rejected_at = null; fields.submitted_at = null; }
    const { data, error } = await db.from("directory_profiles").update(fields).eq("id", profile.id)
      .select(PROFILE_FIELDS).single();
    if (error) throw error;
    saved = data;
  } else {
    const { data, error } = await db.from("directory_profiles").insert({
      ...fields, user_id: user.id, email, slug: await uniqueSlug(full_name), source: "self",
    }).select(PROFILE_FIELDS).single();
    if (error) throw error;
    saved = data;
  }

  // Courses ticked on the same form go in with the listing, so the office
  // gets one email about everything rather than one per step.
  let added = 0;
  if (Array.isArray(b.courses) && b.courses.length) {
    const res = await addCourses(saved, b.courses);
    if (res.error) return { error: res.error + " Your details were saved." , profile: saved };
    added = res.added;
  }
  await tellOffice(saved, added);
  return { profile: saved };
}

// The courses a coach can ask us to check. Level 2 is in person only (the
// TCC Level 2 online course comes with the seminar). The Endurance and
// Weightlifting Courses are added here once they have graduates.
const COURSES = {
  "tcc1": { brand: "tcc", level: "1", kind: "seminar" },
  "tcc1-online": { brand: "tcc", level: "1", kind: "online" },
  "tcc2": { brand: "tcc", level: "2", kind: "seminar" },
  "tgc1": { brand: "tgc", level: "1", kind: "seminar" },
  "tgc1-online": { brand: "tgc", level: "1", kind: "online" },
  "tgc2": { brand: "tgc", level: "2", kind: "seminar" },
};

function parseCourse(c) {
  // Accepts { code } from the tick-list, or the older { brand, kind, level }.
  let def = COURSES[String(c.code || "")];
  if (!def) {
    const brand = String(c.brand || "").toLowerCase();
    const kind = ["seminar", "online"].includes(c.kind) ? c.kind : "seminar";
    const level = (String(c.level || "").match(/\d/) || [null])[0];
    def = Object.values(COURSES).find((d) => d.brand === brand && d.kind === kind && d.level === level);
  }
  if (!def) return { error: "One of those courses is not one we can check." };
  const m = String(c.month || "").match(/^(\d{4})-(\d{2})$/);
  if (!m || +m[1] < 2010 || +m[2] < 1 || +m[2] > 12) return { error: "Add the month and year for each course you ticked." };
  const course_month = `${m[1]}-${m[2]}-01`;
  if (new Date(course_month) > new Date()) return { error: "One of those dates is in the future." };
  // Online courses have no place.
  return { row: { ...def, course_month, location: def.kind === "online" ? null : clean(c.location, 120), note: clean(c.note, 300) } };
}

// Adds courses for the office to check. A course already on the listing
// (checked or waiting) is not added twice.
async function addCourses(profile, list) {
  const rows = [];
  for (const c of list.slice(0, 12)) {
    const r = parseCourse(c);
    if (r.error) return r;
    rows.push(r.row);
  }
  if (!rows.length) return { added: 0 };

  const quals = (await qualificationsFor([profile], { withPending: true })).get(profile.id);
  const have = new Set(quals.map((q) => `${q.brand}|${q.level || ""}|${q.kind}`));
  const fresh = rows.filter((r) => !have.has(`${r.brand}|${r.level || ""}|${r.kind}`));
  if (!fresh.length) return { added: 0 };

  const waiting = quals.filter((q) => !q.verified).length;
  if (waiting + fresh.length > MAX_PENDING_COURSES) return { error: "That is a lot waiting already. We will check those first." };

  const { error } = await db.from("directory_courses").insert(fresh.map((r) => ({ ...r, profile_id: profile.id })));
  if (error) throw error;
  await db.from("directory_profiles").update({ seen_at: null }).eq("id", profile.id);
  return { added: fresh.length };
}

// One email to the office when something needs checking: a new coach
// with no certificate from us, or courses added to any listing.
async function tellOffice(profile, newCourses = 0) {
  const quals = (await qualificationsFor([profile], { withPending: true })).get(profile.id);
  const status = statusOf(profile, quals.filter((q) => q.verified));
  const firstSubmit = status === "pending" && !profile.submitted_at;
  if (!firstSubmit && !newCourses) return;
  if (firstSubmit) {
    await db.from("directory_profiles").update({ submitted_at: new Date().toISOString(), seen_at: null }).eq("id", profile.id);
  }

  const waiting = quals.filter((q) => !q.verified);
  const lines = waiting.map((q) => `- ${q.title}${q.kind === "seminar" ? " (in person)" : ""}${q.date ? ", " + String(q.date).slice(0, 7) : ""}${q.place ? ", " + q.place : ""}${q.note ? " (" + q.note + ")" : ""}`);
  const link = `${SITE_URL}/portal/directory/`;
  const what = firstSubmit
    ? `${profile.full_name} has asked to join the Trainer Directory. We have no certificate on file for them, so they will not show until you approve them.`
    : `${profile.full_name} has added ${newCourses === 1 ? "a course" : newCourses + " courses"} for us to check. ${newCourses === 1 ? "It does" : "They do"} not show on their listing until you verify ${newCourses === 1 ? "it" : "them"}.`;

  await sendMail({
    to: OFFICE,
    subject: `Trainer Directory: ${profile.full_name} needs checking`,
    text: `${what}\n\nCourses waiting to be checked:\n${lines.join("\n") || "- none added yet"}\n\nCheck them here:\n${link}`,
    html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#16181b;max-width:560px">
<p>${esc(what)}</p>
<p><strong>Courses waiting to be checked:</strong></p>
<ul>${waiting.map((q, i) => `<li>${esc(lines[i].slice(2))}</li>`).join("") || "<li>None added yet</li>"}</ul>
<p><a href="${link}">Open the directory queue</a></p>
</div>`,
  });
}

async function removePhotos(uid) {
  const { data } = await db.storage.from("directory").list(uid);
  if (data && data.length) await db.storage.from("directory").remove(data.map((f) => `${uid}/${f.name}`));
}
