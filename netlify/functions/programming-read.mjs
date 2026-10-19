// netlify/functions/programming-read.mjs
//
// Reads a gym's week of programming (pasted text and/or up to 7 screenshots) for the TGC
// Lesson 17 programming tool, and returns every movement, day by day, as JSON.
//
//   POST { text?, images?: [{ media_type, data (base64) }], mode?: "week" | "accessory" }
//
// The caller is a signed-in learner (their Supabase access token as a Bearer token).
// Each learner gets READS_PER_DAY reads a day, counted in learn_portfolio (tool "_programming_reads").

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const MODEL = "claude-sonnet-5-5";
const READS_PER_DAY = 20, MAX_IMAGES = 7, MAX_TEXT = 20000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    if (!process.env.ANTHROPIC_API_KEY) return json({ error: "The reader is not set up yet (no API key)." }, 500);

    const user = await whoIs(req);
    if (!user) return json({ error: "Please log in again." }, 401);

    const body = await req.json();
    const text = String(body.text || "").slice(0, MAX_TEXT).trim();
    const images = (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES)
      .filter((im) => im && /^image\/(png|jpeg|webp|gif)$/.test(im.media_type) && typeof im.data === "string" && im.data.length < 4_000_000);
    if (!text && !images.length) return json({ error: "Paste the week or add a screenshot first." }, 400);

    if (!(await allow(user.id))) return json({ error: `You have used today's ${READS_PER_DAY} reads. Add the rest by hand, or try again tomorrow.` }, 429);

    const result = await read({ text, images, mode: body.mode === "accessory" ? "accessory" : "week" });
    return json(result);
  } catch (err) {
    console.error("programming-read failed:", err);
    return json({ error: err.message || "Something went wrong reading the week." }, 500);
  }
};

async function whoIs(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

// a few reads a day per learner, so the reader cannot run up a bill
async function allow(uid) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.from("learn_portfolio").select("data").eq("user_id", uid).eq("tool", "_programming_reads").maybeSingle();
  const d = (data && data.data) || {};
  const n = d.day === today ? d.n || 0 : 0;
  if (n >= READS_PER_DAY) return false;
  await supabase.from("learn_portfolio").upsert({ user_id: uid, tool: "_programming_reads", data: { day: today, n: n + 1 }, updated_at: new Date().toISOString() }, { onConflict: "user_id,tool" });
  return true;
}

const INSTRUCTION = (mode) => `You are reading ${mode === "accessory" ? "a coach's gymnastics accessory sessions" : "one week of a CrossFit-style gym's class programming"} for a coaching course.
The input is pasted text and/or screenshots (a gym app, a whiteboard photo, a spreadsheet). Several screenshots together are one week.

Return ONLY JSON, no other text, in exactly this shape:
{"days":[{"day":"Monday","items":[ITEM, ...]}], "notes":"anything unclear, in one or two short sentences"}

Each ITEM is one movement on that day:
{"name":"Back squat","part":"warm-up|skill|strength|workout|accessory|cool-down","modality":"gymnastics|weightlifting|monostructural",
 "pattern":"pull|push|midline|legs|inversion|squat|hinge|press|olympic|carry|run|row|bike|ski|jump|other",
 "sets":5,"reps_per_set":5,"hold_seconds_each":null,"eccentric_seconds_each":null,"load_kg":60,"metres":null,"calories":null,"seconds":null,
 "format":"for time|AMRAP|EMOM|intervals|sets|skill","intensity":"high|moderate|low","scheme":"21-15-9","estimated":false}

Rules:
- One item per movement per day. Leave out warm-up mobility stretches, but keep warm-up movements with reps (e.g. 10 push-ups).
- "day": use the weekday if it is shown; otherwise "Day 1", "Day 2" ... in order.${mode === "accessory" ? ' If no day is shown for an accessory session, use "Session 1", "Session 2" ...' : ""}
- sets and reps_per_set: for strength or accessory work as written (5x5 = sets 5, reps_per_set 5; 3x20s hold = sets 3, reps_per_set null, hold_seconds_each 20).
  For a workout, sets 1 and reps_per_set the TOTAL reps of that movement: 21-15-9 = 45; 5 rounds of 10 = 50; EMOM 12 alternating 2 movements: each gets 6 minutes x its reps.
  AMRAP or a time cap: estimate the rounds a competent athlete completes and set "estimated":true.
- For cardio use metres, calories or seconds instead of reps (reps_per_set null). For a hold (L-sit, handstand hold, hollow hold, plank, chin over bar hold) put the seconds of EACH hold in hold_seconds_each.
- eccentric_seconds_each: the seconds of lowering in EACH rep, only when a tempo or a negative is written (e.g. "3 s lowering" = 3). Otherwise null.
- load_kg: the prescribed load in kg if given (convert lb to kg, round to whole kg). Use the women's/men's first number if two are given. null if none.
- modality: pull-ups, toes to bar, push-ups, dips, handstand work, muscle-ups, rope climbs, sit-ups, pistols, air squats, lunges, burpees, box jumps = gymnastics.
  Barbell, dumbbell, kettlebell, wall ball (pattern "squat") = weightlifting. Run, row, bike, ski, swim, double unders (pattern "jump") = monostructural.
- pattern for gymnastics, the most specific that fits: hang (hang in hollow), strictpu (strict pull-up, chin-up, chin over bar hold), beat (beat swing), kippu (kipping pull-up), c2b (chest to bar or butterfly pull-up), rope (rope climb), ringrow (ring row),
  hollow (hollow or arch holds and rocks), lsit (L-sit, V-sit, tuck sit), t2bstrict (strict toes to bar, knees to elbows), t2bkip (kipping toes to bar), situp (sit-up, GHD sit-up), midline (any other midline work, e.g. V-ups, planks),
  pushup (push-up), lowrings (ring support, ring push-up, ring pass outs), dip (bar or ring dip), burpee (burpee and its variations), bmu (bar muscle-up), rmu (ring muscle-up),
  hand (handstand hold or walk), hspu (handstand push-up, strict or kipping), wallwalk (wall walk), pistol, squatbw (air squat, lunge, step-up), jump (box jump, broad jump);
  if none fits use the group: pull, push, midline, inversion or legs.
  Weightlifting: squat, hinge (deadlift, kettlebell swing, good morning), press (press, push press, jerk, bench), olympic (snatch, clean), carry.
- intensity: for time, AMRAP, chipper, sprint = high; EMOM, intervals, steady = moderate; skill, technique, light or tempo work = low.
  Strength sets: 80%+ of a max, "heavy" or a 1-3 rep max = high; 60-80% = moderate; under 60% or "light" = low.
- If something cannot be read, leave it out and say so in "notes". Never invent movements.`;

async function read({ text, images, mode }) {
  const content = [];
  for (const im of images) content.push({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } });
  content.push({ type: "text", text: INSTRUCTION(mode) + (text ? `\n\nThe pasted programming:\n"""\n${text}\n"""` : "") });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) {
    console.error("Anthropic API error:", res.status, await res.text());
    throw new Error(res.status === 429 ? "The reader is busy. Wait a moment and try again." : "The reader could not read that. Try again, or add the week by hand.");
  }
  const data = await res.json();
  const out = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim()
    .replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed;
  try { parsed = JSON.parse(out); } catch { console.error("Could not parse:", out.slice(0, 400)); throw new Error("The reader came back in an unexpected format. Try again."); }
  if (!parsed || !Array.isArray(parsed.days)) throw new Error("The reader did not find a week in that. Try a clearer screenshot, or add it by hand.");
  return { days: parsed.days, notes: String(parsed.notes || "") };
}
