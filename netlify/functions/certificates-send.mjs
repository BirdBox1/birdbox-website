// netlify/functions/certificates-send.mjs
//
// Closes out a seminar: generates a certificate for every participant
// the coach has marked as attended, emails it to them, and records what
// was issued.
//
// Called from the portal by the lead coach or an admin. Deliberately
// not automatic — a certificate asserts that someone completed the
// course, so it waits for a human to confirm the attendance list.
//
// The design is a background image with three things drawn on top:
// the name, the date, and the reference. That means a new certificate
// design is a file swap rather than a code change.

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const OFFICE = "info@birdboxcoaching.com";
const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const SITE_URL = (process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app")
  .replace(/\/+$/, "");

// The templates are all 2480 x 1753, A4 landscape proportions. These
// positions were measured from the artwork: the rule under the name
// sits 42% down, the rule under "AWARDED ON" 75% down.
const ART = { width: 2480, height: 1753 };
const PAGE = { width: 841.89, height: 595.28 };   // A4 landscape, points
const SCALE = PAGE.width / ART.width;

const LAYOUT = {
  name:      { centreX: 1236, baselineY: 700,  maxWidth: 1050, size: 108, min: 52 },
  awardedOn: { centreX: 1752, baselineY: 1274, maxWidth: 480,  size: 46,  min: 26 },
  reference: { x: 150,        baselineY: 1660, size: 22 },
};

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth || !auth.user) return json({ error: "Not signed in" }, 401);

    const { courseId } = await request.json();
    if (!courseId) return json({ error: "No course given" }, 400);

    // ---- who is asking ----------------------------------------
    const { data: me } = await supabase
      .from("staff")
      .select("id, full_name, role, active")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (!me || !me.active) return json({ error: "Not a member of staff" }, 403);

    const isAdmin = me.role === "admin";
    if (!isAdmin) {
      const { data: lead } = await supabase
        .from("course_staff")
        .select("id")
        .eq("course_id", courseId)
        .eq("staff_id", me.id)
        .eq("role", "lead_coach")
        .maybeSingle();
      if (!lead) return json({ error: "Only the lead coach or an admin can do this" }, 403);
    }

    // ---- the course -------------------------------------------
    const { data: course, error: cErr } = await supabase
      .from("courses")
      .select("id, brand, type, level, title, starts_at, ends_at, timezone, completed_at")
      .eq("id", courseId)
      .single();

    if (cErr || !course) return json({ error: "Course not found" }, 404);

    if (new Date(course.starts_at) > new Date()) {
      return json({ error: "This course has not run yet." }, 400);
    }

    // ---- who attended -----------------------------------------
    const { data: regs, error: rErr } = await supabase
      .from("registrations")
      .select("id, first_name, last_name, email, attended, status, payment_status, certificate_sent_at")
      .eq("course_id", courseId);

    if (rErr) throw new Error("registrations: " + rErr.message);

    const eligible = (regs || []).filter(
      (r) => r.attended === true &&
             (r.status || "active") === "active" &&
             r.payment_status !== "refunded" &&
             r.email
    );

    if (!eligible.length) {
      return json({
        error: "Nobody is marked as attended yet. Tick attendance first, then submit.",
      }, 400);
    }

    const todo = eligible.filter((r) => !r.certificate_sent_at);
    if (!todo.length) {
      return json({ error: "Everyone who attended already has their certificate." }, 400);
    }

    // ---- the template and the wording -------------------------
    const artwork = await loadArtwork(course);
    if (!artwork) {
      return json({
        error: `No certificate artwork found for this course. Expected ${SITE_URL}${templatePath(course)}`,
      }, 400);
    }

    const template = await loadTemplate(course);
    if (!template) {
      return json({
        error: "No certificate email is set up for this course type yet.",
      }, 400);
    }

    const awardedOn = new Date(course.ends_at || course.starts_at);
    const awardedText = awardedOn.toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
      timeZone: safeZone(course.timezone),
    });

    // ---- one at a time ----------------------------------------
    let sent = 0;
    const failures = [];

    for (const reg of todo) {
      const name = [reg.first_name, reg.last_name].filter(Boolean).join(" ").trim()
        || "Participant";

      try {
        const reference = await nextReference(course);

        const pdf = await buildPdf({
          artwork,
          name,
          awardedText,
          reference,
        });

        const fields = {
          first_name: reg.first_name || "there",
          last_name: reg.last_name || "",
          full_name: name,
          course_title: course.title || "your course",
          awarded_on: awardedText,
          reference,
          site_url: SITE_URL,
        };

        const ok = await sendEmail({
          to: reg.email,
          subject: fill(template.subject || "Your certificate", fields),
          text: fill(template.body, fields),
          filename: `BirdBox certificate - ${name}.pdf`,
          pdf,
        });

        // Recorded whether or not the email landed, so a reference is
        // never handed out twice and a failure stays visible.
        await supabase.from("certificates").insert({
          registration_id: reg.id,
          course_id: course.id,
          reference,
          participant_name: name,
          awarded_on: awardedOn.toISOString().slice(0, 10),
          status: ok ? "sent" : "failed",
          error: ok ? null : "The email was rejected",
        });

        if (ok) {
          await supabase
            .from("registrations")
            .update({ certificate_sent_at: new Date().toISOString() })
            .eq("id", reg.id);
          sent++;
        } else {
          failures.push(name);
        }
      } catch (err) {
        console.error("Certificate failed for", name, err);
        failures.push(name);
      }
    }

    // ---- mark the seminar closed out --------------------------
    if (sent && !course.completed_at) {
      await supabase
        .from("courses")
        .update({ completed_at: new Date().toISOString(), completed_by: me.id })
        .eq("id", course.id);
    }

    return json({
      sent,
      failed: failures.length,
      failures,
      skipped: eligible.length - todo.length,
    });
  } catch (err) {
    console.error("certificates-send failed:", err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

// ---------------------------------------------------------------

// certificates/tcc-1.jpg, tgc-2.jpg, tgc-workshop.jpg and so on.
function templatePath(course) {
  const brand = String(course.brand || "").toLowerCase();
  if (course.type === "workshop") return `/certificates/${brand}-workshop.jpg`;
  const level = String(course.level == null ? "" : course.level).replace(/\D/g, "");
  return `/certificates/${brand}-${level || "1"}.jpg`;
}

async function loadArtwork(course) {
  const url = SITE_URL + templatePath(course);
  try {
    const res = await fetch(url);
    if (!res.ok) { console.error("Artwork missing:", url, res.status); return null; }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.error("Could not fetch artwork:", url, err.message);
    return null;
  }
}

async function loadTemplate(course) {
  const level = course.type === "workshop"
    ? ""
    : String(course.level == null ? "" : course.level).replace(/\D/g, "");

  const { data } = await supabase
    .from("email_templates")
    .select("subject, body")
    .eq("kind", "certificate")
    .eq("type", course.type)
    .eq("brand", String(course.brand || "").toLowerCase())
    .eq("level", level)
    .eq("language", "en")
    .maybeSingle();

  return data || null;
}

// BB-TCC1-0826-0001. Brand and level so it is readable at a glance,
// the course month so it can be placed in time, then a running number.
// The unique constraint on the column is the real guarantee; a clash
// simply retries with the next number.
async function nextReference(course) {
  const brand = String(course.brand || "bb").toUpperCase();
  const level = course.type === "workshop"
    ? "W"
    : String(course.level == null ? "" : course.level).replace(/\D/g, "") || "1";

  const start = new Date(course.starts_at);
  const stamp = String(start.getUTCMonth() + 1).padStart(2, "0") +
                String(start.getUTCFullYear()).slice(-2);

  const { count } = await supabase
    .from("certificates")
    .select("id", { count: "exact", head: true });

  let n = (count || 0) + 1;
  for (let attempt = 0; attempt < 20; attempt++) {
    const reference = `BB-${brand}${level}-${stamp}-${String(n).padStart(4, "0")}`;
    const { data: clash } = await supabase
      .from("certificates")
      .select("id")
      .eq("reference", reference)
      .maybeSingle();
    if (!clash) return reference;
    n++;
  }
  throw new Error("Could not allocate a certificate reference");
}

async function buildPdf({ artwork, name, awardedText, reference }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);

  const image = await doc.embedJpg(artwork);
  page.drawImage(image, { x: 0, y: 0, width: PAGE.width, height: PAGE.height });

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const plain = await doc.embedFont(StandardFonts.Helvetica);

  // Positions are in artwork pixels, converted here — so the numbers
  // above can be read straight off the design.
  const toX = (px) => px * SCALE;
  const toY = (pxFromTop) => PAGE.height - pxFromTop * SCALE;

  // The name shrinks until it fits between the ends of the rule.
  const n = LAYOUT.name;
  let size = n.size * SCALE;
  const maxWidth = n.maxWidth * SCALE;
  while (bold.widthOfTextAtSize(name, size) > maxWidth && size > n.min * SCALE) {
    size -= 1;
  }
  page.drawText(name, {
    x: toX(n.centreX) - bold.widthOfTextAtSize(name, size) / 2,
    y: toY(n.baselineY),
    size,
    font: bold,
    color: rgb(0.05, 0.05, 0.05),
  });

  const a = LAYOUT.awardedOn;
  let dateSize = a.size * SCALE;
  while (plain.widthOfTextAtSize(awardedText, dateSize) > a.maxWidth * SCALE &&
         dateSize > a.min * SCALE) {
    dateSize -= 1;
  }
  page.drawText(awardedText, {
    x: toX(a.centreX) - plain.widthOfTextAtSize(awardedText, dateSize) / 2,
    y: toY(a.baselineY),
    size: dateSize,
    font: plain,
    color: rgb(0.1, 0.1, 0.1),
  });

  // Discreet, bottom left, out of the way of the design.
  const r = LAYOUT.reference;
  page.drawText(reference, {
    x: toX(r.x),
    y: toY(r.baselineY),
    size: r.size * SCALE,
    font: plain,
    color: rgb(0.55, 0.55, 0.55),
  });

  return await doc.saveAsBase64();
}

function fill(text, fields) {
  let out = String(text);
  for (const [key, value] of Object.entries(fields)) {
    out = out.replace(new RegExp("\\{\\{\\s*" + key + "\\s*\\}\\}", "gi"), value);
  }
  return out;
}

async function sendEmail({ to, subject, text, filename, pdf }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("No Resend key; certificate not sent to", to); return false; }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox Coaching <${FROM}>`,
        to: [to],
        reply_to: OFFICE,
        subject,
        text,
        attachments: [{ filename, content: pdf }],
      }),
    });
    if (!res.ok) {
      console.error("Resend rejected certificate for", to, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Could not send certificate to", to, err.message);
    return false;
  }
}

function safeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC" });
    return tz || "UTC";
  } catch (e) { return "UTC"; }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
