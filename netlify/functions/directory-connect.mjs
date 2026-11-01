// netlify/functions/directory-connect.mjs
//
// Coach-to-coach Connect (Nathan, 1 Nov 2026): BirdBox coaches find and
// message each other from the Trainer Directory tab in BirdBox Learn.
// Signed in with the Learn login (Authorization: Bearer <token>).
//
// GET  ?near&brand=tgc&online=1&from=0  -> { coaches, more, me }
//      live coaches who take Connect messages, nearest first, 20 at a time;
//      &lat=&lng= measures from a place they searched for instead of their
//      own listing (travelling, on holiday), Nathan, 1 Nov 2026
// POST { slug, message }                 -> { ok }
//
// Only a coach whose own listing is live can use it, and only coaches who
// leave "Let other BirdBox coaches contact me" on can be found or messaged.
// The message is emailed straight away, marked as from a BirdBox coach,
// with a link to the sender's listing; the reply goes to the sender. It is
// kept with the contact requests (looking_for "coach"), so the report link
// and the counts work as for any request. No email or phone is shown.
// Limits: 5 a day, one a day to the same coach, no links.

import {
  db, json, userFrom, PROFILE_FIELDS, qualificationsFor, statusOf, publicProfile, readAll,
  sendMail, esc, SITE_URL,
} from "../lib/directory.mjs";
import { sign } from "./directory-contact.mjs";

const PAGE = 20;
const PER_DAY = 5;
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|ai|app|info|biz|me|ly|gg|link|site|online|store|shop)\b|[^@\s]+@[^@\s]+\.[a-z]{2,})/i;

async function myListing(user) {
  const email = String(user.email || "").toLowerCase();
  let { data: p } = await db.from("directory_profiles").select(PROFILE_FIELDS).eq("user_id", user.id).maybeSingle();
  if (!p) ({ data: p } = await db.from("directory_profiles").select(PROFILE_FIELDS).ilike("email", email).limit(1).maybeSingle());
  if (!p || !p.visible || p.hidden_at) return null;
  const quals = (await qualificationsFor([p])).get(p.id);
  return statusOf(p, quals) === "live" ? p : null;
}

const km = (a, b) => {
  if (a.lat == null || b.lat == null) return null;
  const r = (d) => d * Math.PI / 180;
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
};

export default async (req) => {
  const user = await userFrom(req);
  if (!user) return json({ error: "Please log in again." }, 401);
  try {
    const me = await myListing(user);
    if (!me) return json({ error: "Connect opens once your own listing is live in the Trainer Directory.", not_live: true }, 403);
    if (req.method === "GET") return near(me, new URL(req.url).searchParams);
    if (req.method === "POST") return connect(me, await req.json().catch(() => ({})));
    return json({ error: "Use GET or POST" }, 405);
  } catch (e) {
    console.error("directory-connect:", e.message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};

async function near(me, q) {
  const brand = String(q.get("brand") || "").toLowerCase();
  const online = q.get("online") === "1";
  const from = Math.max(0, parseInt(q.get("from") || "0", 10) || 0);
  const profiles = await readAll(() => db.from("directory_profiles").select(PROFILE_FIELDS)
    .eq("visible", true).is("hidden_at", null).eq("coach_connect", true).neq("id", me.id).order("id"));
  const quals = await qualificationsFor(profiles);
  const lat = parseFloat(q.get("lat")), lng = parseFloat(q.get("lng"));
  const searched = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const here = searched ? { lat, lng }
    : { lat: me.latitude == null ? null : Number(me.latitude), lng: me.longitude == null ? null : Number(me.longitude) };
  let list = profiles.filter((p) => statusOf(p, quals.get(p.id)) === "live")
    .map((p) => publicProfile(p, quals.get(p.id)))
    .filter((c) => (!brand || c.courses.some((x) => x.brand === brand)) && (!online || c.online))
    .map((c) => ({ ...c, km: km(here, c) }));
  // nearest first; coaches with no location after, by name
  list.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9) || String(a.name).localeCompare(String(b.name)));
  const page = list.slice(from, from + PAGE).map(({ bio, instagram, website, facebook, twitter, linkedin, lat, lng, ...c }) =>
    ({ ...c, km: c.km == null ? null : Math.round(c.km), url: `${SITE_URL}/trainer-directory/coach/${encodeURIComponent(c.slug)}` }));
  return json({ coaches: page, more: list.length > from + PAGE, total: list.length, located: here.lat != null });
}

