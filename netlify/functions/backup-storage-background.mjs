// netlify/functions/backup-storage-background.mjs
//
// The files the database only points at: signed waivers, coach invoices,
// participant photos, manuals, blog images. The nightly database
// snapshot holds the rows; without this the rows point at nothing.
//
// One bucket per invocation. Doing all seven in one go ran out of
// memory partway through `manuals` — each file is held whole in memory
// before uploading, and 60 MB of PDFs was past what a function will
// carry. Per bucket it never holds more than that bucket's worth, and
// a bucket that fails cannot stop the others.
//
// Incremental within a bucket: it lists what B2 already holds and
// uploads only what is missing. Nothing is ever deleted from B2, so a
// file removed from Supabase stays archived — the point of an archive.
//
// Runs weekly, one bucket per day so no two land together.
//   ?bucket=manuals      one named bucket
//   ?key=<BACKUP_TOKEN>  needed when calling by hand

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

const BUCKETS = [
  "blog", "coach-invoices", "course-images", "manuals",
  "participant-photos", "staff-documents", "staff-photos",
];

// Which bucket a scheduled run takes, by day of the week. Sunday is
// index 0, so the order below is Sunday through Saturday.
const BY_DAY = [
  "blog", "coach-invoices", "course-images", "manuals",
  "participant-photos", "staff-documents", "staff-photos",
];

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

// One signer for every request, so GET and PUT cannot drift apart.
async function signedFetch(method, path, query, body, contentType) {
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = stamp.slice(0, 8);
  const host = `${B2_BUCKET}.${B2_ENDPOINT}`;
  const payloadHash = body ? await sha256Hex(body) : await sha256Hex(new Uint8Array());

  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };
  if (contentType) headers["content-type"] = contentType;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}`).join("\n");
  const signedHeaders = names.join(";");

  const canonical = [
    method, path, query, canonicalHeaders, "", signedHeaders, payloadHash,
  ].join("\n");

  const scope = `${date}/${B2_REGION}/s3/aws4_request`;
  const toSign = [
    "AWS4-HMAC-SHA256", stamp, scope,
    await sha256Hex(enc.encode(canonical)),
  ].join("\n");

  let signing = await hmac(enc.encode("AWS4" + B2_APP_KEY), date);
  signing = await hmac(signing, B2_REGION);
  signing = await hmac(signing, "s3");
  signing = await hmac(signing, "aws4_request");
  const sigBytes = await hmac(signing, toSign);
  const signature = [...sigBytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  const fetchHeaders = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${B2_KEY_ID}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType) fetchHeaders["Content-Type"] = contentType;

  return fetch(`https://${host}${path}${query ? "?" + query : ""}`, {
    method, headers: fetchHeaders, body,
  });
}

// What is already archived for this bucket, so nothing copies twice.
async function alreadyStored(bucket) {
  const have = new Set();
  let token = null;
  const prefix = encodeURIComponent(`storage/${bucket}/`);

  do {
    const params = ["list-type=2", "max-keys=1000", `prefix=${prefix}`];
    if (token) params.push("continuation-token=" + encodeURIComponent(token));
    params.sort();

    const res = await signedFetch("GET", "/", params.join("&"), null, null);
    if (!res.ok) throw new Error(`Could not list B2 (${res.status}): ${await res.text()}`);

    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) have.add(m[1]);

    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    token = next ? next[1] : null;
  } while (token);

  return have;
}

// Supabase lists one folder at a time, so this walks down into them.
async function listBucket(bucket, prefix = "") {
  const out = [];
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new Error(error.message);

  for (const entry of data || []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    // A row with no id is a folder, not a file.
    if (!entry.id) out.push(...await listBucket(bucket, path));
    else out.push({ path, size: entry.metadata?.size ?? 0 });
  }
  return out;
}

async function sendReport(subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("No Resend key; no storage backup email sent."); return false; }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `BirdBox Backups <${FROM}>`,
      to: [TO], subject, text,
    }),
  });

  if (!res.ok) { console.error("Resend rejected the storage email:", await res.text()); return false; }
  return true;
}

export default async (request) => {
  const url = new URL(request.url);
  const byHand = url.searchParams.has("key");
  if (byHand && url.searchParams.get("key") !== process.env.BACKUP_TOKEN) {
    return new Response("no", { status: 401 });
  }

  // Named bucket, or the one whose turn it is today.
  const asked = url.searchParams.get("bucket");
  const bucket = asked || BY_DAY[new Date().getUTCDay()];

  if (!BUCKETS.includes(bucket)) {
    return new Response(
      JSON.stringify({ error: `Unknown bucket "${bucket}".`, known: BUCKETS }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const started = new Date();
  const day = started.toISOString().slice(0, 10);
  const problems = [];

  let have, files;
  try {
    have = await alreadyStored(bucket);
    files = await listBucket(bucket);
  } catch (err) {
    await sendReport(
      `PROBLEM — BirdBox storage backup: ${bucket}`,
      `Could not start on ${bucket}, so nothing was copied from it.\n\n${err.message}`
    );
    return new Response(JSON.stringify({ bucket, error: err.message }), { status: 500 });
  }

  let copied = 0, copiedBytes = 0, skipped = 0;

  for (const file of files) {
    const key = `storage/${bucket}/${file.path}`;
    if (have.has(key)) { skipped++; continue; }

    try {
      const { data, error } = await supabase.storage.from(bucket).download(file.path);
      if (error) throw new Error(error.message);

      const bytes = new Uint8Array(await data.arrayBuffer());
      const res = await signedFetch(
        "PUT",
        "/" + key.split("/").map(encodeURIComponent).join("/"),
        "",
        bytes,
        data.type || "application/octet-stream"
      );
      if (!res.ok) throw new Error(`B2 refused it (${res.status})`);

      copied++;
      copiedBytes += bytes.length;
    } catch (err) {
      problems.push(`${file.path} — ${err.message}`);
    }
  }

  const mb = (copiedBytes / 1048576).toFixed(1);
  const subject = problems.length
    ? `PROBLEM — BirdBox storage backup: ${bucket}`
    : `BirdBox storage backup: ${bucket} — ${copied} new`;

  const lines = [
    `Bucket "${bucket}", swept ${started.toISOString()}.`,
    "",
    `${files.length} file${files.length === 1 ? "" : "s"} in the bucket.`,
    `${copied} newly copied, ${mb} MB.`,
    `${skipped} already archived.`,
    "",
    problems.length ? "Problems:" : "No problems.",
    ...problems.slice(0, 30).map((p) => "  " + p),
    problems.length > 30 ? `  …and ${problems.length - 30} more` : "",
    "",
    `Archived under storage/${bucket}/ in Backblaze.`,
  ].filter((l) => l !== "");

  const emailed = await sendReport(subject, lines.join("\n"));

  return new Response(JSON.stringify({
    bucket, day, total: files.length, copied, skipped, mb, problems, emailed,
  }, null, 2), { headers: { "Content-Type": "application/json" } });
};

export const config = {
  schedule: "0 3 * * *",
};
