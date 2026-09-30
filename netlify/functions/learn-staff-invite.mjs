// netlify/functions/learn-staff-invite.mjs
//
// Portal → Online courses → "People with all courses" (admins only).
//
// POST { action: "status" }
//   -> { rows: [{ email, name, invited_at, last_login, started, portfolio }] }
//      For everyone in learn_all_access: when they were emailed, when they
//      last logged in, how many courses they have opened, and how many
//      portfolio tasks they have used.
//
// POST { action: "send", email }
//   -> { ok: true, invited_at }
//      Emails one person their personal 30-day link to BirdBox Learn
//      (the same signed /learn/start link as the buyer welcome emails, so
//      each tap logs them straight in). The portal calls this once per
//      person, so a long list never times out.

import { createClient } from "@supabase/supabase-js";
import { learnStartLink } from "./learnworlds.mjs";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const OFFICE = "info@birdboxcoaching.com";
const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";

const json = (b, status = 200) => new Response(JSON.stringify(b), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    const { data: auth } = await db.auth.getUser(token);
    const user = auth && auth.user;
    if (!user) return json({ error: "Please log in again." }, 401);
    const { data: me } = await db.from("staff").select("role, active").eq("id", user.id).maybeSingle();
    if (!me || !me.active || me.role !== "admin") return json({ error: "Only an admin can do this." }, 403);

    const body = await req.json().catch(() => ({}));
    if (body.action === "status") return json({ rows: await status() });
    if (body.action === "send") return json(await send(String(body.email || "").trim().toLowerCase()));
    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error("learn-staff-invite:", err && (err.message || err));
    return json({ error: "Something went wrong: " + (err && err.message) }, 500);
  }
};

async function allUsers() {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    out.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return out;
}

async function status() {
  const { data: people, error } = await db.from("learn_all_access").select("email, invited_at, created_at").order("email");
  if (error) throw new Error(error.message);
  const emails = people.map((p) => p.email.toLowerCase());
  const [{ data: staff }, users] = await Promise.all([
    db.from("staff").select("full_name, email").in("email", emails),
    allUsers(),
  ]);
  const nameBy = new Map((staff || []).map((s) => [String(s.email || "").toLowerCase(), s.full_name]));
  const userBy = new Map(users.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u]));
  const ids = emails.map((e) => userBy.get(e)?.id).filter(Boolean);
  const [{ data: att }, { data: pf }] = await Promise.all([
    ids.length ? db.from("learn_attempts").select("user_id, course_id").in("user_id", ids) : { data: [] },
    ids.length ? db.from("learn_portfolio").select("user_id, tool").in("user_id", ids) : { data: [] },
  ]);
  const count = (rows, id, skip) => (rows || []).filter((r) => r.user_id === id && r.tool !== skip).length;
  return people.map((p) => {
    const u = userBy.get(p.email.toLowerCase());
    return {
      email: p.email,
      name: nameBy.get(p.email.toLowerCase()) || "",
      since: p.created_at,
      invited_at: p.invited_at || null,
      last_login: u ? u.last_sign_in_at || null : null,
      started: u ? new Set((att || []).filter((a) => a.user_id === u.id).map((a) => a.course_id)).size : 0,
      portfolio: u ? count(pf, u.id, "_unlocked") : 0,
    };
  });
}

async function send(email) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That email does not look right." };
  const { data: row } = await db.from("learn_all_access").select("email").eq("email", email).maybeSingle();
  if (!row) return { error: email + " does not have all courses." };
  const { data: st } = await db.from("staff").select("full_name").eq("email", email).maybeSingle();
  const first = String(st?.full_name || "").trim().split(/\s+/)[0] || "";

  const key = process.env.RESEND_API_KEY;
  if (!key) return { error: "The email service is not set up (no Resend key)." };

  const link = learnStartLink(email, 30);
  const hi = first ? "Hi " + first + "," : "Hi,";
  const text =
`${hi}

You now have access to the BirdBox online courses on our new course site, plus the learner portfolio.

Open your courses:
${link}

The first tap sets up your account. The link is personal to you and works for 30 days; every tap logs you straight in. Once you are in, set a password under "Set or change your password" so you can log in any time at https://birdboxcoaching.com/learn/

Please log in this week and have a look around — reply to this email if anything does not work.

Nathan
BirdBox Coaching`;

  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#16181b;max-width:540px">
<p>${esc(hi)}</p>
<p>You now have access to <b>the BirdBox online courses</b> on our new course site, plus the learner portfolio.</p>
<p style="margin:28px 0"><a href="${link.replace(/&/g, "&amp;")}" style="display:inline-block;background:#4FA8DE;color:#0C1116;text-decoration:none;font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:14px;padding:14px 26px">Open my courses</a></p>
<p>The first tap sets up your account. The link is personal to you and works for 30 days; every tap logs you straight in. Once you are in, set a password under “Set or change your password” so you can log in any time at <a href="https://birdboxcoaching.com/learn/">birdboxcoaching.com/learn</a>.</p>
<p>Please log in this week and have a look around — reply to this email if anything does not work.</p>
<p>Nathan<br>BirdBox Coaching</p>
</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `BirdBox Coaching <${FROM}>`,
      to: [email],
      reply_to: OFFICE,
      subject: "Your BirdBox online courses are ready",
      text, html,
    }),
  });
  if (!res.ok) { const t = await res.text(); console.error("Resend rejected staff invite to", email, t); return { error: "The email was not accepted: " + t.slice(0, 160) }; }
  const invited_at = new Date().toISOString();
  await db.from("learn_all_access").update({ invited_at }).eq("email", email);
  return { ok: true, invited_at };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
