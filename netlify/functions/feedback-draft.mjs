// netlify/functions/feedback-draft.mjs
//
// Turns a lead coach's notes into a feedback email draft.
//
//   POST { action: "generate",  registrationId }
//   POST { action: "translate", key, language }
//
// Only the lead coach on that course, or an admin, may call it. The
// caller sends their Supabase access token as a Bearer token.

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

// Dollar-priced courses get US spelling; everything else UK.
const US_CURRENCIES = ["USD", "CAD"];

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return json({ error: "No API key set. Add ANTHROPIC_API_KEY in Netlify." }, 500);
    }

    const staff = await requireStaff(req);
    if (!staff) return json({ error: "Not authorised" }, 401);

    const body = await req.json();

    if (body.action === "translate") return await translateBlock(body, staff);
    if (body.action === "generate")  return await generate(body, staff);

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("feedback-draft failed:", err);
    return json({ error: err.message || "Something went wrong" }, 500);
  }
};

// ---------------------------------------------------------------
// who is asking
// ---------------------------------------------------------------
async function requireStaff(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: staff } = await supabase
    .from("staff")
    .select("id, full_name, email, role, active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!staff || !staff.active) return null;
  return staff;
}

async function isLeadOrAdmin(staff, courseId) {
  if (staff.role === "admin") return true;
  const { data } = await supabase
    .from("course_staff")
    .select("role")
    .eq("course_id", courseId)
    .eq("staff_id", staff.id)
    .maybeSingle();
  return data?.role === "lead_coach";
}

// ---------------------------------------------------------------
// write a draft
// ---------------------------------------------------------------
async function generate(body, staff) {
  const { registrationId } = body;
  if (!registrationId) return json({ error: "Missing participant" }, 400);

  const { data: reg } = await supabase
    .from("registrations")
    .select("id, course_id, first_name, last_name, email, feedback_language")
    .eq("id", registrationId)
    .single();

  if (!reg) return json({ error: "Participant not found" }, 404);
  if (!(await isLeadOrAdmin(staff, reg.course_id))) {
    return json({ error: "Only the lead coach can draft feedback" }, 403);
  }

  const { data: course } = await supabase
    .from("courses")
    .select("id, brand, type, level, title, city, country, starts_at, ends_at, timezone, language, currency")
    .eq("id", reg.course_id)
    .single();

  // ---- the notes, from every coach on the course ----
  const { data: notes } = await supabase
    .from("participant_notes")
    .select("body, created_at, staff ( full_name )")
    .eq("registration_id", reg.id)
    .order("created_at", { ascending: true });

  if (!notes || !notes.length) {
    return json({ error: "There are no notes for this participant yet." }, 409);
  }

  const manual = await loadManual(course);
  if (!manual) {
    return json({
      error: "No feedback manual is set up for this course type yet.",
    }, 409);
  }

  const langCode = reg.feedback_language || course.language || "en";
  const language = LANGUAGE_NAMES[langCode] || langCode;
  const spelling = US_CURRENCIES.includes(course.currency) ? "US" : "UK";

  // Greeting follows the course's own time zone, not the coach's
  // device — a lead drafting at midnight from home should not send
  // "good evening" to somebody in another country.
  const greeting = greetingFor(course.timezone);

  const noteText = notes
    .map((n) => {
      const who = n.staff?.full_name || "Coach";
      return `--- Notes from ${who} ---\n${n.body}`;
    })
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
Name: ${reg.first_name} ${reg.last_name}

WRITING RULES
- Write the whole email in ${language}.
- Use ${spelling} English spelling conventions where the language is English.
- Open with "${greeting} ${reg.first_name}," on its own line.
- Follow the manual exactly, including the mandatory second paragraph.
- Do not invent anything. Use only what the notes support.
- Do NOT write out the conditional inserts (behavioural guidelines,
  coaching philosophy, sensory coaching, transformational coaching,
  charisma). They are held as approved text and will be attached
  after you finish. Just decide which are warranted.
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

  // Save it, replacing any earlier draft for this participant.
  const { data: saved, error } = await supabase
    .from("feedback_drafts")
    .upsert({
      registration_id: reg.id,
      course_id: reg.course_id,
      subject: result.subject,
      body: result.body,
      blocks: result.blocks || [],
      status: "draft",
      generated_at: new Date().toISOString(),
      generated_by: staff.id,
      approved_at: null,
      approved_by: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "registration_id" })
    .select()
    .single();

  if (error) return json({ error: error.message }, 500);

  return json({
    ok: true,
    draft: saved,
    missing: result.missing || "",
  });
}

// ---------------------------------------------------------------
// translate an approved block, once, for checking
// ---------------------------------------------------------------
async function translateBlock(body, staff) {
  const { key, language } = body;
  if (!key || !language) return json({ error: "Missing block or language" }, 400);

  const { data: block } = await supabase
    .from("email_blocks").select("key, title, body").eq("key", key).single();
  if (!block) return json({ error: "Block not found" }, 404);

  const name = LANGUAGE_NAMES[language] || language;

  const instruction = `
Translate the passage below into ${name}.

- Keep the meaning exact. This is approved coaching material.
- Keep the same paragraph and list structure.
- Leave proper names, citations and author names as they are
  (for example "Smith & Smoll 2008").
- Keep established coaching terms recognisable; where a term has no
  natural equivalent, keep the English term and add a short
  explanation in brackets the first time it appears.

Reply with the translated passage only, no preamble.

PASSAGE
${block.body}
`.trim();

  const text = await callClaude(null, instruction, { raw: true });

  return json({ ok: true, key, language, body: text });
}

// ---------------------------------------------------------------
// the model
// ---------------------------------------------------------------
async function callClaude(manual, instruction, opts = {}) {
  const system = [];

  if (manual) {
    // Cached, so a seminar of fifteen pays for the manual once
    // rather than fifteen times.
    system.push({
      type: "text",
      text: manual,
      cache_control: { type: "ephemeral" },
    });
  }

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
      system: system.length ? system : undefined,
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

  if (opts.raw) return text;

  // The model was asked for JSON; strip any fencing before parsing.
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    console.error("Could not parse model output:", text.slice(0, 400));
    throw new Error("The draft came back in an unexpected format. Try again.");
  }
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

async function loadManual(course) {
  const lvl = String(course.level || "").replace(/\D/g, "");
  const key = `${course.brand}:${course.type}:${lvl}`;
  const path = MANUALS[key] || MANUALS[`${course.brand}:${course.type}:`];
  if (!path) return null;

  try {
    return await readFile(path, "utf8");
  } catch (err) {
    console.error("Could not read manual", path, err.message);
    return null;
  }
}

async function loadBlocks() {
  const { data } = await supabase
    .from("email_blocks")
    .select("key, title")
    .order("key");
  // The US philosophy variant is chosen automatically, so it is not
  // something the model should be picking between.
  return (data || []).filter((b) => !b.key.endsWith("_us"));
}

function greetingFor(timezone) {
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || "Europe/Dublin",
      hour: "numeric",
      hour12: false,
    }).format(new Date()));
  } catch {
    hour = new Date().getHours();
  }
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
