// netlify/functions/feedback-translate.mjs
//
// Translates a finished feedback email.
//
//   POST { registrationId, language }
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
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const staff = await requireStaff(req);
    if (!staff) return json({ error: "Not authorised" }, 401);

    const { registrationId, language } = await req.json();
    if (!registrationId || !language) {
      return json({ error: "Missing participant or language" }, 400);
    }

    const target = LANGUAGE_NAMES[language];
    if (!target) return json({ error: "That is not a language we translate into." }, 400);
    if (language === "en") return json({ error: "The email is already in English." }, 400);

    const { data: draft } = await supabase
      .from("feedback_drafts")
      .select("id, registration_id, course_id, subject, body, status")
      .eq("registration_id", registrationId)
      .maybeSingle();

    if (!draft) return json({ error: "There is no draft to translate." }, 404);
    if (draft.status === "sent") {
      return json({ error: "That email has already been sent." }, 409);
    }
    if (!draft.body || !draft.body.trim()) {
      return json({ error: "The draft is empty." }, 400);
    }

    if (!(await isLeadOrAdmin(staff, draft.course_id))) {
      return json({ error: "Only the lead coach can translate feedback." }, 403);
    }

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
      updated_at: new Date().toISOString(),
    }).eq("id", draft.id);

    if (error) {
      console.error("Could not save the translation:", error.message);
      return json({ error: "The translation was made but could not be saved." }, 500);
    }

    return json({ ok: true, language, languageName: target });
  } catch (err) {
    console.error("feedback-translate failed:", err);
    return json({ error: err.message || "Something went wrong" }, 500);
  }
};

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
Exactly three things are left in English. Everything else is
translated, without exception.

1. People's names and place names.
2. Exercise names taken from the intervention library. These are the
   visible text of a link, written [Exercise name](url), and the coach
   checks them against the library before sending. Leave the name and
   the URL untouched.
3. A term that ${target}-speaking coaches genuinely use in English in
   their own gyms, where translating it would make the sentence read
   as though written by somebody outside the sport.

Point 3 is narrow and it is being read too widely. Coaching language
has ordinary equivalents in ${target} and they should be used. Do not
keep an English word merely because it is a technical term, because it
appears capitalised, because it came from course material, or because
the English is shorter. If a competent ${target}-speaking coach would
say it in ${target} when talking to an athlete, write it in ${target}.

Where a term does stay in English under point 3, the entire sentence
around it must still be in ${target}. One English noun inside a
${target} sentence reads naturally. A ${target} paragraph with an
English clause in the middle of it does not, and is the specific
fault this instruction exists to prevent.

BEFORE YOU REPLY
Read your translation back as though you were the participant. Every
sentence must be in ${target}. If any run of words other than a name,
a linked exercise name, or a point 3 term is still in English, you
have not finished — go back and translate it.

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
