// netlify/functions/directory-admin.mjs
//
// The office side of the trainer directory, for /portal/directory/.
// Admins only.
//
// GET                                         -> { coaches: [...] }
// POST { action: "approve", id }              coach with no certificate goes live,
//                                             and every course they listed is verified
// POST { action: "reject", id, note }         not listed; the coach is told why
// POST { action: "verify_course", course_id } one older course now counts
// POST { action: "drop_course", course_id }   remove a course that cannot be confirmed
// POST { action: "hide" | "unhide", id }      take a live listing down, or put it back
// POST { action: "link_emails", id, emails }  other addresses their certificates are under
// POST { action: "add", coach }               one coach set up by hand
// POST { action: "import", rows }             the Community Box export, many at once
// POST { action: "delete", id }
// POST { action: "seen" }                     clears the "new" marks

import {
  db, json, SITE_URL, BRANDS, PROFILE_FIELDS, qualificationsFor, statusOf, uniqueSlug,
  userFrom, sendMail, esc, photoUrl,
} from "../lib/directory.mjs";
import { emailCoach } from "./directory-contact.mjs";

export default async (req) => {
  const user = await userFrom(req);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const { data: staff } = await db.from("staff").select("id, role, active").eq("id", user.id).maybeSingle();
  if (!staff || !staff.active || staff.role !== "admin") return json({ error: "Admins only." }, 403);

  try {
    if (req.method === "GET") return json({ ...(await everything()) });
    if (req.method !== "POST") return json({ error: "Use GET or POST" }, 405);

    const b = await req.json().catch(() => ({}));
    const now = new Date().toISOString();
    const one = async (id) => {
      const { data } = await db.from("directory_profiles").select(PROFILE_FIELDS).eq("id", String(id || "")).maybeSingle();
      return data;
    };

    switch (b.action) {
      case "approve": {
        const p = await one(b.id);
        if (!p) return json({ error: "Not found." }, 404);
        const before = statusOf(p, (await qualificationsFor([p])).get(p.id));
        await db.from("directory_profiles").update({ approved_at: now, approved_by: user.id, rejected_at: null, review_note: null }).eq("id", p.id);
        await db.from("directory_courses").update({ verified_at: now, verified_by: user.id }).eq("profile_id", p.id).is("verified_at", null);
        // Only news worth an email if this is what puts them live.
        if (before === "pending" || before === "rejected") await tellCoach(p, "approved");
        break;
      }
      case "reject": {
        const p = await one(b.id);
        if (!p) return json({ error: "Not found." }, 404);
        const note = String(b.note || "").trim().slice(0, 600) || null;
        await db.from("directory_profiles").update({ rejected_at: now, review_note: note }).eq("id", p.id);
        await tellCoach(p, "rejected", note);
        break;
      }
      case "verify_course":
        await db.from("directory_courses").update({ verified_at: now, verified_by: user.id }).eq("id", String(b.course_id || ""));
        break;
      case "drop_course":
        await db.from("directory_courses").delete().eq("id", String(b.course_id || ""));
        break;
      case "hide":
        await db.from("directory_profiles").update({ hidden_at: now }).eq("id", String(b.id || ""));
        break;
      case "unhide":
        await db.from("directory_profiles").update({ hidden_at: null }).eq("id", String(b.id || ""));
        break;
      case "link_emails": {
        const emails = [...new Set(String(b.emails || "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase())
          .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))].slice(0, 10);
        await db.from("directory_profiles").update({ other_emails: emails }).eq("id", String(b.id || ""));
        break;
      }
      case "add": {
        const res = await addOne(b.coach || {}, "admin", user.id);
        if (res.error) return json(res, 400);
        break;
      }
      case "import": {
        const rows = Array.isArray(b.rows) ? b.rows.slice(0, 2000) : [];
        let added = 0, skipped = 0;
        const problems = [];
        for (const r of rows) {
          const res = await addOne(r, "community_box", user.id);
          if (res.error) { skipped++; if (problems.length < 20) problems.push(`${r.email || r.full_name || "?"}: ${res.error}`); }
          else added++;
        }
        return json({ added, skipped, problems, ...(await everything()) });
      }
      case "delete": {
        const p = await one(b.id);
        if (p) {
          if (p.user_id) {
            const { data: files } = await db.storage.from("directory").list(p.user_id);
            if (files && files.length) await db.storage.from("directory").remove(files.map((f) => `${p.user_id}/${f.name}`));
          }
          await db.from("directory_profiles").delete().eq("id", p.id);
        }
        break;
      }
      case "geocode_missing":
        return json({ ...(await geocodeMissing()), ...(await everything()) });
      case "release_request": {
        const { data: r } = await db.from("directory_contact_requests")
          .select("id, profile_id, name, email, phone, looking_for, message, status").eq("id", String(b.request_id || "")).maybeSingle();
        if (!r) return json({ error: "Not found." }, 404);
        const { data: p } = await db.from("directory_profiles").select(PROFILE_FIELDS).eq("id", r.profile_id).maybeSingle();
        if (!p) return json({ error: "That coach is no longer listed." }, 404);
        const sent = await emailCoach(p, r.id, { name: r.name, email: r.email, phone: r.phone, lookingFor: LOOKING_LABEL[r.looking_for] || "—", message: r.message });
        if (!sent) return json({ error: "The email did not go. Try again." }, 502);
        await db.from("directory_contact_requests").update({ status: "released", emailed: true, reviewed_at: now, reviewed_by: user.id }).eq("id", r.id);
        break;
      }
      case "spam_request": {
        const { data: r } = await db.from("directory_contact_requests").select("id, email, ip_hash").eq("id", String(b.request_id || "")).maybeSingle();
        if (r) {
          await db.from("directory_contact_requests").update({ status: "spam", reviewed_at: now, reviewed_by: user.id }).eq("id", r.id);
          await db.from("directory_blocked_senders").insert({ email: r.email, ip_hash: r.ip_hash, reason: "Blocked by the office" });
        }
        break;
      }
      case "delete_request":
        await db.from("directory_contact_requests").delete().eq("id", String(b.request_id || ""));
        break;
      case "seen":
        await db.from("directory_profiles").update({ seen_at: now }).is("seen_at", null);
        break;
      default:
        return json({ error: "Unknown action." }, 400);
    }
    return json({ ...(await everything()) });
  } catch (err) {
    console.error("directory-admin:", err.message || err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

const LOOKING_LABEL = {
  personal: "Coaching for myself", online: "Online coaching", gym: "Coaching or education for my gym or team",
  seminar: "A seminar or workshop", other: "Something else",
};

async function everything() {
  const [coaches, requests] = await Promise.all([listAll(), listRequests()]);
  return { coaches, requests };
}

// Messages held back from coaches, and the last 30 days of everything
// else, so the office can see the screening is doing the right thing.
async function listRequests() {
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  const { data } = await db.from("directory_contact_requests")
    .select("id, profile_id, name, email, phone, looking_for, message, status, hold_reason, emailed, created_at, directory_profiles(full_name, slug)")
    .or(`status.eq.held,created_at.gte.${since}`)
    .order("created_at", { ascending: false }).limit(500);
  return (data || []).map((r) => ({
    ...r, coach: r.directory_profiles?.full_name || "", slug: r.directory_profiles?.slug || "",
    looking_for_label: LOOKING_LABEL[r.looking_for] || null,
  }));
}

async function listAll() {
  const { data, error } = await db.from("directory_profiles").select(PROFILE_FIELDS)
    .order("created_at", { ascending: false }).limit(5000);
  if (error) throw error;
  const profiles = data || [];
  const quals = await qualificationsFor(profiles, { withPending: true });
  return profiles.map((p) => {
    const q = quals.get(p.id);
    return {
      ...p,
      photo: photoUrl(p.photo_path),
      status: statusOf(p, q.filter((x) => x.verified)),
      courses: q,
      waiting: q.filter((x) => !x.verified).length,
    };
  });
}

// A coach added by the office, one at a time or from the Community Box
// export. Either way they were already vouched for, so they go live as
// soon as they have a location. When they later log in with this email
// they take over the listing (see directory-me).
async function addOne(r, source, by) {
  const email = String(r.email || "").trim().toLowerCase();
  const full_name = String(r.full_name || r.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "no valid email" };
  if (full_name.length < 2) return { error: "no name" };

  const { data: exists } = await db.from("directory_profiles").select("id").eq("email", email).maybeSingle();
  if (exists) return { error: "already in the directory" };
  if (r.cb_key) {
    const { data: same } = await db.from("directory_profiles").select("id").eq("cb_key", String(r.cb_key)).maybeSingle();
    if (same) return { error: "already imported" };
  }

  const t = (v, n) => { const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim(); return s ? s.slice(0, n) : null; };
  const lat = Number(r.latitude), lng = Number(r.longitude);
  const hasPoint = r.latitude != null && r.latitude !== "" && Number.isFinite(lat) && Number.isFinite(lng);
  const others = [...new Set((Array.isArray(r.other_emails) ? r.other_emails : [])
    .map((e) => String(e).trim().toLowerCase()).filter((e) => e !== email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))].slice(0, 10);

  const { data: p, error } = await db.from("directory_profiles").insert({
    email, other_emails: others, full_name, slug: await uniqueSlug(full_name), source,
    approved_at: new Date().toISOString(), approved_by: by,
    headline: t(r.headline, 90), bio: r.bio ? String(r.bio).replace(/\r/g, "").trim().slice(0, 2000) : null,
    gym_name: t(r.gym_name || r.gym, 90), city: t(r.city, 80), country: t(r.country, 60),
    latitude: hasPoint ? lat : null, longitude: hasPoint ? lng : null,
    coaches_online: /^(1|y|yes|true)$/i.test(String(r.coaches_online || r.online || "")),
    instagram: instagramHandle(r.instagram), website: linkUrl(r.website),
    facebook: linkUrl(r.facebook, "facebook.com/"), twitter: linkUrl(r.twitter, "x.com/"), linkedin: linkUrl(r.linkedin, "linkedin.com/in/"),
    phone: t(r.phone, 40), public_email: t(r.public_email, 254), cb_key: r.cb_key ? String(r.cb_key) : null,
    seen_at: new Date().toISOString(),
  }).select("id").single();
  if (error) return { error: error.message };

  // The photo is copied into our own storage, so nothing depends on
  // Community Box once the subscription ends. Only from Community Box's
  // own image address, so this cannot be pointed at anything else.
  if (r.photo_url && /^https:\/\/dashboard\.communitybox\.co\/img\/uploaded\/[\w-]+\.jpe?g$/.test(r.photo_url)) {
    try {
      const res = await fetch(r.photo_url);
      const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      if (bytes && bytes.length > 500 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        const path = `imported/${p.id}.jpg`;
        const { error: upErr } = await db.storage.from("directory").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
        if (!upErr) await db.from("directory_profiles").update({ photo_path: path }).eq("id", p.id);
        else console.warn("photo upload failed", p.id, upErr.message);
      }
    } catch (e) { console.warn("photo copy failed", p.id, e.message); }
  }

  // Courses can come in as "tgc1, tcc2, tgc-workshop, tcc1-online",
  // verified because the office is the one adding them.
  const codes = String(r.courses || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
  const courseRows = [];
  const seen = new Set();
  for (const code of codes) {
    const m = code.match(/^(tcc|tgc|tec|twc|birdbox)-?(\d|workshop|w)?(-?online)?$/);
    if (!m || !BRANDS[m[1]] || seen.has(code)) continue;
    seen.add(code);
    const workshop = m[2] === "workshop" || m[2] === "w";
    courseRows.push({
      profile_id: p.id, brand: m[1], level: workshop ? null : (m[2] || "1"),
      kind: workshop ? "workshop" : m[3] ? "online" : "seminar",
      verified_at: new Date().toISOString(), verified_by: by,
      note: source === "community_box" ? "Listed on the old directory" : "Added by the office",
    });
  }
  if (courseRows.length) await db.from("directory_courses").insert(courseRows);
  return { id: p.id };
}

// People typed all sorts into these fields on the old directory: full
// URLs, @handles, bare domains, "see Instagram". Anything that is not
// clearly a link is dropped rather than shown broken.
function instagramHandle(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const h = (m ? m[1] : s).replace(/^@/, "").replace(/\/$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : null;
}

function linkUrl(v, base) {
  let s = String(v || "").trim();
  if (!s || /\s/.test(s)) return null;
  if (base && /^@?[A-Za-z0-9._-]{2,60}$/.test(s) && !s.includes(".")) s = base + s.replace(/^@/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) && /\.[a-z]{2,}$/i.test(u.hostname) ? u.toString().slice(0, 300) : null;
  } catch (e) { return null; }
}

// Map positions for coaches who have a city but no coordinates, a few
// per call: OpenStreetMap's lookup asks for no more than one a second.
// One that cannot be found moves to the back of the line, so it does
// not block the rest.
const GEOCODE_CONTACT = process.env.GEOCODE_CONTACT || "info@birdboxcoaching.com";

async function geocodeMissing() {
  const { data } = await db.from("directory_profiles").select("id, city, country")
    .is("latitude", null).or("city.not.is.null,country.not.is.null")
    .order("updated_at", { ascending: true }).limit(12);
  let placed = 0;
  for (const p of data || []) {
    const q = [p.city, p.country].filter(Boolean).join(", ");
    let hit = null;
    try {
      const res = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&accept-language=en&q=" + encodeURIComponent(q), {
        headers: { "User-Agent": `BirdBoxCoaching/1.0 (${GEOCODE_CONTACT})`, Accept: "application/json" },
      });
      if (res.ok) hit = (await res.json())[0] || null;
    } catch (e) { console.warn("geocode failed for", q, e.message); }
    const patch = { updated_at: new Date().toISOString() };
    if (hit) {
      patch.latitude = Number(hit.lat); patch.longitude = Number(hit.lon);
      const a = hit.address || {};
      if (!p.country && a.country) patch.country = a.country;
      placed++;
    }
    await db.from("directory_profiles").update(patch).eq("id", p.id);
    await new Promise((r) => setTimeout(r, 1100));
  }
  const { count } = await db.from("directory_profiles").select("id", { count: "exact", head: true })
    .is("latitude", null).or("city.not.is.null,country.not.is.null");
  return { placed, left: count || 0 };
}

async function tellCoach(p, outcome, note) {
  const first = String(p.full_name || "").split(" ")[0] || "there";
  const url = `${SITE_URL}/trainer-directory/coach/${encodeURIComponent(p.slug)}`;
  const me = `${SITE_URL}/learn/directory/`;
  const approved = outcome === "approved";
  const body = approved
    ? [`Good news: we have checked your courses and your listing is now live in the BirdBox Trainer Directory.`,
       `See it here: ${url}`,
       `You can change your photo, gym or details any time at ${me}`]
    : [`Thank you for asking to join the BirdBox Trainer Directory. We could not confirm your course from what we have on record, so your listing is not showing yet.`,
       ...(note ? [`From the team: ${note}`] : []),
       `If you can, reply to this email with your certificate or the date and place you did the course, and we will look again. You can also update your listing at ${me}`];
  await sendMail({
    to: p.email,
    subject: approved ? "You are live in the BirdBox Trainer Directory" : "Your BirdBox Trainer Directory listing",
    text: `Hi ${first},\n\n${body.join("\n\n")}\n\nBirdBox Coaching`,
    html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#16181b;max-width:560px">
<p>Hi ${esc(first)},</p>${body.map((x) => `<p>${esc(x)}</p>`).join("")}<p>BirdBox Coaching</p></div>`,
  });
}
