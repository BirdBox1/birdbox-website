// netlify/functions/prereq-check.mjs
//
// POST { slug, email } -> { required, found, token }
//
// The booking page for a course that needs Level 1 first (TGC Level 2:
// Nathan, 20 Nov 2026) checks the email before showing the payment
// buttons. The token goes to create-checkout, which locks that email in
// and records whether Level 1 was found. Nobody is blocked: not found
// means they tell us where they did it and the booking is flagged.
//
// Says only found / not found, never what or where, so typing someone
// else's email tells you nothing about their courses.

import { db, json } from "../lib/directory.mjs";
import { needsLevel1, level1Record, prereqToken } from "../lib/prereq.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body.slug || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    if (!slug) return json({ error: "Which course?" }, 400);

    const { data: course } = await db.from("courses").select("brand, level, type, status").eq("slug", slug).maybeSingle();
    if (!course) return json({ error: "Course not found" }, 404);
    if (!needsLevel1(course)) return json({ required: false });

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);

    const rec = await level1Record(email, course.brand);
    return json({ required: true, found: rec.found, token: prereqToken({ email, slug, found: rec.found }) });
  } catch (err) {
    console.error("prereq-check", err);
    return json({ error: "Could not check just now. Please try again." }, 500);
  }
};
