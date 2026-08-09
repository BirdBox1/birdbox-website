// netlify/functions/feedback-draft-background.mjs
//
// Writes one feedback email from a lead coach's notes.
//
//   POST { registrationId, blocks? }
//
// The name ends in -background deliberately: Netlify gives these up
// to fifteen minutes, where an ordinary function is cut off at
// thirty seconds. It replies straight away and the draft appears in
// the database when it is done, so the portal watches for it there.
//
// The approved passages are written INTO the email, in the place
// they belong, rather than being stapled to the end afterwards. The
// optional `blocks` in the request are ground the coach wants
// covered whatever the notes say; the model may add more of its own.
//
// Which course types have a feedback manual is held in the
// feedback_manuals table rather than in this file, so the portal and
// the feedback page can ask the same question the drafter does. A
// course type with no row has no feedback: TCC Level 2 issues its
// certificate from the online course after the exam, and no feedback
// email is written for it.

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const MODEL = "claude-sonnet-4-6";

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
    const mustCover = Array.isArray(body.blocks) ? body.blocks : [];
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");

    if (!registrationId || !token) return new Response("Bad request", { status: 400 });

    await run(registrationId, token, mustCover);
  } catch (err) {
    console.error("feedback-draft-background failed:", err);
    if (registrationId) await markFailed(registrationId, err.message);
  }

  return new Response("ok", { status: 202 });
};

