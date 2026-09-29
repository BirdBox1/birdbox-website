// netlify/functions/learn-certificate.mjs
//
// POST { course_id, name? }   (Authorization: Bearer <the learner's token>)
//   -> { reference, name, filename, pdf }   pdf = base64
//
// The certificate for an online course on BirdBox Learn.
//
// First time (no certificate yet): the learner must have passed or
// completed the course, and must give the name to print. A reference is
// allocated, the row is saved in learn_certificates, the PDF is emailed
// to them, and returned so the page can download it straight away.
//
// Every time after: the same certificate is rebuilt from the saved row
// (same name, date and reference) and returned. Nothing is emailed.
//
// Artwork: /certificates/<brand>-<level>-online.jpg, e.g.
// tcc-1-online.jpg. The course title and CEUs at the foot are drawn
// from learn_courses, so the artwork carries no course-specific numbers
// except the paragraph.

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const OFFICE = "info@birdboxcoaching.com";
const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const SITE_URL = (process.env.SITE_URL || "https://birdboxcoaching.com").replace(/\/+$/, "");

const PAGE = { width: 841.89, height: 595.28 };   // A4 landscape, points

// Positions in artwork pixels (2480 x 1753), same design as the seminar.
const LAYOUT = {
  art: { width: 2480, height: 1753 },
  name:      { centreX: 1236, baselineY: 700,  maxWidth: 1050, size: 108, min: 52 },
  awardedOn: { centreX: 1752, baselineY: 1274, maxWidth: 480,  size: 46,  min: 26 },
  title:     { centreX: 1236, baselineY: 1540, maxWidth: 1500, size: 74,  min: 40 },
  ceus:      { centreX: 1236, baselineY: 1605, maxWidth: 800,  size: 44,  min: 24 },
  reference: { rightX: 2200,  baselineY: 1660, size: 22 },
};

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    // ---- who is asking ------------------------------------------
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return json({ error: "Please log in again." }, 401);
    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth?.user) return json({ error: "Please log in again." }, 401);
    const user = auth.user;

    const body = await req.json().catch(() => ({}));

    // ---- an admin downloading or re-sending someone's certificate ----
    if (body.certificate_id) return await adminAction(user, body);

    const courseId = String(body.course_id || "");
    if (!/^[0-9a-f-]{36}$/.test(courseId)) return json({ error: "No course given." }, 400);

    // ---- the course ---------------------------------------------
    const { data: course } = await supabase
      .from("learn_courses")
      .select("id, slug, title, brand, level, ceus, cert_title")
      .eq("id", courseId).maybeSingle();
    if (!course) return json({ error: "Course not found." }, 404);

    // ---- an existing certificate: rebuild it ---------------------
    const { data: existing } = await supabase
      .from("learn_certificates")
      .select("id, reference, name, awarded_on")
      .eq("user_id", user.id).eq("course_id", courseId).maybeSingle();

    if (existing) {
      const pdf = await buildPdf(course, existing);
      if (!pdf) return json({ error: "The certificate design could not be loaded. Try again, or write to " + OFFICE + "." }, 500);
      return json({ reference: existing.reference, name: existing.name, filename: fileName(existing.name), pdf });
    }

    // ---- a new one: have they passed? ---------------------------
    const { data: attempt } = await supabase
      .from("learn_attempts")
      .select("completion_status, success_status, score_scaled, completed_at")
      .eq("user_id", user.id).eq("course_id", courseId).maybeSingle();

    const passed = attempt && (attempt.success_status === "passed" ||
      (attempt.success_status !== "failed" && attempt.completion_status === "completed"));
    if (!passed) return json({ error: "The certificate unlocks once you have passed the final test." }, 400);

    const name = String(body.name || "").replace(/\s+/g, " ").trim();
    if (name.length < 3 || name.length > 80) {
      return json({ error: "Type your full name as it should appear on the certificate." }, 400);
    }

    const awardedOn = (attempt.completed_at || new Date().toISOString()).slice(0, 10);

    // Reference like BB-TCC1-ON-0001. Retry if two people pass at once.
    let row = null;
    for (let tryNo = 0; tryNo < 5 && !row; tryNo++) {
      const reference = await nextReference(course);
      const { data, error } = await supabase.from("learn_certificates").insert({
        user_id: user.id,
        email: (user.email || "").toLowerCase(),
        course_id: course.id,
        reference,
        name,
        awarded_on: awardedOn,
        score_scaled: attempt.score_scaled,
      }).select("id, reference, name, awarded_on").single();
      if (!error) { row = data; break; }
      if (!/duplicate|unique/i.test(error.message || "")) throw new Error(error.message);
      // A certificate for this person and course appeared meanwhile: use it.
      const { data: again } = await supabase.from("learn_certificates")
        .select("id, reference, name, awarded_on").eq("user_id", user.id).eq("course_id", courseId).maybeSingle();
      if (again) row = again;
    }
    if (!row) throw new Error("Could not allocate a certificate reference");

    const pdf = await buildPdf(course, row);
    if (!pdf) return json({ error: "The certificate design could not be loaded. Try again, or write to " + OFFICE + "." }, 500);

    const sent = await sendEmail({ to: user.email, course, cert: row, pdf, again: false });
    if (sent) await supabase.from("learn_certificates").update({ emailed_at: new Date().toISOString() }).eq("id", row.id);

    return json({ reference: row.reference, name: row.name, filename: fileName(row.name), pdf, emailed: sent });
  } catch (err) {
    console.error("learn-certificate:", err && (err.message || err));
    return json({ error: "Something went wrong making your certificate. Try again, or write to " + OFFICE + "." }, 500);
  }
};

