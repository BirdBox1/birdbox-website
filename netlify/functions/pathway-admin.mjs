// netlify/functions/pathway-admin.mjs
//
// The review side of the Staff Pathway, for /portal/staff-pathway/.
// Admins only.
//
// GET                                          -> { applications: [...] }
// POST { action: "status", id, status }        reviewing / interview / withdrawn
// POST { action: "notes", id, notes }          private notes, never sent
// POST { action: "decide", id, outcome, message, video? }
//                                              accepted or declined; the applicant
//                                              is emailed the message (and the
//                                              feedback video link, if there is one)
// POST { action: "delete", id }
// POST { action: "seen" }                      clears the "new" marks
//
// Uploaded files (movement videos, CV, coaching philosophy) come back as
// links that work for six hours.
//
// Each application comes back with the courses we have a certificate for
// under that email, so the "completed TGC" claim can be checked at a glance.

import { db, json, OFFICE, userFrom, sendMail, esc } from "../lib/directory.mjs";
import { PATHWAYS, BUCKET, REAPPLY_MONTHS, reapplyFrom } from "../lib/pathway.mjs";
import { NATHAN_SIGNATURE_HTML, NATHAN_SIGNATURE_TEXT } from "../lib/signature.mjs";

const URL_RE = /^https:\/\/[^\s<>"]+\.[^\s<>"]+$/i;
const BRAND_NAME = { tgc: "The Gymnastics Course", tcc: "The Coaches Course", tec: "The Endurance Course", twc: "The Weightlifting Course" };

export default async (req) => {
  const user = await userFrom(req);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const { data: staff } = await db.from("staff").select("id, role, active").eq("id", user.id).maybeSingle();
  if (!staff || !staff.active || staff.role !== "admin") return json({ error: "Admins only." }, 403);

  try {
    if (req.method === "GET") {
      await sweepLeftovers().catch((e) => console.warn("pathway sweep:", e.message || e));
      return json({ applications: await everything(), pathways: pathwaysForAdmin() });
    }
    if (req.method !== "POST") return json({ error: "Use GET or POST" }, 405);

    const b = await req.json().catch(() => ({}));
    const id = String(b.id || "");
    const now = new Date().toISOString();
    const table = () => db.from("staff_pathway_applications");

    switch (b.action) {
      case "status": {
        if (!["new", "reviewing", "interview", "withdrawn"].includes(b.status)) return json({ error: "Unknown status." }, 400);
        await table().update({ status: b.status }).eq("id", id);
        break;
      }
      case "notes":
        await table().update({ notes: String(b.notes || "").slice(0, 6000) || null }).eq("id", id);
        break;
      case "decide": {
        if (!["accepted", "declined"].includes(b.outcome)) return json({ error: "Accept or decline." }, 400);
        const message = String(b.message || "").replace(/\r/g, "").trim().slice(0, 6000);
        const video = String(b.video || "").trim();
        if (message.length < 20) return json({ error: "Write the message to send them." }, 400);
        if (video && !URL_RE.test(video)) return json({ error: "The video link must start with https://." }, 400);
        const { data: a } = await table().select("id, brand, full_name, email").eq("id", id).maybeSingle();
        if (!a) return json({ error: "Not found." }, 404);
        const sent = await tellDecision(a, b.outcome, message, video || null);
        if (!sent) return json({ error: "The email did not send, so nothing was changed. Try again." }, 502);
        await table().update({
          status: b.outcome, decision_message: message, decision_video: video || null,
          decided_at: now, decided_by: user.id,
        }).eq("id", id);
        break;
      }
      case "delete": {
        // The application's uploaded videos and documents go with it.
        const { data: ups } = await db.from("staff_pathway_uploads").select("path").eq("application_id", id);
        const paths = (ups || []).map((u) => u.path);
        if (paths.length) {
          const { error: rmErr } = await db.storage.from(BUCKET).remove(paths);
          if (rmErr) throw rmErr;
          await db.from("staff_pathway_uploads").delete().in("path", paths);
        }
        await table().delete().eq("id", id);
        break;
      }
      case "seen":
        await table().update({ seen_at: now }).is("seen_at", null);
        break;
      default:
        return json({ error: "Unknown action." }, 400);
    }
    return json({ ok: true, applications: await everything() });
  } catch (err) {
    console.error("pathway-admin:", err.message || err);
    return json({ error: "That did not work: " + (err.message || err) }, 500);
  }
};

