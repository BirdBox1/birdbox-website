// netlify/functions/grant-online-course.mjs
//
// POST { registration_id, language }  -> { status, label, error? }
//
// Lets an admin give someone their free online course by hand: the
// person who paid cash on the day, a registration that predates the
// automatic enrolment, or one where the enrolment failed.
//
// This exists as a function rather than portal code because the
// LearnWorlds client secret must never reach a browser. The portal
// sends the logged-in staff member's token; this checks it against
// the staff table before doing anything.

import { createClient } from "@supabase/supabase-js";
import { grantOnlineCourse } from "./learnworlds.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ---- who is asking ------------------------------------------
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return json({ error: "Not signed in" }, 401);

  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData?.user) {
    return json({ error: "Your session has expired — sign in again." }, 401);
  }

  const { data: staff } = await supabase
    .from("staff")
    .select("id, role, active, full_name")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!staff || !staff.active) return json({ error: "Not a staff account" }, 403);
  if (staff.role !== "admin") {
    return json({ error: "Only an admin can grant online access" }, 403);
  }

  // ---- what they are asking for --------------------------------
  let body;
  try { body = await req.json(); }
  catch (e) { return json({ error: "Bad request" }, 400); }

  const registrationId = body.registration_id;
  const language = String(body.language || "").trim();
  if (!registrationId) return json({ error: "Missing registration_id" }, 400);
  if (!language) return json({ error: "Choose a language" }, 400);

  const { data: reg, error: regError } = await supabase
    .from("registrations")
    .select("id, course_id, first_name, last_name, email, learnworlds_status")
    .eq("id", registrationId)
    .maybeSingle();

  if (regError || !reg) return json({ error: "Registration not found" }, 404);
  if (!reg.email) return json({ error: "That registration has no email address" }, 409);

  const { data: course } = await supabase
    .from("courses")
    .select("id, brand, level, title, grants_online_course")
    .eq("id", reg.course_id)
    .maybeSingle();

  if (!course) return json({ error: "Course not found" }, 404);

  // The flag is the safeguard: a course that does not give an online
  // course away cannot be made to, even by hand.
  if (!course.grants_online_course) {
    return json({ error: "This course does not include a free online course" }, 409);
  }

  // ---- do it ---------------------------------------------------
  const result = await grantOnlineCourse(supabase, {
    email: reg.email,
    firstName: reg.first_name,
    lastName: reg.last_name,
    brand: course.brand,
    level: course.level,
    language,
    justification: `Granted by ${staff.full_name} — ${course.title}`,
  });

  await supabase.from("registrations").update({
    learnworlds_language: language,
    learnworlds_status: result.status,
    learnworlds_user_id: result.userId || null,
    learnworlds_enrolled_at: result.status === "enrolled" ? new Date().toISOString() : null,
    learnworlds_error: result.error || null,
  }).eq("id", registrationId);

  if (result.status !== "enrolled") {
    console.error("Manual grant failed", registrationId, result.error);
    return json({ error: result.error || "Enrolment failed" }, 502);
  }

  return json({
    status: result.status,
    label: result.label || language,
    userWasCreated: !!result.userWasCreated,
  });
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
