// netlify/functions/feedback-translate-background.mjs
//
// Translates a finished feedback email.
//
//   POST { registrationId, language }
//
// The name ends in -background deliberately, the same as the drafting
// function: Netlify gives these up to fifteen minutes, where an
// ordinary function is cut off around ten seconds. A long feedback
// email takes longer than that, which showed up as a 504.
//
// It replies straight away and the translation appears in the
// database when it is done, so the portal watches for it there. That
// also means an error cannot be returned to the browser — it is
// written to the draft row instead.
//
// Drafting always happens in English. It has to: the approved
// passages in email_blocks are English, and a model asked to write in
// German would weave English passages into German prose and produce
// one email in two languages. That is what used to happen.
//
// So the email is written and read through in English, then the whole
// thing is translated in one pass — the coach's words and the
// approved passages together, which is the only way they can end up
// in the same language.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const MODEL = "claude-sonnet-4-6";

const LANGUAGE_NAMES = {
  en: "English", fr: "French", es: "Spanish", de: "German", it: "Italian",
  pt: "Portuguese", nl: "Dutch", pl: "Polish", hu: "Hungarian",
  cs: "Czech", sv: "Swedish", da: "Danish", no: "Norwegian", fi: "Finnish",
  el: "Greek", ro: "Romanian", tr: "Turkish", uk: "Ukrainian",
  ja: "Japanese", ko: "Korean", zh: "Chinese (Simplified)",
  af: "Afrikaans", ar: "Arabic",
};

export default async (req) => {
  let registrationId = null;

  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const staff = await requireStaff(req);
    if (!staff) return json({ error: "Not authorised" }, 401);

    const body = await req.json();
    registrationId = body.registrationId;
    const language = body.language;
    if (!registrationId || !language) {
      return json({ error: "Missing participant or language" }, 400);
    }

    const target = LANGUAGE_NAMES[language];
    if (!target) return await fail(registrationId, "That is not a language we translate into.");
    if (language === "en") return await fail(registrationId, "The email is already in English.");

    const { data: draft } = await supabase
      .from("feedback_drafts")
      .select("id, registration_id, course_id, subject, body, status")
      .eq("registration_id", registrationId)
      .maybeSingle();

    if (!draft) return await fail(registrationId, "There is no draft to translate.");
    if (draft.status === "sent") {
      return await fail(registrationId, "That email has already been sent.");
    }
    if (!draft.body || !draft.body.trim()) {
      return await fail(registrationId, "The draft is empty.");
    }

    if (!(await isLeadOrAdmin(staff, draft.course_id))) {
      return await fail(registrationId, "Only the lead coach can translate feedback.");
    }

    await supabase.from("feedback_drafts")
      .update({ translate_error: null }).eq("id", draft.id);

    const { data: reg } = await supabase
      .from("registrations")
      .select("first_name, last_name")
      .eq("id", registrationId)
      .maybeSingle();

    const out = await translate({
      subject: draft.subject || "",
      body: draft.body,
      target,
      firstName: reg ? reg.first_name : "",
      coachName: staff.full_name,
    });

    const { error } = await supabase.from("feedback_drafts").update({
      translated_subject: out.subject,
      translated_body: out.body,
      translated_language: language,
      translated_at: new Date().toISOString(),
      // What it was translated from, so the page can tell when the
      // English has moved on since.
      translated_from: draft.body,
      translate_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", draft.id);

    if (error) {
      console.error("Could not save the translation:", error.message);
      return await fail(registrationId,
        "The translation was made but could not be saved.");
    }

    return new Response("ok", { status: 202 });
  } catch (err) {
    console.error("feedback-translate failed:", err);
    if (registrationId) {
      await fail(registrationId, err.message || "Something went wrong.");
    }
    return new Response("failed", { status: 202 });
  }
};

// Nobody is waiting on the response, so a failure has to be left
// where the portal will find it.
async function fail(registrationId, message) {
  await supabase.from("feedback_drafts")
    .update({ translate_error: message, updated_at: new Date().toISOString() })
    .eq("registration_id", registrationId);
  return new Response("failed", { status: 202 });
}

async function translate({ subject, body, target, firstName, coachName }) {
  const instruction = `
Translate this coaching feedback email into ${target}.

It was written by a coach called ${coachName} to a participant called
${firstName}, after a seminar. Parts of it are the coach's own writing
and parts are approved course material. Translate all of it, so the
whole email is in ${target} and nothing is left in English.

HOW TO TRANSLATE IT
- Keep the meaning exactly. This is feedback somebody will act on, so
  do not soften it, sharpen it, shorten it or add to it.
- Keep the warmth and the register. It should read as though the coach
  wrote it in ${target}, not as though it went through a machine.
- Keep the structure: the same paragraphs, in the same order, with the
  same line breaks and blank lines.
- Use the informal second person where ${target} has one. This is a
  coach writing to somebody they spent a weekend with, not a formal
  letter.
- Do not add a translator's note, a preface, or anything that is not
  in the original.

WHAT STAYS IN ENGLISH — AND IT IS ONLY THIS
Exactly four things are left in English. Everything else is
translated, without exception.

1. People's names and place names.
2. Exercise names taken from the intervention library. These are the
   visible text of a link, written [Exercise name](url). Leave the
   name and the URL untouched.
3. Names of movements as they are said in the gym — Power Clean,
   Snatch, Toes-to-Bar, Muscle-Up and so on. ${target}-speaking
   athletes say these in English, and translating them would read as
   though written by somebody outside the sport.
4. Citations and proper nouns: an author and year, a course name, a
   company name.

EVERYTHING ELSE IS TRANSLATED. This includes the parts most often
left alone by mistake:

- Coaching vocabulary. Reinforcement, feedback, standards, values,
  leadership style, mission statement. These are ordinary words with
  ordinary equivalents. Use them.
- The names of frameworks and every one of their component parts. If
  the email lists five areas of something, or ten areas of something,
  each of those names is translated.
- Personality descriptors and any other label the course happens to
  use in English.
- Headings and list items. A numbered heading left in English above a
  translated paragraph is the single worst-reading thing this
  translation can produce. If the body is translated, so is the
  heading.

Do not keep an English word because it is a technical term, because it
is capitalised, because it came from course material, or because the
English is shorter. If a competent ${target}-speaking coach would say
it in ${target} when talking to an athlete, write it in ${target}.

BEFORE YOU REPLY
Read your translation back as though you were the participant. Every
sentence, every heading and every list item must be in ${target}. If
any run of words other than a name, a linked exercise name, a gym
movement or a citation is still in English, you have not finished —
go back and translate it.

THE SUBJECT
${subject}

THE EMAIL
${body}

Reply with JSON only, no other text, in this exact shape:
{
  "subject": "the translated subject line",
  "body": "the translated email, using \\n for line breaks"
}
`.trim();

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
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
          : "The translation service returned an error."
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
    const parsed = JSON.parse(cleaned);
    if (!parsed.body || !parsed.body.trim()) {
      throw new Error("The translation came back empty.");
    }
    return parsed;
  } catch (err) {
    console.error("Could not parse the translation:", text.slice(0, 400));
    throw new Error("The translation came back in an unexpected format. Try again.");
  }
}

async function requireStaff(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: staff } = await supabase
    .from("staff").select("id, full_name, role, active")
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
