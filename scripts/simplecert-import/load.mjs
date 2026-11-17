// Load the SimpleCert certificates into past_certificates and their PDFs
// into the private past-certificates bucket (Nathan, 17 Nov 2026).
// No packages needed: it talks to Supabase over plain HTTPS.
//
//   python3 -I scripts/simplecert-import/build.py data-private/simplecert
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/simplecert-import/load.mjs data-private/simplecert
//
// Safe to run again: PDFs already uploaded are skipped, and rows upsert
// on (source, source_id).

import fs from "node:fs";
import path from "node:path";

const URL_ = (process.env.SUPABASE_URL || "https://yvdmazpxtpuvidlcifnq.supabase.co").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("Set SUPABASE_SERVICE_ROLE_KEY first."); process.exit(1); }
const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const dir = process.argv[2] || "data-private/simplecert";
const rows = JSON.parse(fs.readFileSync(path.join(dir, "import.json"), "utf8"));

// 1. the PDFs, six at a time
let up = 0, skipped = 0;
const failed = [];
const todo = rows.filter((r) => r.pdf_path);
for (let i = 0; i < todo.length; i += 6) {
  await Promise.all(todo.slice(i, i + 6).map(async (r) => {
    const [account, file] = r.pdf_path.split("/");
    const body = fs.readFileSync(path.join(dir, account, "pdfs", file));
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${URL_}/storage/v1/object/past-certificates/${r.pdf_path}`, {
          method: "POST", headers: { ...auth, "Content-Type": "application/pdf", "x-upsert": "false" }, body,
        });
        if (res.ok) { up++; return; }
        const t = await res.text();
        if (/exists|duplicate/i.test(t)) { skipped++; return; }
        if (attempt === 3) failed.push(`${r.pdf_path}: ${res.status} ${t.slice(0, 120)}`);
      } catch (e) {
        if (attempt === 3) failed.push(`${r.pdf_path}: ${e.message}`);
      }
    }
  }));
  if (i % 600 === 0) console.log(`PDFs ${Math.min(i + 6, todo.length)} of ${todo.length} (new ${up}, already there ${skipped}, failed ${failed.length})`);
}
console.log(`PDFs done: new ${up}, already there ${skipped}, failed ${failed.length}`);
if (failed.length) console.log(failed.slice(0, 20).join("\n"));

// 2. the rows, 500 at a time; a row only points at a PDF that is there
const bad = new Set(failed.map((f) => f.split(":")[0]));
const cols = ["source", "source_id", "email", "participant_name", "brand", "level", "kind",
  "awarded_on", "printed_date", "batch_title", "sent_status", "pdf_path"];
let n = 0;
for (let i = 0; i < rows.length; i += 500) {
  const part = rows.slice(i, i + 500).map((r) => {
    const o = Object.fromEntries(cols.map((c) => [c, r[c] ?? null]));
    if (o.pdf_path && bad.has(o.pdf_path)) o.pdf_path = null;
    return o;
  });
  const res = await fetch(`${URL_}/rest/v1/past_certificates?on_conflict=source,source_id`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(part),
  });
  if (!res.ok) { console.error("Rows failed at", i, res.status, await res.text()); process.exit(1); }
  n += part.length;
}
console.log(`Rows done: ${n}. All finished.`);
