// netlify/functions/document-share.mjs
//
// Copies one of your documents into a colleague's folder.
//
//   POST { documentId, toStaffId }
//
// It has to run here rather than in the browser. The storage policies
// only let somebody write into a folder named after their own id,
// which is exactly what keeps the folder private — so a coach cannot
// upload into a colleague's folder, and should not be able to.
//
// The recipient gets their own copy: their file, their row, theirs to
// rename or delete. Nothing is shared in the sense of one file two
// people can reach, because that would mean either of them deleting it
// out from under the other.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const BUCKET = "staff-documents";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const sender = await requireStaff(req);
    if (!sender) return json({ error: "Not authorised" }, 401);

    const { documentId, toStaffId } = await req.json();
    if (!documentId || !toStaffId) return json({ error: "Missing document or recipient" }, 400);
    if (toStaffId === sender.id) return json({ error: "That is your own folder." }, 400);

    // Yours to send. The service role ignores the policies, so this
    // check is the thing standing between a document id and anybody
    // who guesses one.
    const { data: doc } = await supabase
      .from("staff_documents")
      .select("id, staff_id, title, note, file_path, file_name, mime_type, size_bytes")
      .eq("id", documentId)
      .maybeSingle();

    if (!doc) return json({ error: "That document could not be found." }, 404);
    if (doc.staff_id !== sender.id) {
      return json({ error: "That is not your document to send." }, 403);
    }

    const { data: to } = await supabase
      .from("staff")
      .select("id, full_name, active")
      .eq("id", toStaffId)
      .maybeSingle();

    if (!to || !to.active) return json({ error: "That person is not on the team." }, 404);

    // Download and re-upload under their id, because the path is what
    // the storage policy reads to decide whose file it is.
    const { data: blob, error: dlErr } = await supabase.storage
      .from(BUCKET).download(doc.file_path);

    if (dlErr || !blob) {
      console.error("Could not read the file:", dlErr && dlErr.message);
      return json({ error: "The file itself could not be read." }, 500);
    }

    const clean = String(doc.file_name || "document")
      .replace(/[^\w.\-]+/g, "-").slice(-80);
    const path = `${to.id}/${Date.now()}-${clean}`;

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(
      path,
      Buffer.from(await blob.arrayBuffer()),
      { contentType: doc.mime_type || "application/octet-stream", upsert: false }
    );

    if (upErr) {
      console.error("Could not write the copy:", upErr.message);
      return json({ error: "The copy could not be saved." }, 500);
    }

    const { error: rowErr } = await supabase.from("staff_documents").insert({
      staff_id: to.id,
      title: doc.title,
      note: doc.note,
      file_path: path,
      file_name: doc.file_name,
      mime_type: doc.mime_type,
      size_bytes: doc.size_bytes,
      received_from: sender.id,
      received_at: new Date().toISOString(),
    });

    // The row failed but the file is already there, and nothing points
    // at it. Take it back out rather than leaving it in the bucket.
    if (rowErr) {
      await supabase.storage.from(BUCKET).remove([path]);
      console.error("Could not record the copy:", rowErr.message);
      return json({ error: "The copy could not be recorded." }, 500);
    }

    return json({ ok: true, sentTo: to.full_name });
  } catch (err) {
    console.error("document-share failed:", err);
    return json({ error: err.message || "Something went wrong" }, 500);
  }
};

async function requireStaff(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: staff } = await supabase
    .from("staff").select("id, full_name, active")
    .eq("id", data.user.id).maybeSingle();

  if (!staff || !staff.active) return null;
  return staff;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
