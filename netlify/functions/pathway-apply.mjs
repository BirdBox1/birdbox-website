// netlify/functions/pathway-apply.mjs
//
// GET  ?brand=tgc  -> { movements, tracks, regions, languages, price }
// POST { brand, full_name, email, ... , company?, t } -> { ok: true }
//
// The application form for the Staff Pathway (/tgc/staff-pathway/).
// Applying is free. Every application is saved for Nathan to review in the portal (Staff Pathway); the applicant gets a copy of
// what they sent, and the office is told a new one is in.
//
// The coaching video is a link (YouTube unlisted, Vimeo, Google Drive,
// Dropbox): 10 to 20 minutes from a phone is too big to upload. Each
// movement video is a link or an upload, and the CV and coaching
// philosophy are uploads. Uploads go through pathway-upload, and only
// paths it handed out are accepted here.
//
// One open application per person. Someone who was not accepted can
// apply again after REAPPLY_MONTHS.

import { createHash } from "node:crypto";
import { db, json, OFFICE, SITE_URL, sendMail, esc } from "../lib/directory.mjs";
import { MOVEMENTS, BUCKET, COURSES, TRACKS, REGIONS, LANGUAGES, PRICE, OPEN, reapplyFrom } from "../lib/pathway.mjs";

const EMAIL_RE = /^[^@\s,"'()]+@[^@\s,"'()]+\.[^@\s,"'()]+$/;
const URL_RE = /^https:\/\/[^\s<>"]+\.[^\s<>"]+$/i;
const BRAND_NAME = { tgc: "The Gymnastics Course" };

const text = (v, max) => String(v == null ? "" : v).replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max);
const link = (v) => { const s = text(v, 500); return URL_RE.test(s) ? s : null; };
const filePath = (v, kind) => { const s = String(v || ""); return new RegExp(`^\\d{4}-\\d{2}/${kind}/[0-9a-f-]{36}\\.[a-z0-9]{2,4}$`).test(s) ? s : null; };

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const brand = url.searchParams.get("brand") || "tgc";
    if (!MOVEMENTS[brand]) return json({ error: "Applications are not open for that course yet." }, 404);
    return json({ movements: MOVEMENTS[brand], courses: COURSES, tracks: TRACKS, regions: REGIONS, languages: LANGUAGES, price: PRICE }, 200, "public, max-age=300");
  }
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const b = await req.json().catch(() => ({}));
  const fakeOk = () => json({ ok: true });
  // Bots: a filled honeypot, or a form this long sent in under a minute.
  if (b.company) return fakeOk();
  if (!(Number(b.t) >= 60000)) return fakeOk();

  const brand = MOVEMENTS[b.brand] ? b.brand : null;
  if (!brand) return json({ error: "Applications are not open for that course yet." }, 400);

  const a = {
    brand,
    full_name: text(b.full_name, 80),
    email: text(b.email, 254).toLowerCase(),
    phone: text(b.phone, 40) || null,
    country: text(b.country, 60),
    city: text(b.city, 60) || null,
    region: REGIONS[b.region] ? b.region : null,
    languages: (Array.isArray(b.languages) ? b.languages : []).map((l) => text(l, 30)).filter(Boolean).slice(0, 12),
    gym: text(b.gym, 120) || null,
    years_coaching: Math.max(0, Math.min(60, parseInt(b.years_coaching, 10) || 0)),
    tracks: [...new Set(Array.isArray(b.tracks) ? b.tracks : [])].filter((t) => TRACKS[t]),
    courses: [...new Set(Array.isArray(b.courses) ? b.courses : [])].filter((c) => COURSES[c]),
    course_when: text(b.course_when, 60) || null,
    other_quals: text(b.other_quals, 1500) || null,
    coaching_video: link(b.coaching_video),
    why: String(b.why || "").replace(/\r/g, "").trim().slice(0, 6000),
    reference: {
      name: text(b.ref_name, 80), role: text(b.ref_role, 120),
      email: text(b.ref_email, 254).toLowerCase(), relation: text(b.ref_relation, 200),
    },
  };
  const moves = MOVEMENTS[brand];
  const given = Array.isArray(b.movement_videos) ? b.movement_videos : [];
  a.movement_videos = moves.map((m, i) => {
    const g = given[i] && typeof given[i] === "object" ? given[i] : { url: given[i] };
    const path = filePath(g.path, "video");
    return { group: m.group, movement: m.name, url: path ? null : link(g.url), path };
  });
  a.cv_path = filePath(b.cv_path, "doc");
  a.philosophy_path = filePath(b.philosophy_path, "doc");

  if (a.full_name.length < 2) return json({ error: "Add your full name." }, 400);
  if (!EMAIL_RE.test(a.email)) return json({ error: "Add an email we can reach you on." }, 400);
  if (!a.country) return json({ error: "Add the country you live in." }, 400);
  if (!a.region) return json({ error: "Choose the region you would work in." }, 400);
  if (!a.languages.length) return json({ error: "Tick the languages you can coach in." }, 400);
  if (!a.tracks.length) return json({ error: "Tick at least one track you want to develop towards." }, 400);
  if (!a.courses.some((c) => COURSES[c].brand === brand)) return json({ error: `Tick the ${BRAND_NAME[brand]} courses you have completed.` }, 400);
  if (!a.coaching_video) return json({ error: "Add a link to your coaching video. It must start with https://." }, 400);
  const missing = a.movement_videos.filter((m) => !m.url && !m.path).map((m) => `${m.movement} (${m.group.toLowerCase()})`);
  if (missing.length) return json({ error: `Add a video for: ${missing.join(", ")}. Upload it, or paste a link starting with https://.` }, 400);
  if (!a.cv_path) return json({ error: "Upload your CV." }, 400);
  if (!a.philosophy_path) return json({ error: "Upload your coaching philosophy." }, 400);
  if (a.why.split(/\s+/).filter(Boolean).length < 150) return json({ error: "Your written piece needs at least 150 words." }, 400);
  if (a.reference.name.length < 2 || !EMAIL_RE.test(a.reference.email)) return json({ error: "Add your reference's name and email." }, 400);
  if (a.reference.email === a.email) return json({ error: "Your reference needs to be someone other than you." }, 400);
  if (!b.agree_terms || !b.agree_privacy) return json({ error: "Tick both boxes at the end to confirm." }, 400);

  try {
    const { data: before } = await db.from("staff_pathway_applications")
      .select("id, status, decided_at").eq("email", a.email).eq("brand", brand)
      .order("created_at", { ascending: false }).limit(1);
    const last = before && before[0];
    if (last && OPEN.includes(last.status)) {
      return json({ error: `We already have your application and are reviewing it. Questions? Write to ${OFFICE}.` }, 409);
    }
    if (last && last.status === "declined" && last.decided_at && reapplyFrom(last.decided_at) > new Date()) {
      const when = reapplyFrom(last.decided_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      return json({ error: `You can apply again from ${when}. Use the time to work through the feedback we sent you.` }, 409);
    }

    const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    a.ip_hash = ip ? createHash("sha256").update(ip + (process.env.SUPABASE_SERVICE_ROLE_KEY || "")).digest("hex").slice(0, 32) : null;
    if (a.ip_hash) {
      const dayAgo = new Date(Date.now() - 86400e3).toISOString();
      const { count } = await db.from("staff_pathway_applications").select("id", { count: "exact", head: true })
        .eq("ip_hash", a.ip_hash).gte("created_at", dayAgo);
      if ((count || 0) >= 3) return json({ error: `Too many applications from here today. Write to ${OFFICE} if you need help.` }, 429);
    }

    // Every uploaded file must be one this form handed out, not yet used
    // by another application, and actually in storage.
    const paths = [a.cv_path, a.philosophy_path, ...a.movement_videos.map((m) => m.path)].filter(Boolean);
    const { data: known } = await db.from("staff_pathway_uploads").select("path, application_id").in("path", paths);
    const ok = new Set((known || []).filter((k) => !k.application_id).map((k) => k.path));
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, 60);
    const stored = new Set((signed || []).filter((x) => !x.error).map((x) => x.path));
    if (paths.some((p) => !ok.has(p) || !stored.has(p))) {
      return json({ error: "One of your uploads did not finish. Upload it again (or paste a link), then send." }, 400);
    }

    const { data: row, error } = await db.from("staff_pathway_applications").insert(a).select("id").single();
    if (error) throw error;
    await db.from("staff_pathway_uploads").update({ application_id: row.id }).in("path", paths);

    await Promise.all([tellApplicant(a), tellOffice(a)]);
    return json({ ok: true });
  } catch (err) {
    console.error("pathway-apply:", err.message || err);
    return json({ error: `That did not send. Try again, or write to ${OFFICE}.` }, 500);
  }
};

