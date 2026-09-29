// netlify/functions/learn-start.mjs
//
// GET /learn/start?e=<email>&x=<expiry>&s=<signature>
//
// The "open my course" link in welcome emails. It logs the buyer straight
// in on birdboxcoaching.com/learn/ -- the first time it also makes their
// account -- so nobody has to ask for a login link after paying.
//
// The link is signed (learnStartLink in learnworlds.mjs) so the email in it
// cannot be swapped for someone else's, and it lasts 30 days. Every click
// makes a fresh one-time Supabase login link, so it keeps working even if
// an email scanner opened it first. Expired, altered, or no course on that
// email -> the normal /learn/ page, which offers a login link by email.

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { signLearnLink } from "./learnworlds.mjs";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const go = (url) => new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });

export default async (req) => {
  const url = new URL(req.url);
  const origin = url.origin;
  const email = String(url.searchParams.get("e") || "").trim().toLowerCase();
  const x = parseInt(url.searchParams.get("x") || "0", 10);
  const sig = String(url.searchParams.get("s") || "");
  const fallback = origin + "/learn/?expired=1&email=" + encodeURIComponent(email);

  try {
    if (!email || !x || !sig) return go(origin + "/learn/");
    const want = signLearnLink(email, x);
    const ok = want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
    if (!ok || x < Date.now() / 1000) return go(fallback);

    const { data: enr } = await db.from("learn_enrolments").select("id").eq("email", email).limit(1);
    if (!enr || !enr.length) return go(fallback);

    const { error: cErr } = await db.auth.admin.createUser({ email, email_confirm: true });
    if (cErr && !/already|registered|exists/i.test(cErr.message || "")) console.error("learn-start createUser:", cErr.message);

    const { data, error } = await db.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: origin + "/learn/?welcome=1" },
    });
    if (error || !data?.properties?.action_link) {
      console.error("learn-start generateLink:", error?.message);
      return go(fallback);
    }
    return go(data.properties.action_link);
  } catch (err) {
    console.error("learn-start:", err && (err.message || err));
    return go(fallback);
  }
};

export const config = { path: "/learn/start" };
