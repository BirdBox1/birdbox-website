// netlify/functions/blog-comments.mjs
//
// The members' discussion under BirdBox blog posts, in the Blog tab of
// BirdBox Learn only (Nathan, 1 Nov 2026). The public blog has none.
// Signed in with the Learn login (Authorization: Bearer <token>).
//
// GET  ?counts                      -> { counts: { post_id: n } }
// GET  ?post=<post id>              -> { comments, staff }
// POST { action: "add", post, parent?, body }
// POST { action: "report", id }     one per person; three hide it
// POST { action: "hide" | "show", id }   staff only
//
// Only BirdBox members take part: staff, and anyone BirdBox knows from a
// purchase or given programming (netlify/lib/known.mjs). A directory-only
// login is refused. The tables (blog_comments, blog_comment_reports) are
// closed to every login, so all of it goes through here.
//
// The name shown comes from their BirdBox record ("Sarah H."), never from
// what they type; staff show as BirdBox coach, the post's writer as Author.
// Members cannot post links (adverts), and no one more than 10 an hour.

import { db, json, userFrom, sendMail, esc, SITE_URL } from "../lib/directory.mjs";
import { knownToBirdBox } from "../lib/known.mjs";
import { lockedName } from "../lib/learn-pass.mjs";

const MAX = 2000;
const PER_HOUR = 10;
const HIDE_AT = 3;
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|ai|app|info|biz|me|ly|gg|link|site|online|store|shop)\b)/i;

async function staffOf(user) {
  const { data } = await db.from("staff").select("id, full_name, email").eq("id", user.id).eq("active", true).maybeSingle();
  return data || null;
}

