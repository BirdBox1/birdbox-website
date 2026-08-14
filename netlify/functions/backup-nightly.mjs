// netlify/functions/backup-nightly.mjs
//
// A nightly snapshot of the whole database, written to Backblaze B2 and
// emailed to the office.
//
// Two copies on purpose. B2 is the real archive; the email is the one
// that turns up whether or not anybody remembers B2 exists. If the B2
// upload fails the email still goes, and says so in the subject — a
// backup that stops working quietly is worse than none at all, because
// you only find out on the day you need it.
//
// Runs on the schedule at the foot of this file. Can also be called by
// hand with ?key=<BACKUP_TOKEN> to test it.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const B2_KEY_ID = process.env.B2_KEY_ID;
const B2_APP_KEY = process.env.B2_APP_KEY;
const B2_BUCKET = "birdbox-backups";
const B2_ENDPOINT = "s3.eu-central-003.backblazeb2.com";
const B2_REGION = "eu-central-003";

const TO = "info@birdboxcoaching.com";
const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";

// Every table in the database, checked against information_schema
// rather than remembered. A table missing from here is a table with
// no backup, so this list is worth re-checking whenever one is added.
const TABLES = [
  "abandoned_checkouts", "blog_posts", "certificates",
  "coach_invoice_receipts", "coach_invoices", "coach_notifications",
  "course_archives", "course_emails", "course_messages", "course_prices",
  "course_staff", "course_templates", "courses", "direct_messages",
  "discount_codes", "drip_emails", "drip_enrollments", "drip_sends",
  "email_block_translations", "email_blocks", "email_enrolments",
  "email_sends", "email_sequence_steps", "email_sequences",
  "email_signups", "email_templates", "feedback_drafts",
  "feedback_manuals", "interest_signups", "learnworlds_products",
  "manuals", "participant_notes", "payments", "programming_applications",
  "reflection_replies", "reflections", "registrations", "staff",
  "staff_documents", "testimonials", "vat_rates", "workshop_requests",
  "workshop_templates",
];

// Read in pages. A single select would quietly stop at the row limit,
// and a backup that silently truncates is the worst kind.
async function dumpTable(name) {
  const rows = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from(name)
      .select("*")
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return rows;
}

// ---- Backblaze, via the S3-compatible API ----------------------

const enc = new TextEncoder();

async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key, text) {
  const k = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
}

// AWS Signature v4. Long-winded but it is only arithmetic, and it
// avoids pulling in an SDK for one PUT a night.
async function uploadToB2(key, body, contentType) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = stamp.slice(0, 8);
  const host = `${B2_BUCKET}.${B2_ENDPOINT}`;
  const payloadHash = await sha256Hex(body);

  const canonical = [
    "PUT",
    `/${key}`,
    "",
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${stamp}`,
    "",
    "content-type;host;x-amz-content-sha256;x-amz-date",
    payloadHash,
  ].join("\n");

  const scope = `${date}/${B2_REGION}/s3/aws4_request`;
  const toSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    await sha256Hex(enc.encode(canonical)),
  ].join("\n");

  let signing = await hmac(enc.encode("AWS4" + B2_APP_KEY), date);
  signing = await hmac(signing, B2_REGION);
  signing = await hmac(signing, "s3");
  signing = await hmac(signing, "aws4_request");
  const sigBytes = await hmac(signing, toSign);
  const signature = [...sigBytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  const res = await fetch(`https://${host}/${key}`, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": stamp,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${B2_KEY_ID}/${scope}, ` +
        "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, " +
        `Signature=${signature}`,
    },
    body,
  });

  if (!res.ok) throw new Error(`B2 refused it (${res.status}): ${await res.text()}`);
  return true;
}

// ---- the email -------------------------------------------------

async function sendReport({ subject, text, attachment, filename }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("No Resend key; no backup email sent."); return false; }

  const payload = {
    from: `BirdBox Backups <${FROM}>`,
    to: [TO],
    subject,
    text,
  };
  if (attachment) {
    payload.attachments = [{ filename, content: attachment }];
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) { console.error("Resend rejected the backup email:", await res.text()); return false; }
  return true;
}

// ---- the job ---------------------------------------------------

export default async (request) => {
  // Called by hand rather than by the schedule: needs the token.
  const url = new URL(request.url);
  const byHand = url.searchParams.has("key");
  if (byHand && url.searchParams.get("key") !== process.env.BACKUP_TOKEN) {
    return new Response("no", { status: 401 });
  }

  const started = new Date();
  const day = started.toISOString().slice(0, 10);
  const snapshot = { taken_at: started.toISOString(), tables: {} };
  const counts = [];
  const problems = [];

  for (const table of TABLES) {
    try {
      const rows = await dumpTable(table);
      snapshot.tables[table] = rows;
      counts.push(`${table}: ${rows.length}`);
    } catch (err) {
      problems.push(`${table} — ${err.message}`);
      snapshot.tables[table] = { error: err.message };
    }
  }

  const json = JSON.stringify(snapshot);
  const bytes = enc.encode(json);
  const filename = `birdbox-${day}.json`;

  let stored = false;
  let storeError = null;
  try {
    await uploadToB2(`snapshots/${filename}`, bytes, "application/json");
    stored = true;
  } catch (err) {
    storeError = err.message;
  }

  const totalRows = Object.values(snapshot.tables)
    .filter(Array.isArray).reduce((n, r) => n + r.length, 0);

  const kb = Math.round(bytes.length / 1024);
  const trouble = !stored || problems.length;

  const subject = trouble
    ? `PROBLEM — BirdBox backup ${day}`
    : `BirdBox backup ${day} — ${totalRows} rows`;

  const lines = [
    `Snapshot taken ${started.toISOString()}.`,
    "",
    `${totalRows} rows across ${TABLES.length} tables, ${kb} KB.`,
    stored
      ? `Stored in Backblaze as snapshots/${filename}.`
      : `NOT STORED IN BACKBLAZE — ${storeError}`,
    "",
    problems.length ? "Tables that failed to read:" : "Every table read cleanly.",
    ...problems.map((p) => "  " + p),
    "",
    "Row counts:",
    ...counts.map((c) => "  " + c),
    "",
    "The attached file is the full snapshot. Keep it somewhere sensible —",
    "it contains participant names, emails and payment records.",
  ];

  // Base64 for the attachment. Chunked, because spreading a megabyte
  // of bytes into one call blows the argument limit.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const b64 = btoa(binary);

  const emailed = await sendReport({
    subject,
    text: lines.join("\n"),
    attachment: b64,
    filename,
  });

  return new Response(JSON.stringify({
    day, totalRows, kb, stored, storeError, problems, emailed,
  }, null, 2), { headers: { "Content-Type": "application/json" } });
};

export const config = {
  schedule: "0 2 * * *",
};