async function connect(me, b) {
  const message = String(b.message || "").replace(/\r/g, "").trim().slice(0, 1000);
  if (message.length < 15) return json({ error: "Say a little more: hello, and what you would like to talk about." }, 400);
  if (LINK_RE.test(message)) return json({ error: "Please leave links and email addresses out. They get your email when you hear back." }, 400);

  const { data: to } = await db.from("directory_profiles").select(PROFILE_FIELDS)
    .eq("slug", String(b.slug || "").toLowerCase()).eq("visible", true).is("hidden_at", null).maybeSingle();
  if (!to || to.id === me.id || to.coach_connect === false) return json({ error: "That coach cannot be messaged here." }, 404);
  if (statusOf(to, (await qualificationsFor([to])).get(to.id)) !== "live") return json({ error: "That coach cannot be messaged here." }, 404);

  const email = String(me.public_email || me.email || "").toLowerCase();
  const dayAgo = new Date(Date.now() - 86400e3).toISOString();
  const { data: today } = await db.from("directory_contact_requests").select("profile_id")
    .eq("email", email).eq("looking_for", "coach").gte("created_at", dayAgo);
  if ((today || []).length >= PER_DAY) return json({ error: `You can message ${PER_DAY} coaches a day. Try again tomorrow.` }, 429);
  if ((today || []).some((r) => r.profile_id === to.id)) return json({ error: "You have already messaged this coach today." }, 429);

  const { data: row, error } = await db.from("directory_contact_requests").insert({
    profile_id: to.id, name: me.full_name, email, phone: null, message, looking_for: "coach",
    status: "sent", emailed: false,
  }).select("id").single();
  if (error) throw new Error(error.message);

  const ok = await emailConnect(to, me, email, message, row.id);
  if (ok) await db.from("directory_contact_requests").update({ emailed: true }).eq("id", row.id);
  return json({ ok: true });
}

function emailConnect(to, me, fromEmail, message, requestId) {
  const first = String(to.full_name || "").split(" ")[0] || "there";
  const listing = `${SITE_URL}/trainer-directory/coach/${encodeURIComponent(me.slug)}`;
  const where = [me.gym_name, [me.city, me.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const report = `${SITE_URL}/.netlify/functions/directory-contact?report=${requestId}&sig=${sign(requestId)}`;
  const manage = `${SITE_URL}/learn/directory/`;
  return sendMail({
    to: to.public_email || to.email,
    replyTo: fromEmail,
    subject: `${me.full_name}, a BirdBox coach, would like to connect`,
    text:
`Hi ${first},

${me.full_name}, a fellow BirdBox coach${where ? ` (${where})` : ""}, found you in the Trainer Directory and would like to connect.

Their message:
${message}

See their listing: ${listing}

Reply to this email to answer them directly. We have not shared your email; they only see it if you reply.

Not genuine? Report it: ${report}
Don't want messages from other coaches? Switch it off on your listing: ${manage}

BirdBox Coaching`,
    html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#16181b;max-width:560px">
<p>Hi ${esc(first)},</p>
<p><strong>${esc(me.full_name)}</strong>, a fellow <strong>BirdBox coach</strong>${where ? ` (${esc(where)})` : ""}, found you in the Trainer Directory and would like to connect.</p>
<div style="background:#f4f3f0;border-left:4px solid #4FA8DE;padding:14px 16px;white-space:pre-line">${esc(message)}</div>
<p style="margin-top:16px"><a href="${esc(listing)}">See ${esc(String(me.full_name || "").split(" ")[0])}'s listing →</a></p>
<p><strong>Reply to this email to answer them directly.</strong> We have not shared your email; they only see it if you reply.</p>
<p style="color:#6c7178;font-size:14px">Not genuine? <a href="${report}">Report it</a>.<br>
Don't want messages from other coaches? <a href="${manage}">Switch it off on your listing</a>.</p>
<p>BirdBox Coaching</p>
</div>`,
  });
}
