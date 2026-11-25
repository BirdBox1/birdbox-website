// netlify/functions/learn-live-courses.mjs
//
// The in-person side of a learner's BirdBox Learn account.
// (Authorization: Bearer <the learner's token>)
//
// GET                        -> { upcoming: [...], live: [...], earlier: [...] }
//   upcoming: seminars and workshops they are booked on that have not
//            happened yet (Nathan, 16 Nov 2026), with the course manual
//   live:    seminars and workshops they attended, with a certificate
//            Certificates we sent through SimpleCert before BirdBox
//            Learn (2019 to Aug 2026; Nathan, 17 Nov 2026) are in here
//            too, marked past: true, with the PDF they were sent
//   earlier: older courses verified for their Trainer Directory listing
//            (before our records began), shown without a download
// POST { certificate_id }    -> { pdf, filename, reference }
//   rebuilds that certificate as a PDF, exactly as it was issued
// POST { past_id }           -> { url, filename }
//   a short-lived link to the SimpleCert PDF they were sent
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
      if (body.past_id) return await downloadPast(String(body.past_id), emails);
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
          manual: manualFor(k.brand, level, kind),
        });
      }
      live.sort((a, b) => String(b.awarded_on).localeCompare(String(a.awarded_on)));
    }

    // Sent through SimpleCert, before BirdBox Learn
    const { data: past } = await db.from("past_certificates")
      .select("id, brand, level, kind, awarded_on, pdf_path").in("email", emails).is("revoked_at", null);
    for (const p of past || []) {
      const level = p.level === "advanced" ? null : p.level;
      live.push({
        id: p.id, past: true, has_pdf: !!p.pdf_path, awarded_on: p.awarded_on,
        brand: p.brand, level, kind: p.kind,
        title: p.level === "advanced" ? "The Gymnastics Course — Advanced" : qualTitle({ brand: p.brand, level, kind: p.kind }),
        place: null,
        manual: manualFor(p.brand, level, p.kind),
      });
    }
    live.sort((a, b) => String(b.awarded_on).localeCompare(String(a.awarded_on)));

    // Booked and still to come: an active, unrefunded seat on a course
    // that is not cancelled, not yet completed, and not long over.
    const upcoming = [];
    if (regIds.length) {
      const since = new Date(Date.now() - 2 * 86400000).toISOString();
      const { data: rows } = await db.from("registrations")
        .select("id, status, payment_status, archived_at, courses!registrations_course_id_fkey(id, slug, brand, type, level, title, workshop_focus, city, country, venue_name, starts_at, ends_at, timezone, status, cancelled_at, completed_at)")
        .in("id", regIds).eq("status", "active");
      for (const r of rows || []) {
        const k = r.courses;
        if (!k || r.archived_at || r.payment_status === "refunded") continue;
        if (k.cancelled_at || k.status === "cancelled" || k.completed_at) continue;
        if (String(k.ends_at || k.starts_at || "") < since) continue;
        const level = String(k.level || "").replace(/\D/g, "") || null;
        const kind = k.type === "workshop" ? "workshop" : "seminar";
        upcoming.push({
          id: r.id, brand: k.brand, level, kind,
          title: qualTitle({ brand: k.brand, level, kind, focus: k.workshop_focus }),
          starts_at: k.starts_at, ends_at: k.ends_at, timezone: k.timezone,
          place: [k.venue_name, k.city, k.country].filter(Boolean).join(", ") || null,
          deposit_only: r.payment_status === "deposit_paid",
          manual: manualFor(k.brand, level, kind),
        });
      }
      upcoming.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
    }

    // Older courses verified on their directory listing.
    const earlier = [];
    const { data: prof } = await db.from("directory_profiles").select("id").eq("user_id", user.id).maybeSingle();
    if (prof) {
      const { data: older } = await db.from("directory_courses")
        .select("brand, level, kind, course_month, location").eq("profile_id", prof.id).not("verified_at", "is", null);
      // a course already shown with its SimpleCert certificate is not
      // listed again without one
      const has = new Set(live.map((c) => `${c.brand}|${c.level || ""}|${c.kind}`));
      for (const p of older || []) {
        if (p.kind === "online") continue;
        if (has.has(`${p.brand}|${String(p.level || "").replace(/\D/g, "")}|${p.kind === "workshop" ? "workshop" : "seminar"}`)) continue;
        const level = String(p.level || "").replace(/\D/g, "") || null;
        earlier.push({ brand: p.brand, level: p.level, kind: p.kind, title: qualTitle(p), date: p.course_month, place: p.location,
          manual: manualFor(p.brand, level, p.kind === "workshop" ? "workshop" : "seminar") });
      }
    }
    return json({ upcoming, live, earlier });
  } catch (err) {
    console.error("learn-live-courses:", err.message || err);
    return json({ error: "Your live courses could not be loaded." }, 500);
  }
};

// The participant manual (/manuals/<brand>-l<level>/), which exists for
// TGC and TCC Level 1 seminars only, as in the booking email.
function manualFor(brand, level, kind) {
  const b = String(brand || "").toLowerCase();
  return kind === "seminar" && level === "1" && (b === "tgc" || b === "tcc") ? `/manuals/${b}-l1/` : null;
}

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

// The PDF we sent through SimpleCert, for someone whose email it was sent to.
async function downloadPast(id, emails) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "No certificate given." }, 400);
  const { data: p } = await db.from("past_certificates")
    .select("email, participant_name, brand, pdf_path").eq("id", id).is("revoked_at", null).maybeSingle();
  if (!p || !emails.includes(p.email)) return json({ error: "That certificate is not on your account." }, 404);
  if (!p.pdf_path) return json({ error: "We no longer have a copy of this one. Write to info@birdboxcoaching.com and we will send you a new one." }, 404);
  const filename = `${p.brand === "tgc" ? "TGC" : "BirdBox"} certificate - ${p.participant_name || "Participant"}.pdf`;
  const { data, error } = await db.storage.from("past-certificates").createSignedUrl(p.pdf_path, 300, { download: filename });
  if (error || !data?.signedUrl) return json({ error: "The certificate could not be fetched. Try again shortly." }, 500);
  return json({ url: data.signedUrl, filename });
}