export default async (req) => {
  const user = await userFrom(req);
  if (!user) return json({ error: "Please log in again." }, 401);
  const email = String(user.email || "").toLowerCase();
  try {
    const staff = await staffOf(user);
    if (!staff && !(await knownToBirdBox(email))) {
      return json({ error: "The discussion is for BirdBox members." }, 403);
    }
    if (req.method === "GET") {
      const q = new URL(req.url).searchParams;
      if (q.has("counts")) return json({ counts: await counts() });
      return json({ comments: await list(String(q.get("post") || ""), user, !!staff), staff: !!staff });
    }
    if (req.method !== "POST") return json({ error: "Use GET or POST" }, 405);
    const b = await req.json().catch(() => ({}));
    if (b.action === "add") return add(user, email, staff, b);
    if (b.action === "report") return report(user, String(b.id || ""));
    if ((b.action === "hide" || b.action === "show") && staff) return moderate(user, String(b.id || ""), b.action === "hide");
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("blog-comments:", e.message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};

async function counts() {
  const { data } = await db.from("blog_comments").select("post_id").is("hidden_at", null);
  const out = {};
  for (const r of data || []) out[r.post_id] = (out[r.post_id] || 0) + 1;
  return out;
}

async function list(postId, user, isStaff) {
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return [];
  let q = db.from("blog_comments").select("id, parent_id, user_id, author_name, role, body, created_at, hidden_at, reports")
    .eq("post_id", postId).order("created_at");
  if (!isStaff) q = q.is("hidden_at", null);
  const { data } = await q;
  return (data || []).map((c) => ({
    id: c.id, parent_id: c.parent_id, author_name: c.author_name, role: c.role, body: c.body,
    created_at: c.created_at, hidden: !!c.hidden_at, reports: isStaff ? c.reports : undefined,
    mine: c.user_id === user.id,
  }));
}

const shortName = (n) => {
  if (!n?.first) return "BirdBox member";
  const last = String(n.last || "").trim();
  return n.first.trim() + (last ? " " + last[0].toUpperCase() + "." : "");
};

async function add(user, email, staff, b) {
  const body = String(b.body || "").replace(/\r/g, "").trim();
  if (!body) return json({ error: "Write something first." }, 400);
  if (body.length > MAX) return json({ error: `Please keep it under ${MAX} characters.` }, 400);
  if (!staff && LINK_RE.test(body)) return json({ error: "Links cannot be posted here. Describe it in words instead." }, 400);

  const { data: post } = await db.from("blog_posts").select("id, slug, title, author_staff_id")
    .eq("id", String(b.post || "")).eq("status", "published").maybeSingle();
  if (!post) return json({ error: "That post could not be found." }, 404);

  let parent = null;
  if (b.parent) {
    const { data } = await db.from("blog_comments").select("id, parent_id, user_id, post_id")
      .eq("id", String(b.parent)).maybeSingle();
    if (!data || data.post_id !== post.id) return json({ error: "That comment could not be found." }, 404);
    // one level of replies: a reply to a reply joins the same thread
    parent = data.parent_id ? { ...data, id: data.parent_id } : data;
  }

  const since = new Date(Date.now() - 3600000).toISOString();
  const { count } = await db.from("blog_comments").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).gte("created_at", since);
  if ((count || 0) >= PER_HOUR) return json({ error: "That is a lot of comments in an hour. Please try again a little later." }, 429);

  const role = staff && staff.id === post.author_staff_id ? "author" : staff ? "staff" : "member";
  const name = staff ? shortName(splitName(staff.full_name)) : shortName(await lockedName(user, email));
  const { data: row, error } = await db.from("blog_comments").insert({
    post_id: post.id, parent_id: parent ? parent.id : null, user_id: user.id,
    author_name: name, role, body,
  }).select("id").single();
  if (error) throw new Error(error.message);

  await tellPeople(post, parent, user, name, body);
  return json({ ok: true, id: row.id });
}

const splitName = (full) => {
  const n = String(full || "").trim(); const i = n.lastIndexOf(" ");
  return i > 0 ? { first: n.slice(0, i), last: n.slice(i + 1) } : { first: n, last: "" };
};

// The post's writer hears about every comment; a member about a reply to them.
async function tellPeople(post, parent, user, name, body) {
  const link = `${SITE_URL}/learn/#blog/${encodeURIComponent(post.slug)}`;
  const quote = body.length > 400 ? body.slice(0, 400) + "…" : body;
  const send = (to, subject, line) => sendMail({
    to, subject,
    text: `${line}\n\n"${quote}"\n\nRead and reply in BirdBox Learn: ${link}\n\nBirdBox Coaching`,
    html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#16181b;max-width:520px">` +
      `<p>${esc(line)}</p><blockquote style="margin:16px 0;padding:10px 14px;border-left:3px solid #4FA8DE;background:#f4f3f1">${esc(quote).replace(/\n/g, "<br>")}</blockquote>` +
      `<p><a href="${esc(link)}">Read and reply in BirdBox Learn →</a></p><p>BirdBox Coaching</p></div>`,
  });
  try {
    if (post.author_staff_id && post.author_staff_id !== user.id) {
      const { data: a } = await db.from("staff").select("email").eq("id", post.author_staff_id).maybeSingle();
      if (a?.email) await send(a.email, `New comment on "${post.title}"`, `${name} commented on your post "${post.title}".`);
    }
    if (parent && parent.user_id !== user.id && parent.user_id !== post.author_staff_id) {
      const { data: u } = await db.auth.admin.getUserById(parent.user_id);
      if (u?.user?.email) await send(u.user.email, `${name} replied to you`, `${name} replied to your comment on "${post.title}".`);
    }
  } catch (e) { console.error("blog-comments email:", e.message); }
}

async function report(user, id) {
  const { data: c } = await db.from("blog_comments").select("id, reports, hidden_at").eq("id", id).maybeSingle();
  if (!c) return json({ error: "That comment could not be found." }, 404);
  const { error } = await db.from("blog_comment_reports").insert({ comment_id: id, user_id: user.id });
  if (error) return json({ ok: true, already: true });
  const reports = (c.reports || 0) + 1;
  await db.from("blog_comments").update({
    reports, ...(reports >= HIDE_AT && !c.hidden_at ? { hidden_at: new Date().toISOString() } : {}),
  }).eq("id", id);
  return json({ ok: true });
}

async function moderate(user, id, hide) {
  const { error } = await db.from("blog_comments").update(hide
    ? { hidden_at: new Date().toISOString(), hidden_by: user.id }
    : { hidden_at: null, hidden_by: null, reports: 0 }).eq("id", id);
  if (error) throw new Error(error.message);
  if (!hide) await db.from("blog_comment_reports").delete().eq("comment_id", id);
  return json({ ok: true });
}
