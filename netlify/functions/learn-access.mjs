// netlify/functions/learn-access.mjs
//
// POST { email }  ->  { ok: true }   (always, so nobody can use it to
//                                     find out who has bought a course)
//
// Someone who has bought a course may never have logged in to
// birdboxcoaching.com before. Before the course page asks Supabase to
// email them a login link, it calls this: if the email has at least one
// course in learn_enrolments, a login account is made for it (already
// confirmed), so the link can be sent. Emails with no course are left
// alone, so this cannot be used to create accounts for strangers.

import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ok = () => new Response(JSON.stringify({ ok: true }), {
  status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let email = "";
  try { email = String((await req.json()).email || "").trim().toLowerCase(); } catch (e) { return ok(); }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return ok();

  try {
    const { data: enr } = await db.from("learn_enrolments").select("id").eq("email", email).limit(1);
    if (!enr || !enr.length) return ok();

    // Makes the account if it does not exist; "already registered" is fine.
    const { error } = await db.auth.admin.createUser({ email, email_confirm: true });
    if (error && !/already|registered|exists/i.test(error.message || "")) {
      console.error("learn-access createUser:", error.message);
    }
  } catch (err) {
    console.error("learn-access:", err && (err.message || err));
  }
  return ok();
};