// ---------------------------------------------------------------

function titleFor(course) {
  return course.cert_title || String(course.title || "").replace(/\s*[—–-]\s*/g, " ").replace(/\s+/g, " ").trim();
}

function levelDigits(course) {
  return String(course.level == null ? "" : course.level).replace(/\D/g, "") || "1";
}

function fileName(name) {
  return "BirdBox certificate - " + String(name).replace(/[^\p{L}\p{N} .'-]/gu, "").trim() + ".pdf";
}

async function nextReference(course) {
  const prefix = `BB-${String(course.brand || "bb").toUpperCase()}${levelDigits(course)}-ON-`;
  const { count } = await supabase.from("learn_certificates").select("id", { count: "exact", head: true });
  let n = (count || 0) + 1;
  for (let i = 0; i < 50; i++, n++) {
    const reference = prefix + String(n).padStart(4, "0");
    const { data: clash } = await supabase.from("learn_certificates").select("id").eq("reference", reference).maybeSingle();
    if (!clash) return reference;
  }
  throw new Error("No free reference");
}

// The site's own files, tried from this deploy first (see certificates-send.mjs).
async function fetchSiteFile(path) {
  const bases = [...new Set([process.env.DEPLOY_URL, process.env.URL, SITE_URL]
    .filter(Boolean).map((u) => String(u).replace(/\/+$/, "")))];
  for (const base of bases) {
    try {
      const res = await fetch(base + path);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length || bytes[0] === 0x3c) continue;   // an HTML 404 page
      return bytes;
    } catch (e) { /* try the next */ }
  }
  return null;
}

async function buildPdf(course, cert) {
  const base = `/certificates/${String(course.brand || "").toLowerCase()}-${levelDigits(course)}-online`;
  let art = null;
  for (const ext of [".jpg", ".jpeg", ".png"]) { art = await fetchSiteFile(base + ext); if (art) break; }
  if (!art) { console.error("No artwork at", base); return null; }
  const nameFont = await fetchSiteFile("/certificates/name-font.ttf");

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle("BirdBox certificate — " + cert.name);
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const png = art[0] === 0x89 && art[1] === 0x50;
  const image = png ? await doc.embedPng(art) : await doc.embedJpg(art);
  page.drawImage(image, { x: 0, y: 0, width: PAGE.width, height: PAGE.height });

  const plain = await doc.embedFont(StandardFonts.Helvetica);
  let display = await doc.embedFont(StandardFonts.HelveticaBold);
  if (nameFont) {
    try { display = await doc.embedFont(nameFont, { subset: false }); }
    catch (e) { console.warn("Name font could not be embedded:", e.message); }
  }

  const scale = PAGE.width / LAYOUT.art.width;
  const toX = (px) => px * scale;
  const toY = (px) => PAGE.height - px * scale;
  const ink = rgb(0.06, 0.06, 0.06);

  const put = (text, spec, font) => {
    if (!text) return;
    let size = spec.size * scale;
    const max = spec.maxWidth * scale;
    while (font.widthOfTextAtSize(text, size) > max && size > spec.min * scale) size -= 0.5;
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: toX(spec.centreX) - w / 2, y: toY(spec.baselineY), size, font, color: ink });
  };

  const awardedText = new Date(cert.awarded_on + "T12:00:00Z")
    .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  put(cert.name, LAYOUT.name, display);
  put(awardedText, LAYOUT.awardedOn, display);
  put(titleFor(course), LAYOUT.title, display);
  if (course.ceus) put(`${Number(course.ceus)} CEUs`, LAYOUT.ceus, display);

  const r = LAYOUT.reference;
  const rs = r.size * scale;
  page.drawText(cert.reference, {
    x: toX(r.rightX) - plain.widthOfTextAtSize(cert.reference, rs),
    y: toY(r.baselineY), size: rs, font: plain, color: rgb(0.55, 0.55, 0.55),
  });

  return await doc.saveAsBase64();
}

