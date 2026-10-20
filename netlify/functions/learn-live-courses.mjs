// netlify/functions/learn-live-courses.mjs
//
// The in-person side of a learner's BirdBox Learn account.
// (Authorization: Bearer <the learner's token>)
//
// GET                        -> { live: [...], earlier: [...] }
//   live:    seminars and workshops they attended, with a certificate
//   earlier: older courses verified for their Trainer Directory listing
//            (before our records began), shown without a download
// POST { certificate_id }    -> { pdf, filename, reference }
//   rebuilds that certificate as a PDF, exactly as it was issued
//
// Matched on the login email, plus any other address the office has
// linked to their directory listing. A certificate can only be
// downloaded by someone whose email is on its registration.

import { db, json, userFrom, qualTitle } from "../lib/directory.mjs";
import { layoutFor, loadArtwork, loadNameFont, buildPdf } from "./certificates-send.mjs";

export default async (req) => {
  const user = await userFrom(req);
  if (!user) return json({ error: "Please log in again." }, 401);

  try {
    const emails = await emailsFor(user);
    const regs = await registrationsFor(emails);

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      return await download(String(body.certificate_id || ""), regs);
    }
    if (req.method !== "GET") return json({ error: "Use GET or POST" }, 405);

    const live = [];
    const regIds = [...regs.keys()];
    if (regIds.length) {
      const { data: certs } = await db.from("certificates")
        .select("id, registration_id, reference, awarded_on, courses(brand, type, level, title, workshop_focus, city, country)")
        .in("registration_id", regIds);
      for (const c of certs || []) {
        const k = c.courses || {};
        const level = String(k.level || "").replace(/\D/g, "") || null;
        const kind = k.type === "workshop" ? "workshop" : "seminar";
        live.push({
          id: c.id, reference: c.reference, awarded_on: c.awarded_on,
          brand: k.brand, level, kind,
          title: qualTitle({ brand: k.brand, level, kind, focus: k.workshop_focus }),
          place: [k.city, k.country].filter(Boolean).join(", ") || null,
        });
      }
      live.sort((a, b) => String(b.awarded_on).localeCompare(String(a.awarded_on)));
    }

    // Older courses verified on their directory listing.
    const earlier = [];
    const { data: prof } = await db.from("directory_profiles").select("id").eq("user_id", user.id).maybeSingle();
    if (prof) {
      const { data: past } = await db.from("directory_courses")
        .select("brand, level, kind, course_month, location").eq("profile_id", prof.id).not("verified_at", "is", null);
      for (const p of past || []) {
        if (p.kind === "online") continue;
        earlier.push({ brand: p.brand, level: p.level, kind: p.kind, title: qualTitle(p), date: p.course_month, place: p.location });
      }
    }
    return json({ live, earlier });
  } catch (err) {
    console.error("learn-live-courses:", err.message || err);
    return json({ error: "Your live courses could not be loaded." }, 500);
  }
};

async function emailsFor(user) {
  const set = new Set([String(user.email || "").toLowerCase()]);
  const { data: prof } = await db.from("directory_profiles").select("email, other_emails").eq("user_id", user.id).maybeSingle();
  if (prof) [prof.email, ...(prof.other_emails || [])].forEach((e) => e && set.add(String(e).toLowerCase()));
  return [...set].filter(Boolean);
}

// Registrations are matched without regard to capital letters, since
// people type their email however they like when booking.
async function registrationsFor(emails) {
  const regs = new Map();
  for (const e of emails) {
    const pattern = e.replace(/[\\%_]/g, (c) => "\\" + c);
    const { data } = await db.from("registrations").select("id, email, first_name, last_name").ilike("email", pattern);
    for (const r of data || []) regs.set(r.id, r);
  }
  return regs;
}

async function download(certificateId, regs) {
  if (!/^[0-9a-f-]{36}$/.test(certificateId)) return json({ error: "No certificate given." }, 400);
  const { data: cert } = await db.from("certificates")
    .select("id, registration_id, course_id, reference, participant_name, awarded_on").eq("id", certificateId).maybeSingle();
  if (!cert || !regs.has(cert.registration_id)) return json({ error: "That certificate is not on your account." }, 404);

  const { data: course } = await db.from("courses")
    .select("id, brand, type, level, title, workshop_focus, starts_at, ends_at, timezone").eq("id", cert.course_id).maybeSingle();
  if (!course) return json({ error: "The course for that certificate is gone. Write to info@birdboxcoaching.com." }, 404);

  const artwork = await loadArtwork(course);
  if (!artwork) return json({ error: "The certificate design could not be loaded. Try again shortly." }, 500);

  const focus = course.type === "workshop"
    ? (course.workshop_focus || String(course.title || "").replace(/^.*?Workshop\s*[—-]\s*/i, "") || "")
    : "";
  const awardedText = new Date(cert.awarded_on + "T12:00:00Z")
    .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const name = cert.participant_name || "Participant";

  const pdf = await buildPdf({
    artwork, layout: layoutFor(course), nameFont: await loadNameFont(),
    name, awardedText, reference: cert.reference, focus,
  });
  return json({ pdf, reference: cert.reference, filename: `BirdBox certificate - ${name}.pdf` });
}