async function everything() {
  const { data, error } = await db.from("staff_pathway_applications").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const apps = data || [];
  const emails = [...new Set(apps.map((a) => a.email))];
  const certs = new Map();
  for (let i = 0; i < emails.length; i += 200) {
    const { data: rows } = await db.from("directory_qualifications")
      .select("email, brand, level, kind, awarded_on, place, course_title").in("email", emails.slice(i, i + 200));
    for (const r of rows || []) {
      if (!certs.has(r.email)) certs.set(r.email, []);
      certs.get(r.email).push(r);
    }
  }
  const paths = apps.flatMap((a) => [a.cv_path, a.philosophy_path, ...(a.movement_videos || []).map((m) => m.path)]).filter(Boolean);
  const view = new Map();
  for (let i = 0; i < paths.length; i += 100) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 100), 6 * 3600);
    for (const x of signed || []) if (!x.error) view.set(x.path, x.signedUrl);
  }

  // Earlier applications from the same person, so a reapplication shows
  // what we told them last time.
  // The same person under a different email: a matching name or phone
  // on another application.
  const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const digits = (v) => String(v || "").replace(/\D/g, "").slice(-9);
  const lookalikes = (a) => apps.filter((o) => o.id !== a.id && o.email !== a.email && (
    (norm(o.full_name) && norm(o.full_name) === norm(a.full_name)) ||
    (digits(a.phone).length >= 7 && digits(o.phone) === digits(a.phone))
  )).map((o) => ({ full_name: o.full_name, email: o.email, brand: o.brand, status: o.status, created_at: o.created_at }));

  return apps.map((a) => ({
    ...a,
    lookalikes: lookalikes(a),
    cv_url: view.get(a.cv_path) || null,
    philosophy_url: view.get(a.philosophy_path) || null,
    movement_videos: (a.movement_videos || []).map((m) => ({ ...m, view: m.path ? view.get(m.path) || null : m.url, uploaded: !!m.path })),
    certificates: (certs.get(a.email) || []).sort((x, y) => String(y.awarded_on).localeCompare(String(x.awarded_on))),
    earlier: apps.filter((o) => o.email === a.email && o.brand === a.brand && o.created_at < a.created_at)
      .map((o) => ({ created_at: o.created_at, status: o.status, decision_message: o.decision_message })),
  }));
}

function tellDecision(a, outcome, message, video) {
  const first = a.full_name.split(" ")[0];
  const short = a.brand.toUpperCase();
  const accepted = outcome === "accepted";
  const again = accepted ? "" : reapplyFrom(new Date()).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const tec = a.brand === "tec";
  const subject = tec
    ? (accepted ? "Joining the TEC founding team" : "Your TEC founding staff application")
    : (accepted ? `Your place on the ${short} Staff Pathway` : `Your ${short} Staff Pathway application: our feedback`);
  const close = accepted
    ? (tec ? "We will be in touch to arrange the next step." : "We will be in touch with your agreement and payment options next.")
    : `You are welcome to apply again from ${again} (${REAPPLY_MONTHS} months from now).`;
  return sendMail({
    to: a.email,
    replyTo: OFFICE,
    subject,
    text: `Hi ${first},\n\n${message}${video ? `\n\nYour feedback video: ${video}` : ""}\n\n${close}${NATHAN_SIGNATURE_TEXT}`,
    html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#16181b;max-width:560px">
<p>Hi ${esc(first)},</p>
<div style="white-space:pre-line">${esc(message)}</div>
${video ? `<p style="margin:18px 0"><a href="${esc(video)}" style="display:inline-block;background:#85151A;color:#fff;text-decoration:none;font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:13px;padding:11px 20px">Watch your feedback</a></p>` : ""}
<p>${esc(close)}</p>
${NATHAN_SIGNATURE_HTML}
</div>`,
  });
}

// What the review page needs to know about each course: its name, and
// for TEC the regional targets. Admin only, so the targets stay private.
function pathwaysForAdmin() {
  return Object.fromEntries(Object.entries(PATHWAYS).map(([k, p]) => [k, { short: p.short, title: p.title, targets: p.targets || null }]));
}

// Files nobody's application uses any more: uploads from forms that
// were started but never sent, and files left behind by an application
// deleted before deletes removed them. Two days gives anyone still
// filling in the form time to send it.
async function sweepLeftovers() {
  const cutoff = new Date(Date.now() - 2 * 86400e3).toISOString();
  const { data: old } = await db.from("staff_pathway_uploads").select("path")
    .is("application_id", null).lt("created_at", cutoff).limit(200);
  const paths = (old || []).map((u) => u.path);
  if (!paths.length) return;
  const { error } = await db.storage.from(BUCKET).remove(paths);
  if (error) throw error;
  await db.from("staff_pathway_uploads").delete().in("path", paths);
}
