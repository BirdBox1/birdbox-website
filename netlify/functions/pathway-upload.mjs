// netlify/functions/pathway-upload.mjs
//
// POST { kind: "video" | "doc", type, size } -> { path, url }
//
// An upload link for one file on the Staff Pathway application: a movement
// video, the CV, or the coaching philosophy. The browser sends the file
// straight to storage with the link (a PUT), so large videos never pass
// through here, and puts the returned path in the application.
//
// Applicants have no account, so every link handed out is recorded:
// pathway-apply only accepts paths from this list, and one network gets
// a limited number of links a day.

import { createHash, randomUUID } from "node:crypto";
import { db, json, OFFICE } from "../lib/directory.mjs";
import { BUCKET, UPLOADS } from "../lib/pathway.mjs";

const PER_DAY = 60;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const b = await req.json().catch(() => ({}));
  const rule = UPLOADS[b.kind];
  if (!rule) return json({ error: "Unknown file." }, 400);
  const ext = rule.types[String(b.type || "").toLowerCase()];
  if (!ext) {
    return json({ error: b.kind === "video"
      ? "That file is not a video we can take. Use MP4 or MOV (the normal format from a phone)."
      : "Upload a PDF or Word document." }, 400);
  }
  const size = Number(b.size) || 0;
  if (size <= 0) return json({ error: "That file is empty." }, 400);
  if (size > rule.max) {
    const mb = Math.round(rule.max / 1024 / 1024);
    return json({ error: b.kind === "video"
      ? `That video is over ${mb}MB. Trim it to the reps we need, or paste a link instead.`
      : `That document is over ${mb}MB.` }, 400);
  }

  try {
    const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const ip_hash = ip ? createHash("sha256").update(ip + (process.env.SUPABASE_SERVICE_ROLE_KEY || "")).digest("hex").slice(0, 32) : null;
    if (ip_hash) {
      const dayAgo = new Date(Date.now() - 86400e3).toISOString();
      const { count } = await db.from("staff_pathway_uploads").select("path", { count: "exact", head: true })
        .eq("ip_hash", ip_hash).gte("created_at", dayAgo);
      if ((count || 0) >= PER_DAY) return json({ error: `Too many uploads from here today. Paste links instead, or write to ${OFFICE}.` }, 429);
    }

    const path = `${new Date().toISOString().slice(0, 7)}/${b.kind}/${randomUUID()}.${ext}`;
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw error;
    const { error: e2 } = await db.from("staff_pathway_uploads").insert({ path, ip_hash });
    if (e2) throw e2;
    return json({ path, url: data.signedUrl });
  } catch (err) {
    console.error("pathway-upload:", err.message || err);
    return json({ error: "The upload could not start. Try again, or paste a link instead." }, 500);
  }
};
