// Load the SimpleCert certificates into past_certificates and their PDFs
// into the private past-certificates bucket (Nathan, 17 Nov 2026).
//
//   python3 -I scripts/simplecert-import/build.py data-private/simplecert
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/simplecert-import/load.mjs data-private/simplecert [--rows-only]
//
// Safe to run again: PDFs already uploaded are skipped (upsert: false and
// "already exists" counts as done), rows upsert on (source, source_id).

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] || "data-private/simplecert";
const rowsOnly = process.argv.includes("--rows-only");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rows = JSON.parse(fs.readFileSync(path.join(dir, "import.json"), "utf8"));

// 1. the PDFs, six at a time
let up = 0, skipped = 0, failed = [];
if (!rowsOnly) {
  const todo = rows.filter((r) => r.pdf_path);
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(todo.slice(i, i + 6).map(async (r) => {
      const [account, file] = r.pdf_path.split("/");
      const body = fs.readFileSync(path.join(dir, account, "pdfs", file));
      const { error } = await db.storage.from("past-certificates")
        .upload(r.pdf_path, body, { contentType: "application/pdf", upsert: false });
      if (!error) up++;
      else if (/exists|duplicate/i.test(error.message)) skipped++;
      else failed.push(`${r.pdf_path}: ${error.message}`);
    }));
    if ((i / 6) % 50 === 0) console.log(`pdfs ${i + 6}/${todo.length} (new ${up}, already there ${skipped}, failed ${failed.length})`);
  }
  console.log(`pdfs done: new ${up}, already there ${skipped}, failed ${failed.length}`);
  if (failed.length) console.log(failed.slice(0, 20).join("\n"));
}

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
  const { error } = await db.from("past_certificates").upsert(part, { onConflict: "source,source_id" });
  if (error) { console.error("rows failed at", i, error.message); process.exit(1); }
  n += part.length;
}
console.log(`rows done: ${n}`);
