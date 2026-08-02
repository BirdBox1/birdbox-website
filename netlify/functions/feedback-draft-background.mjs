// netlify/functions/feedback-draft-background.mjs
//
// Writes one feedback email from a lead coach's notes.
//
//   POST { registrationId }
//
// The name ends in -background deliberately: Netlify gives these up
// to fifteen minutes, where an ordinary function is cut off at
// thirty seconds. It replies straight away and the draft appears in
// the database when it is done, so the portal watches for it there.

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const MODEL = "claude-sonnet-4-6";

// Where each course type's operating manual lives in the repo.
const MANUALS = {
  "tcc:live_seminar:1": "prompts/tcc-l1-feedback-manual.md",
};

const LANGUAGE_NAMES = {
  en: "English", fr: "French", es: "Spanish", de: "German", it: "Italian",
  ja: "Japanese", ko: "Korean", pt: "Portuguese", pl: "Polish",
};

const US_CURRENCIES = ["USD", "CAD"];

export default async (req) => {
  // Everything below runs after the reply has gone back, so any
  // failure has to be recorded in the draft row rather than returned.
  let registrationId = null;

  try {
    const body = await req.json();
    registrationId = body.registrationId;
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");

    if (!registrationId || !token) return new Response("Bad request", { status: 400 });

    await run(registrationId, token);
  } catch (err) {
    console.error("feedback-draft-background failed:", err);
    if (registrationId) await markFailed(registrationId, err.message);
  }

  return new Response("ok", { status: 202 });
};

async function run(registrationId, token) {
  const staff = await staffFromToken(token);
  if (!staff) return markFailed(registrationId, "Your session expired. Sign in again.");

  const { data: reg } = await supabase
    .from("registrations")
    .select("id, course_id, first_name, last_name, feedback_language")
    .eq("id", registrationId)
    .single();

  if (!reg) return markFailed(registrationId, "Participant not found.");

  if (!(await isLeadOrAdmin(staff, reg.course_id))) {
    return markFailed(registrationId, "Only the lead coach can draft feedback.");
  }

  const { data: course } = await supabase
    .from("courses")
    .select("id, brand, type, level, title, city, country, starts_at, timezone, language, currency")
    .eq("id", reg.course_id)
    .single();

  const { data: notes } = await supabase
    .from("participant_notes")
    .select("body, created_at, staff ( full_name )")
    .eq("registration_id", reg.id)
    .order("created_at", { ascending: true });

  if (!notes || !notes.length) {
    return markFailed(registrationId, "There are no notes for this participant.");
  }

  const manual = await loadManual(course);
  if (!manual) {
    return markFailed(registrationId,
      "No feedback manual is set up for this course type yet.");
  }

  const langCode = reg.feedback_language || course.language || "en";
  const language = LANGUAGE_NAMES[langCode] || langCode;
  const spelling = US_CURRENCIES.includes(course.currency) ? "US" : "UK";
  const greeting = greetingFor(course.timezone);

  const noteText = notes
    .map((n) => `--- Notes from ${n.staff?.full_name || "Coach"} ---\n${n.body}`)
    .join("\n\n");

  const blocks = await loadBlocks();

  const instruction = `
You are writing one post-seminar feedback email for a participant.

COURSE
Brand and level: ${course.brand.toUpperCase()}${course.level ? " " + course.level : ""}
Title: ${course.title}
Where: ${[course.city, course.country].filter(Boolean).join(", ")}
Lead coach: ${staff.full_name}

PARTICIPANT
First name: ${reg.first_name}

WRITING RULES
- Write the whole email in ${language}.
- Use ${spelling} English spelling conventions where the language is English.
- Open with "${greeting} ${reg.first_name}," on its own line.
- Follow the manual exactly, including the mandatory second paragraph.
- Do not invent anything. Use only what the notes support.
- Do NOT write out the conditional inserts (behavioural guidelines,
  coaching philosophy, sensory coaching, transformational coaching,
  charisma). They are held as approved text and are attached after
  you finish. Just decide which are warranted.
- End the written part with the sign-off from the manual.

THE ROUGH NOTES
${noteText}

Reply with JSON only, no other text, in this exact shape:
{
  "subject": "the email subject line",
  "body": "the full email text, using \\n for line breaks",
  "blocks": ["keys of any inserts that are warranted"],
  "missing": "anything the notes did not support, or an empty string"
}

The available insert keys are:
${blocks.map((b) => `- ${b.key}: ${b.title}`).join("\n")}
`.trim();

  const result = await callClaude(manual, instruction);

  const { error } = await supabase.from("feedback_drafts").upsert({
    registration_id: reg.id,
    course_id: reg.course_id,
    subject: result.subject,
    body: result.body,
    blocks: result.blocks || [],
    status: "draft",
    gen_error: result.missing ? "Note: " + result.missing : null,
    generated_at: new Date().toISOString(),
    generated_by: staff.id,
    approved_at: null,
    approved_by: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "registration_id" });

  if (error) {
    console.error("Could not save draft:", error.message);
    await markFailed(registrationId, "The draft was written but could not be saved.");
  }
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

async function markFailed(registrationId, message) {
  const { data: reg } = await supabase
    .from("registrations").select("course_id").eq("id", registrationId).maybeSingle();
  if (!reg) return;

  await supabase.from("feedback_drafts").upsert({
    registration_id: registrationId,
    course_id: reg.course_id,
    status: "failed",
    gen_error: message,
    updated_at: new Date().toISOString(),
  }, { onConflict: "registration_id" });
}

async function staffFromToken(token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: staff } = await supabase
    .from("staff").select("id, full_name, email, role, active")
    .eq("id", data.user.id).maybeSingle();
  if (!staff || !staff.active) return null;
  return staff;
}

async function isLeadOrAdmin(staff, courseId) {
  if (staff.role === "admin") return true;
  const { data } = await supabase
    .from("course_staff").select("role")
    .eq("course_id", courseId).eq("staff_id", staff.id).maybeSingle();
  return data?.role === "lead_coach";
}

async function callClaude(manual, instruction) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      // Cached, so a seminar of fifteen pays for the manual once.
      system: [{
        type: "text",
        text: manual,
        cache_control: { type: "ephemeral" },
      }],
      messages: [{ role: "user", content: instruction }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Anthropic API error:", res.status, detail);
    throw new Error(
      res.status === 401
        ? "The API key was rejected. Check ANTHROPIC_API_KEY in Netlify."
        : res.status === 429
          ? "The API is rate limiting us. Wait a moment and try again."
          : "The drafting service returned an error."
    );
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    console.error("Could not parse model output:", text.slice(0, 400));
    throw new Error("The draft came back in an unexpected format. Try again.");
  }
}

async function loadManual(course) {
  const lvl = String(course.level || "").replace(/\D/g, "");
  const path = MANUALS[`${course.brand}:${course.type}:${lvl}`];
  if (!path) return null;
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    console.error("Could not read manual", path, err.message);
    return null;
  }
}

async function loadBlocks() {
  const { data } = await supabase.from("email_blocks").select("key, title").order("key");
  return (data || []).filter((b) => !b.key.endsWith("_us"));
}

function greetingFor(timezone) {
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || "Europe/Dublin",
      hour: "numeric", hour12: false,
    }).format(new Date()));
  } catch {
    hour = new Date().getHours();
  }
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