async function run(registrationId, token, mustCover) {
  const staff = await staffFromToken(token);
  if (!staff) return markFailed(registrationId, "Your session expired. Sign in again.");

  const { data: reg } = await supabase
    .from("registrations")
    .select("id, course_id, first_name, last_name, feedback_language, primary_limitation, secondary_limitation")
    .eq("id", registrationId)
    .single();

  if (!reg) return markFailed(registrationId, "Participant not found.");

  if (!(await isLeadOrAdmin(staff, reg.course_id))) {
    return markFailed(registrationId, "Only the lead coach can draft feedback.");
  }

  const { data: course } = await supabase
    .from("courses")
    .select("id, brand, type, level, title, city, country, starts_at, timezone, language, currency, workshop_focus, movements")
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

  // Three quite different things can go wrong here, and they used to
  // produce the same message: this course type does not do feedback
  // at all, a manual is expected but no path is recorded, or a path
  // is recorded and the file could not be read. The first is a
  // deliberate setting, the second needs a row adding, the third is a
  // fault. They are reported separately.
  const found = await loadManual(course);
  if (!found.ok) return markFailed(registrationId, found.message);

  const langCode = reg.feedback_language || course.language || "en";
  const language = LANGUAGE_NAMES[langCode] || langCode;
  const spelling = US_CURRENCIES.includes(course.currency) ? "US" : "UK";
  const greeting = greetingFor(course.timezone);

  const noteText = notes
    .map((n) => {
      const who = n.staff?.full_name || "Coach";
      const mine = who === staff.full_name;
      return `--- ${mine ? "Your own notes" : "Notes from " + who} ---\n${n.body}`;
    })
    .join("\n\n");

  // The full approved text, in the participant's language, so the
  // model has the material to work with rather than only a label.
  // Scoped to this course's brand: the TCC passages are TCC coaching
  // material and have no place in a gymnastics feedback email.
  const blocks = await loadBlocks(course, langCode);

  const passageText = blocks.length
    ? blocks.map((b) => `### ${b.key} — ${b.title}\n${b.body}`).join("\n\n")
    : "";

  const requested = mustCover.filter((k) => blocks.some((b) => b.key === k));

  // What the coach chose from the limitation dropdowns, where this
  // course type uses them. The manual maps each one to its own
  // approved intervention exercises.
  const limitations = [
    ["Primary limitation", reg.primary_limitation],
    ["Secondary limitation", reg.secondary_limitation],
  ].filter(([, v]) => v && String(v).trim());

  const limitationText = !found.usesLimitations
    ? ""
    : limitations.length
      ? `THE RECORDED LIMITATIONS
${limitations.map(([label, v]) => `- ${label}: ${v}`).join("\n")}

Prescribe every approved intervention exercise the manual lists for each
of these. Where the manual gives two exercises for one limitation,
include both. A specific prescription in the notes always takes
precedence over the library mapping.
`
      : `THE RECORDED LIMITATIONS
None were recorded for this participant. Take the development
priorities and any interventions from the coach notes alone, exactly as
the manual describes for that case. Do not select a limitation from the
library because the notes hint at one.
`;

  // The passage rules below describe TCC's approved coaching text and
  // its named lists. A brand with no passages of its own — TGC works
  // from its intervention library instead — must not be handed them,
  // so the whole section drops out rather than arriving empty.
  const passagesSection = !blocks.length ? "" : `
THE APPROVED PASSAGES
The manual describes these as passages to "attach". That wording is
historic and it supersedes to this: they are written INTO the email,
in the place in the argument where they belong, exactly as the sample
emails in the manual's appendix do. Nothing is ever added after the
sign-off.

- Decide from the notes which passages are warranted. A passage is
  warranted when the notes point at that ground, whether or not it is
  named directly.
${requested.length
  ? `- The lead coach has asked that these are covered whatever the notes\n  say: ${requested.join(", ")}. Cover them in addition to any you\n  choose yourself. This is a floor, not a limit.`
  : `- The lead coach has not asked for any specific passage, so the\n  choice is entirely yours, from the notes.`}
- Where a passage is warranted, lead into it from your own observation
  of the participant, then give the material in full. The reader should
  never be able to tell where your writing stops and the approved text
  begins.
- Reproduce the named lists word for word. These are our terminology
  and must not be reworded, reordered or shortened:
  the five areas of transformational coaching, the ten areas of
  charisma, the six sensory coaching elements, the nine behavioural
  guidelines, the five steps of a coaching philosophy, and the NAMSET
  expansion. The sentences around them are yours to write.
- Never both refer to a framework and withhold it. If you write that
  the ten areas of charisma are a useful framework, the ten areas must
  appear. If you are not giving them, do not point at them.
- Cover each passage once. If the ground is already made in your own
  words earlier in the email, fold the material into that place rather
  than making a second pass at it.

${passageText}
`;

  const instruction = `
You are writing one post-seminar feedback email for a participant.

COURSE
Brand and level: ${course.brand.toUpperCase()}${course.level ? " " + course.level : ""}
Title: ${course.title}
Where: ${[course.city, course.country].filter(Boolean).join(", ")}
Lead coach: ${staff.full_name}${
  course.workshop_focus ? `\nWorkshop: ${course.workshop_focus}` : ""
}${
  course.movements ? `\nMovements covered: ${course.movements}` : ""
}

PARTICIPANT
First name: ${reg.first_name}

WRITING RULES
- Write the whole email in ${language}.
- Use ${spelling} English spelling conventions where the language is English.
- Open with "${greeting} ${reg.first_name}," on its own line.

- You ARE ${staff.full_name}. You coached this person and you are writing to
  them directly. Write in the first person throughout: "I noticed", "what I
  saw", "we worked on". Where the notes are your own, they are your own
  observations — never write "${staff.full_name} noted" or refer to yourself
  by name in the third person. Notes written by an assisting coach can be
  given as "we" or "the team", without naming them.
- Plain text only. No markdown: no **bold**, no ##headings, no bullet
  characters other than a plain hyphen. The email is sent as written, so any
  asterisk or hash appears literally to the reader. Use a short line of its
  own as a heading if a section needs one.

- Follow the manual exactly${blocks.length ? ", including the mandatory second paragraph" : ""}.
- Do not invent anything. Use only what the notes support.
- End with the sign-off from the manual, then the lead coach's name on its
  own line as the last line of the email: ${staff.full_name}
  The email comes from the person who coached them, so it is signed by that
  person. Never sign off with a brand name, a course name, "The Team", or
  leave the name off altogether.
${passagesSection}${limitationText}
THE ROUGH NOTES
${noteText}

Reply with JSON only, no other text, in this exact shape:
{
  "subject": "the email subject line",
  "body": "the complete email text, using \\n for line breaks",
  "blocks": ${blocks.length ? '["keys of the passages you covered"]' : "[]"},
  "missing": "anything the notes did not support, or an empty string"
}

"body" is the finished email. Nothing will be added to it.
`.trim();

  const result = await callClaude(found.manual, instruction, found.reference);

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

async function callClaude(manual, instruction, reference) {
  // Both blocks are cached, so a seminar of fifteen pays for the
  // manual and the course reference once between them rather than
  // fifteen times each.
  const system = [{
    type: "text",
    text: manual,
    cache_control: { type: "ephemeral" },
  }];

  if (reference) {
    system.push({
      type: "text",
      text:
        "COURSE REFERENCE — what is taught on this seminar.\n\n" +
        "Use this to explain why a development priority matters: the laws and\n" +
        "rules, the movement development tools, the biomechanics, the positions\n" +
        "and the faults commonly observed. It gives you the seminar's own words\n" +
        "for those ideas.\n\n" +
        "It is NOT a source of observations. Nothing here may be used to say\n" +
        "this participant did, showed or struggled with anything. Only the coach\n" +
        "notes can support that. Do not recount the seminar's teaching sequence\n" +
        "back to the participant, and do not quote the speaker script.\n\n" +
        reference,
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
      // The passages are now part of the email rather than bolted on
      // after it, so the written reply is a good deal longer.
      max_tokens: 8000,
      system,
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

// A relative path depends on the working directory the function
// happens to be started in, which is not something to rely on. These
// are tried in order and the first that reads wins; the one that
// worked is logged, so the guesswork only has to happen once.
function candidatePaths(relative) {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    relative,
    resolve(relative),
    join(here, relative),
    join(here, "..", relative),
    join(here, "..", "..", relative),
    join(process.cwd(), relative),
  ];
}

// Which course types have a manual now lives in feedback_manuals, so
// there is one answer to that question and the portal reads the same
// one. A course type with no active row does not do feedback at all.
async function loadManual(course) {
  const lvl = String(course.level || "").replace(/\D/g, "");
  const label = `${course.brand.toUpperCase()}` +
                `${course.level ? " " + course.level : ""} ` +
                `${String(course.type || "").replace(/_/g, " ")}`;

  const { data: row, error } = await supabase
    .from("feedback_manuals")
    .select("manual_path, active, uses_limitations, reference_path")
    .eq("brand", course.brand)
    .eq("type", course.type)
    .eq("level", lvl)
    .maybeSingle();

  if (error) {
    console.error("Could not read feedback_manuals:", error.message);
    return {
      ok: false,
      message: "Could not check which feedback manual applies. This is a fault — try again.",
    };
  }

  if (!row || !row.active) {
    return {
      ok: false,
      message: `${label} does not have feedback emails set up.`,
    };
  }

  if (!row.manual_path) {
    return {
      ok: false,
      message: `${label} is set up for feedback but no manual file is recorded against it.`,
    };
  }

  const tried = [];
  for (const path of candidatePaths(row.manual_path)) {
    try {
      const manual = await readFile(path, "utf8");
      console.log("Manual loaded from:", path);
      return {
        ok: true,
        manual,
        usesLimitations: !!row.uses_limitations,
        reference: await loadReference(row.reference_path),
      };
    } catch (err) {
      tried.push(`${path} (${err.code || err.message})`);
    }
  }

  console.error("Manual not found. Tried:\n" + tried.join("\n"));
  return {
    ok: false,
    message:
      `The manual for ${label} is set up but its file could not be read on the ` +
      `server. It is expected at ${row.manual_path}. This is a fault, not a ` +
      `missing manual.`,
  };
}

// The seminar's own teaching material, where a brand has one. It
// explains WHY a development priority matters — the laws, the rules,
// the movement development tools, the biomechanics and the faults
// commonly seen. It is reference only: it can never be the source of
// an observation about this participant.
//
// Deliberately soft: a manual with an unreadable reference still
// drafts. Losing the explanatory depth is worth less than losing the
// email altogether, and the log says which happened.
async function loadReference(relative) {
  if (!relative) return null;

  for (const path of candidatePaths(relative)) {
    try {
      const text = await readFile(path, "utf8");
      console.log("Course reference loaded from:", path);
      return text;
    } catch (err) {
      // keep trying
    }
  }

  console.error("Course reference not found:", relative, "— drafting without it.");
  return null;
}

// The passages, resolved to the language and spelling this
// participant will read, so approved terminology stays consistent
// instead of an English passage landing in a German email.
//
// Scoped to the course's brand. The passages are brand-specific
// coaching material: TCC's charisma, philosophy and behavioural
// guidelines belong in a TCC email and nowhere else. A brand with no
// rows gets none, which is correct — TGC works from its intervention
// library, described in its own manual.
async function loadBlocks(course, langCode) {
  const { data: rows } = await supabase
    .from("email_blocks").select("key, title, body")
    .eq("brand", course.brand)
    .order("key");

  const { data: translations } = await supabase
    .from("email_block_translations").select("key, language, body");

  const byLang = {};
  for (const t of translations || []) {
    (byLang[t.language] = byLang[t.language] || {})[t.key] = t.body;
  }

  const base = {};
  for (const r of rows || []) base[r.key] = r.body;

  const wantsUS = US_CURRENCIES.includes(course.currency);

  // The US philosophy variant is chosen automatically, so it is not
  // something the model should be picking between.
  return (rows || [])
    .filter((r) => !r.key.endsWith("_us"))
    .map((r) => {
      let body = r.body;
      if (wantsUS && base[r.key + "_us"]) body = base[r.key + "_us"];
      if (langCode && langCode !== "en" && byLang[langCode]?.[r.key]) {
        body = byLang[langCode][r.key];
      }
      return { key: r.key, title: r.title, body };
    })
    .filter((b) => b.body);
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