function tellApplicant(a) {
  const first = a.full_name.split(" ")[0];
  const course = BRAND_NAME[a.brand];
  return sendMail({
    to: a.email,
    subject: `We have your ${a.brand.toUpperCase()} Staff Pathway application`,
    text:
`Hi ${first},

Thank you for applying to the ${course} Staff Pathway. Your application is in.

Nathan reviews every application himself: your coaching video, your movement videos, your written piece and your reference. We may contact your reference, and we may invite you to a short call.

Whatever the outcome, you will hear from us with feedback. If you are not accepted this time, the feedback comes with the courses and study that will strengthen your next application.

Please keep your video links working until you hear from us.

BirdBox Coaching`,
    html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#16181b;max-width:560px">
<p>Hi ${esc(first)},</p>
<p>Thank you for applying to the ${esc(course)} Staff Pathway. Your application is in.</p>
<p>Nathan reviews every application himself: your coaching video, your movement videos, your written piece and your reference. We may contact your reference, and we may invite you to a short call.</p>
<p>Whatever the outcome, you will hear from us with feedback. If you are not accepted this time, the feedback comes with the courses and study that will strengthen your next application.</p>
<p>Please keep your video links working until you hear from us.</p>
<p>BirdBox Coaching</p>
</div>`,
  });
}

function tellOffice(a) {
  const where = [a.city, a.country].filter(Boolean).join(", ");
  const review = `${SITE_URL}/portal/staff-pathway/`;
  return sendMail({
    to: OFFICE,
    replyTo: a.email,
    subject: `New ${a.brand.toUpperCase()} Staff Pathway application: ${a.full_name}`,
    text: `${a.full_name} (${a.email}) applied for the ${a.brand.toUpperCase()} Staff Pathway.\n\n${where} · ${REGIONS[a.region]} · ${a.languages.join(", ")}\nTracks: ${a.tracks.map((t) => TRACKS[t].split(":")[0]).join(", ")}\n\nReview it: ${review}`,
    html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#16181b">
<p><strong>${esc(a.full_name)}</strong> (${esc(a.email)}) applied for the ${a.brand.toUpperCase()} Staff Pathway.</p>
<p>${esc(where)} · ${esc(REGIONS[a.region])} · ${esc(a.languages.join(", "))}<br>Tracks: ${esc(a.tracks.map((t) => TRACKS[t].split(":")[0]).join(", "))}</p>
<p><a href="${review}">Review it in the portal</a></p></div>`,
  });
}