// Portal → Online courses: Download / Re-send, admins only. Rebuilds the
// saved certificate (same reference and date, current name).
async function adminAction(user, body) {
  const { data: me } = await supabase.from("staff").select("role, active").eq("id", user.id).maybeSingle();
  if (!me || !me.active || me.role !== "admin") return json({ error: "Only an admin can do this." }, 403);

  const { data: cert } = await supabase.from("learn_certificates")
    .select("id, email, course_id, reference, name, awarded_on").eq("id", String(body.certificate_id)).maybeSingle();
  if (!cert) return json({ error: "Certificate not found." }, 404);
  const { data: course } = await supabase.from("learn_courses")
    .select("id, slug, title, brand, level, ceus, cert_title").eq("id", cert.course_id).maybeSingle();
  if (!course) return json({ error: "The course for this certificate is gone." }, 404);

  const pdf = await buildPdf(course, cert);
  if (!pdf) return json({ error: "The certificate design could not be loaded." }, 500);

  let emailed = false;
  if (body.action === "resend") {
    emailed = await sendEmail({ to: cert.email, course, cert, pdf, again: true });
    if (emailed) await supabase.from("learn_certificates").update({ emailed_at: new Date().toISOString() }).eq("id", cert.id);
  }
  return json({ reference: cert.reference, name: cert.name, filename: fileName(cert.name), pdf, emailed, email: cert.email });
}

async function sendEmail({ to, course, cert, pdf, again }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) { console.warn("Certificate not emailed to", to); return false; }

  const title = titleFor(course);
  const first = String(cert.name).split(" ")[0];
  const text =
`Hi ${first},

${again ? `Here is your certificate for ${title} again.` : `Congratulations — you have completed ${title}.`}

Your certificate is attached. Your reference is ${cert.reference}${course.ceus ? `, and the course is worth ${Number(course.ceus)} CEUs` : ""}.

You can download it again any time from My courses:
${SITE_URL}/learn/

Thank you for learning with us.

BirdBox Coaching`;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#16181b;max-width:560px">
<p>Hi ${esc(first)},</p>
<p><strong>${again ? `Here is your certificate for ${esc(title)} again.` : `Congratulations — you have completed ${esc(title)}.`}</strong></p>
<p>Your certificate is attached. Your reference is <strong>${esc(cert.reference)}</strong>${course.ceus ? `, and the course is worth ${Number(course.ceus)} CEUs` : ""}.</p>
<p>You can download it again any time from <a href="${SITE_URL}/learn/">My courses</a>.</p>
<p>Thank you for learning with us.</p>
<p>BirdBox Coaching</p>
</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox Coaching <${FROM}>`,
        to: [to],
        reply_to: OFFICE,
        subject: `Your certificate — ${title}`,
        text, html,
        attachments: [{ filename: fileName(cert.name), content: pdf }],
      }),
    });
    if (!res.ok) { console.error("Resend rejected certificate for", to, await res.text()); return false; }
    return true;
  } catch (err) {
    console.error("Could not email certificate to", to, err.message);
    return false;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
