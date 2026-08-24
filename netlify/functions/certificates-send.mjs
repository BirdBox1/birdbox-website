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
//
// Sent in batches. Netlify stops waiting for a function at 26 seconds,
// and a certificate takes close to two of them, so a full seminar in
// one call runs past the limit — the work finished, but the reply
// never arrived and the coach was shown a failure for a send that had
// actually worked. Each call now takes on a few, says how many are
// left, and the portal calls again until there are none. Anyone who
// already has theirs is skipped, so calling twice can never send twice.

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const OFFICE = "info@birdboxcoaching.com";
const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const SITE_URL = (process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app")
  .replace(/\/+$/, "");

// How many to take on in one call. Six at roughly two seconds each is
// about twelve, leaving comfortable room under Netlify's 26 for the
// artwork fetch and startup before the loop begins.
const BATCH = 6;

// Each design has its own artwork and its own positions, measured from
// the file itself. Positions are in artwork pixels so they can be read
// straight off the design; the page is A4 landscape either way, and the
// image is scaled to fill it.
//
// A new design means new numbers here, not new code.
const PAGE = { width: 841.89, height: 595.28 };   // A4 landscape, points

const LAYOUTS = {
  // The seminar certificates: name on a rule, date above "Awarded on".
  seminar: {
    art: { width: 2480, height: 1753 },
    name:      { centreX: 1236, baselineY: 700,  maxWidth: 1050, size: 108, min: 52 },
    awardedOn: { centreX: 1752, baselineY: 1274, maxWidth: 480,  size: 46,  min: 26 },
    reference: { rightX: 2200,  baselineY: 1660, size: 22 },
  },

  // The workshop certificate is a different design: a name rule at 58%,
  // a box for what was coached, and a date rule at the foot.
  workshop: {
    art: { width: 2000, height: 1414 },
    name:      { centreX: 1015, baselineY: 800,  maxWidth: 1450, size: 92, min: 44 },
    // Inside the box, which runs y 946-1069.
    focus:     { centreX: 1014, baselineY: 1027, maxWidth: 1200, size: 54, min: 26 },
    // The rule runs x 1376-1655, so its centre is 1515. Measured
    // ignoring the red corner graphic, which is dark enough to have
    // been mistaken for part of the rule the first time.
    awardedOn: { centreX: 1515, baselineY: 1220, maxWidth: 265,  size: 36, min: 20 },
    reference: { rightX: 700,   baselineY: 1350, size: 20 },
  },
};

function layoutFor(course) {
  return course.type === "workshop" ? LAYOUTS.workshop : LAYOUTS.seminar;
}

// ---------------------------------------------------------------
// Reissue one certificate
// ---------------------------------------------------------------

// Everything needed is on the record already: the reference, the name
// as it was printed, and the date awarded. So the same certificate is
// rebuilt rather than a new one issued — a second reference for one
// course would leave two answers to "what did they get".
//
// The awarded date comes from the certificate row, not from the
// course. If the course was later moved, the certificate still says
// what it said when it was earned.
async function reissue(certificateId, me) {
  const { data: cert } = await supabase
    .from("certificates")
    .select("id, registration_id, course_id, reference, participant_name, " +
            "awarded_on, status, reissue_count")
    .eq("id", certificateId)
    .maybeSingle();

  if (!cert) return json({ error: "That certificate could not be found." }, 404);

  const { data: course } = await supabase
    .from("courses")
    .select("id, brand, type, level, title, workshop_focus, starts_at, ends_at, timezone")
    .eq("id", cert.course_id)
    .maybeSingle();

  if (!course) return json({ error: "The course for that certificate is gone." }, 404);

  const { data: reg } = await supabase
    .from("registrations")
    .select("id, first_name, last_name, email")
    .eq("id", cert.registration_id)
    .maybeSingle();

  if (!reg || !reg.email) {
    return json({ error: "There is no email address on that registration." }, 400);
  }

  const artwork = await loadArtwork(course);
  if (!artwork) {
    return json({
      error: `No certificate artwork found for this course. Expected ${SITE_URL}${templatePath(course)}`,
    }, 500);
  }

  const template = await loadTemplate(course);
  if (!template) {
    return json({ error: "No certificate email template is set up for this course." }, 500);
  }

  const layout = layoutFor(course);
  const nameFont = await loadNameFont();

  const focusText = course.type === "workshop"
    ? (course.workshop_focus ||
       String(course.title || "").replace(/^.*?Workshop\s*[\u2014-]\s*/i, "") ||
       "")
    : "";

  const awardedText = new Date(cert.awarded_on + "T12:00:00Z")
    .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const name = cert.participant_name || "Participant";

  const pdf = await buildPdf({
    artwork, layout, nameFont, name, awardedText,
    reference: cert.reference,
    focus: focusText,
  });

  const fields = {
    first_name: reg.first_name || "there",
    last_name: reg.last_name || "",
    full_name: name,
    course_title: course.title || "your course",
    awarded_on: awardedText,
    reference: cert.reference,
    site_url: SITE_URL,
  };

  // A short note in front of the original email, so it does not read
  // as though they have just completed the course all over again.
  const preamble =
`Hi ${reg.first_name || "there"},

Here is your certificate for ${course.title} again, as requested. It is the same certificate you were awarded on ${awardedText}, with the same reference — nothing has changed.

Worth saving somewhere you will find it. If you lose it again, just ask.

`;

  const ok = await sendEmail({
    to: reg.email,
    subject: `Your certificate for ${course.title}`,
    text: preamble + fill(template.body, fields),
    filename: `BirdBox certificate - ${name}.pdf`,
    pdf,
    brand: course.brand,
  });

  if (!ok) {
    return json({ error: "The email was rejected. Check the address." }, 502);
  }

  // Counted, because a third request from the same person is worth
  // noticing.
  await supabase.from("certificates").update({
    reissued_at: new Date().toISOString(),
    reissue_count: (cert.reissue_count || 0) + 1,
    last_reissued_by: me.id,
  }).eq("id", cert.id);

  return json({
    reissued: true,
    sentTo: reg.email,
    reference: cert.reference,
    name,
    times: (cert.reissue_count || 0) + 1,
  });
}

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth || !auth.user) return json({ error: "Not signed in" }, 401);

    const { courseId, certificateId } = await request.json();
    if (!courseId && !certificateId) {
      return json({ error: "No course or certificate given" }, 400);
    }

    // ---- who is asking ----------------------------------------
    const { data: me } = await supabase
      .from("staff")
      .select("id, full_name, role, active")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (!me || !me.active) return json({ error: "Not a member of staff" }, 403);

    // ---- a reissue --------------------------------------------
    // Somebody wrote in a year later having lost theirs. They get the
    // certificate they were awarded, not a new one — same reference,
    // same date, rebuilt from what was recorded at the time. A second
    // reference for the same course would make the record ambiguous.
    if (certificateId) {
      if (me.role !== "admin") {
        return json({ error: "Only an admin can reissue a certificate" }, 403);
      }
      return await reissue(certificateId, me);
    }

    const isAdmin = me.role === "admin";
    if (!isAdmin) {
      // course_staff is keyed on (course_id, staff_id) and has no id
      // column. Asking for one made the query fail, and the failure
      // was indistinguishable from not being the lead coach — so
      // every coach was refused and only an admin could send.
      const { data: lead, error: leadErr } = await supabase
        .from("course_staff")
        .select("role")
        .eq("course_id", courseId)
        .eq("staff_id", me.id)
        .eq("role", "lead_coach")
        .maybeSingle();

      // A lookup that could not run is a fault, not a refusal. Saying
      // so is the difference between a five-minute fix and an hour.
      if (leadErr) {
        console.error("Could not check the lead coach:", leadErr.message);
        return json({
          error: "Could not check who leads this course. This is a fault — try again.",
        }, 500);
      }

      if (!lead) return json({ error: "Only the lead coach or an admin can do this" }, 403);
    }

    // ---- the course -------------------------------------------
    const { data: course, error: cErr } = await supabase
      .from("courses")
      .select("id, brand, type, level, title, workshop_focus, starts_at, ends_at, timezone, completed_at, issues_certificate")
      .eq("id", courseId)
      .single();

    if (cErr || !course) return json({ error: "Course not found" }, 404);

    if (new Date(course.starts_at) > new Date()) {
      return json({ error: "This course has not run yet." }, 400);
    }

    // Some courses do not issue a certificate here. TCC Level 2 is the
    // case: it includes an online course, and the certificate is issued
    // by LearnWorlds once the exam is passed. The seminar still needs
    // closing out, so the button still works — it just records the
    // completion rather than generating anything.
    if (course.issues_certificate === false) {
      const { data: regs } = await supabase
        .from("registrations")
        .select("id, attended, status")
        .eq("course_id", courseId);

      const attended = (regs || []).filter(
        (r) => r.attended === true && (r.status || "active") === "active"
      );

      if (!attended.length) {
        return json({
          error: "Nobody is marked as attended yet. Tick attendance first, then submit.",
        }, 400);
      }

      if (!course.completed_at) {
        await supabase
          .from("courses")
          .update({ completed_at: new Date().toISOString(), completed_by: me.id })
          .eq("id", course.id);
      }

      return json({
        sent: 0,
        failed: 0,
        failures: [],
        skipped: 0,
        remaining: 0,
        completedOnly: true,
        attended: attended.length,
      });
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

    const outstanding = eligible.filter((r) => !r.certificate_sent_at);
    if (!outstanding.length) {
      return json({ error: "Everyone who attended already has their certificate." }, 400);
    }

    // Only as many as will comfortably finish inside the time limit.
    // The rest are picked up by the next call, which re-reads the
    // table and so cannot send to anyone already done.
    const todo = outstanding.slice(0, BATCH);

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

    const layout = layoutFor(course);

    // The name is set in the certificate's own face rather than a
    // system font. Fetched once for the whole batch: a twelve-person
    // seminar would otherwise pull it twelve times.
    const nameFont = await loadNameFont();

    // The workshop design has a box for what was actually coached.
    const focusText = course.type === "workshop"
      ? (course.workshop_focus ||
         String(course.title || "").replace(/^.*?Workshop\s*[\u2014-]\s*/i, "") ||
         "")
      : "";

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
          layout,
          nameFont,
          name,
          awardedText,
          reference,
          focus: focusText,
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
          brand: course.brand,
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

    // Anyone still without one, including any that failed just now —
    // a failure is not finished business.
    const remaining = outstanding.length - sent;

    // ---- mark the seminar closed out --------------------------
    // Only once nobody is left waiting. Marking it complete halfway
    // through would tell the rest of the portal the course is done
    // while certificates are still going out.
    if (sent && !remaining && !course.completed_at) {
      await supabase
        .from("courses")
        .update({ completed_at: new Date().toISOString(), completed_by: me.id })
        .eq("id", course.id);
    }

    return json({
      sent,
      failed: failures.length,
      failures,
      skipped: eligible.length - outstanding.length,
      remaining,
    });
  } catch (err) {
    console.error("certificates-send failed:", err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

// ---------------------------------------------------------------

// certificates/tcc-1, tgc-2, tgc-workshop and so on. Either extension
// works, so whoever uploads the artwork does not have to think about it.
function templateBase(course) {
  const brand = String(course.brand || "").toLowerCase();
  if (course.type === "workshop") return `/certificates/${brand}-workshop`;
  const level = String(course.level == null ? "" : course.level).replace(/\D/g, "");
  return `/certificates/${brand}-${level || "1"}`;
}

function templatePath(course) {
  return templateBase(course) + ".jpg or .png";
}

// A JPEG starts FF D8 FF; a PNG starts with an eight-byte signature.
// Reading the bytes rather than trusting the extension means a file
// saved with the wrong one still works.
function isPng(bytes) {
  return bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

async function loadArtwork(course) {
  const base = SITE_URL + templateBase(course);
  for (const ext of [".jpg", ".jpeg", ".png"]) {
    try {
      const res = await fetch(base + ext);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length) continue;
      return bytes;
    } catch (err) {
      console.error("Could not fetch artwork:", base + ext, err.message);
    }
  }
  console.error("No artwork found for", base);
  return null;
}

// certificates/name-font.ttf. Missing or unreadable, the certificate
// still generates in Helvetica Bold rather than failing — a plainer
// certificate is better than none.
async function loadNameFont() {
  try {
    const res = await fetch(SITE_URL + "/certificates/name-font.ttf");
    if (!res.ok) {
      console.warn("Name font not found; falling back to Helvetica Bold.");
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.warn("Could not fetch the name font:", err.message);
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

async function buildPdf({ artwork, layout, nameFont, name, awardedText, reference, focus }) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([PAGE.width, PAGE.height]);

  // PNG artwork is embedded losslessly and makes a much larger file, so
  // JPEG is preferable — but both are accepted rather than failing.
  const image = isPng(artwork)
    ? await doc.embedPng(artwork)
    : await doc.embedJpg(artwork);
  page.drawImage(image, { x: 0, y: 0, width: PAGE.width, height: PAGE.height });

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const plain = await doc.embedFont(StandardFonts.Helvetica);

  // subset: false keeps the whole character set, so an accented name
  // like Nürnberg or São Paulo does not come out as blanks.
  let display = bold;
  if (nameFont) {
    try {
      display = await doc.embedFont(nameFont, { subset: false });
    } catch (err) {
      console.warn("Could not embed the name font; using Helvetica Bold.", err.message);
    }
  }

  // Positions are in artwork pixels, converted here — so the numbers in
  // LAYOUTS can be read straight off the design.
  const scale = PAGE.width / layout.art.width;
  const toX = (px) => px * scale;
  const toY = (pxFromTop) => PAGE.height - pxFromTop * scale;

  // Shrinks until it fits, rather than running past the rule it sits on.
  const put = (text, spec, font, colour) => {
    if (!text || !spec) return;
    let size = spec.size * scale;
    const maxWidth = spec.maxWidth * scale;
    while (font.widthOfTextAtSize(text, size) > maxWidth && size > spec.min * scale) {
      size -= 1;
    }
    const width = font.widthOfTextAtSize(text, size);
    const x = spec.centreX != null
      ? toX(spec.centreX) - width / 2
      : toX(spec.rightX) - width;
    page.drawText(text, { x, y: toY(spec.baselineY), size, font, color: colour });
  };

  put(name, layout.name, display, rgb(0.05, 0.05, 0.05));
  put(focus, layout.focus, plain, rgb(0.1, 0.1, 0.1));
  put(awardedText, layout.awardedOn, plain, rgb(0.1, 0.1, 0.1));

  // Discreet, and clear of the corner graphics on both designs.
  const r = layout.reference;
  const refSize = r.size * scale;
  page.drawText(reference, {
    x: toX(r.rightX) - plain.widthOfTextAtSize(reference, refSize),
    y: toY(r.baselineY),
    size: refSize,
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

// The brand marks are black lettering on transparent, so they sit on
// a white band under the dark strip rather than on it. SITE_URL is
// already declared at the top of the file — an email cannot resolve a
// relative path, so the images need that absolute origin.
const BRAND_MARKS = {
  tcc:     { file: "tcc.png",     alt: "The Coaches Course" },
  tgc:     { file: "tgc.png",     alt: "The Gymnastics Course" },
  tec:     { file: "tec.png",     alt: "The Endurance Course" },
  twc:     { file: "twc.png",     alt: "The Weightlifting Course" },
  birdbox: { file: "birdBox.png", alt: "BirdBox Coaching" },
};

function brandMark(brand) {
  return BRAND_MARKS[String(brand || "").toLowerCase()] || BRAND_MARKS.birdbox;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// This email was going out as plain text only, so the section titles
// sat flat among the paragraphs and the whole thing read as a wall.
// The copy already carries its own structure — ALL CAPS lines are
// headings, hyphens are list items — so the formatting is read back
// out of it rather than asking anybody to rewrite the template.
function bodyToHtml(text) {
  const blocks = String(text).split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

    // A run of hyphens is a list, whatever surrounds it.
    if (lines.every((l) => /^[-•]\s+/.test(l))) {
      out.push(
        '<ul style="margin:0 0 16px;padding-left:1.2rem;font-size:16px;' +
        'line-height:1.65;color:#16181b">' +
        lines.map((l) =>
          `<li style="margin:0 0 6px">${escapeHtml(l.replace(/^[-•]\s+/, ""))}</li>`
        ).join("") +
        "</ul>"
      );
      continue;
    }

    for (const line of lines) {
      // A short line in capitals is a section title. Long ones are
      // sentences somebody happened to shout.
      const isHeading =
        line.length <= 60 &&
        /[A-Z]/.test(line) &&
        line === line.toUpperCase() &&
        !/^[-•]/.test(line);

      if (isHeading) {
        out.push(
          '<p style="margin:26px 0 8px;font-size:12px;letter-spacing:0.12em;' +
          'text-transform:uppercase;font-weight:700;color:#16181b">' +
          escapeHtml(line) + "</p>"
        );
        continue;
      }

      if (/^[-•]\s+/.test(line)) {
        out.push(
          '<p style="margin:0 0 6px 1.2rem;font-size:16px;line-height:1.65;' +
          'color:#16181b">' + escapeHtml(line.replace(/^[-•]\s+/, "")) + "</p>"
        );
        continue;
      }

      out.push(
        '<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#16181b">' +
        escapeHtml(line) + "</p>"
      );
    }
  }

  return out.join("");
}

function emailHtml(text, brand) {
  const mark = brandMark(brand);

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f3f0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f0">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:600px;background:#ffffff;border:1px solid #e0ddd7;border-radius:6px">
        <tr><td style="padding:14px 28px;background:#0d0e10;border-radius:5px 5px 0 0">
          <span style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#9aa1a9;
                       font-family:Helvetica,Arial,sans-serif">BirdBox Coaching</span>
        </td></tr>
        <tr><td align="left" style="padding:20px 28px;background:#ffffff;
                   border-bottom:1px solid #e0ddd7">
          <img src="${SITE_URL}/brand/${mark.file}" alt="${escapeHtml(mark.alt)}"
               height="46" style="height:46px;width:auto;display:block;border:0;outline:none;
               text-decoration:none;-ms-interpolation-mode:bicubic">
        </td></tr>
        <tr><td style="padding:28px;font-family:Helvetica,Arial,sans-serif">${bodyToHtml(text)}</td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #e0ddd7;
                       font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6c7178">
          BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendEmail({ to, subject, text, filename, pdf, brand }) {
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
        html: emailHtml(text, brand),
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
