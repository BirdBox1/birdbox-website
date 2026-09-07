// netlify/functions/quiz-submit.mjs
//
// The coaching archetype self-assessment.
//
// Scoring happens here, not in the browser. Twelve questions, each answered
// 1-4 along one ladder, summed to a 12-48 total and banded into a stage. The
// page sends only the raw answers, so a page with the numbers edited gets the
// same answer as an honest one.
//
// This replaces a JotForm whose four hidden counters were wired to the wrong
// archetype names — the most advanced answer on every question incremented a
// counter called "Explorer", the least advanced one called "Refiner" — so it
// had been telling people the opposite of their result. The wording below is
// Nathan's, carried over verbatim; only the scoring is rebuilt.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const OFFICE = "info@birdboxcoaching.com";
const FROM = process.env.ALERT_FROM || OFFICE;
const SITE = "https://www.birdboxcoaching.com";

// ---------------------------------------------------------------- scoring

// 12 questions, 12-48 total.
const BANDS = [
  { max: 20, key: "explorer" },
  { max: 29, key: "builder" },
  { max: 38, key: "refiner" },
  { max: 48, key: "leader" },
];

function bandFor(score) {
  for (const b of BANDS) if (score <= b.max) return b.key;
  return "leader";
}

// ---------------------------------------------------------------- content

// Said once, before and after the stage itself.
const OPENING = [
  "Thank you for completing the BirdBox Coaching Development self-assessment.",
  "This isn’t just a quiz — it’s a snapshot of where you currently are in your coaching journey. The stage you’re in right now highlights both your strengths and the specific opportunities that will unlock your next level of impact.",
  "Every coach evolves through stages — each with its own challenges, breakthroughs, and growth edges. Knowing where you are today gives you the clarity to focus your energy where it matters most, instead of chasing endless information or guesswork.",
  "Below you’ll find a detailed explanation of your current stage, along with a short video designed to bring the key insights to life. Read it carefully, reflect on where it resonates, and consider how you can put it into practice in your own coaching.",
];

const CLOSING = [
  "Remember, your stage is not a limit — it’s a launchpad. The best coaches aren’t defined by how much they know, but by how intentionally they keep refining their craft.",
  "At BirdBox Coaching, we’re here to support you with tools, frameworks, and community to help you grow sharper, faster, and more effective in the real world of coaching.",
  "If you’re ready to dive deeper, start by watching the video we’ve included and reflecting on how it connects with your daily coaching. From there, you’ll find opportunities to practice, apply, and expand on what you already do well.",
  "Keep going. The athletes you coach don’t just need your knowledge — they need your clarity, presence, and precision.",
  "Here’s to your next breakthrough,",
  "The BirdBox Coaching Team",
];

const STAGES = {
  explorer: {
    name: "Explorer",
    video: "https://www.youtube.com/watch?v=g8hKY8L0yl4",
    videoId: "g8hKY8L0yl4",
    next: { text: "The Coaches Course — Level 1", href: "/tcc/level-1/" },
    body: [
      "Based on your responses, you’re in what we call the Explorer phase. And just so we’re clear — that’s not a weakness. It’s the most important part of the coaching journey. Because Explorers are the ones asking questions, noticing gaps, and looking for something better.",
      "Right now, you might be feeling some tension — like you know there’s more to coaching or movement than you’re currently applying… but you’re not exactly sure how to bridge the gap. Maybe you’ve taken in lots of information — videos, seminars, even courses — but it hasn’t yet clicked into a usable, confident system.",
      "You’re not alone in that. Most people in this phase either overcomplicate everything — or oversimplify and miss what matters. It’s totally normal to feel unsure when trying to understand biomechanics, recognize what’s really happening in movement, or figure out how to make changes that stick.",
      "The key for Explorers is to build a solid foundation:",
    ],
    bullets: [
      "Learn to see movement clearly — not just what’s happening, but why it’s happening.",
      "Practice connecting what you observe to specific corrections — without throwing a dozen cues at the wall.",
      "Begin to develop a coaching lens that helps you filter what matters and ignore what doesn’t.",
    ],
    after: [
      "Right now, your best next step is to get clear frameworks, consistent feedback, and support in applying what you’re learning. This is exactly what we help Explorers with inside BirdBox Coaching.",
      "We’ll meet you where you are. No jargon. No guesswork. Just a step-by-step approach to help you go from curious to confident — in your coaching, your movement understanding, and your athlete impact.",
      "You’re in the right place. You’ve taken the first step by starting this assessment.",
    ],
  },

  builder: {
    name: "Builder",
    video: "https://youtu.be/JEJaEcSoXps",
    videoId: "JEJaEcSoXps",
    next: { text: "The Coaches Course — Level 1", href: "/tcc/level-1/" },
    body: [
      "According to your assessment, you’re in the Builder phase — and that’s a powerful place to be. You’ve moved beyond just reacting to what you see in coaching or training. You’ve started thinking more critically, asking deeper questions, and applying what you’ve learned in more meaningful ways.",
      "Chances are, you’ve already spent time studying biomechanics, observing movement, and coaching in real scenarios. Some things click. Some don’t. One day you feel dialed in — the next, you’re not so sure. That’s the Builder journey: you’re putting in the reps, but you’re still fine-tuning your lens, your language, and your systems.",
      "One of the biggest challenges at this level is inconsistency. Sometimes you see what’s wrong, but you’re not totally confident in how to correct it. Or maybe you give a cue and cross your fingers, hoping it lands. You’re developing intuition, but you haven’t yet built the repeatable system to apply it under pressure — consistently and with clarity.",
      "In the Builder phase, your greatest opportunity is to move from being a coach who improvises well… to one who executes a system with purpose.",
      "That means:",
    ],
    bullets: [
      "Clarifying what you’re looking for in movement",
      "Using fewer, more effective cues",
      "And getting feedback on how well your corrections actually translate into improved performance.",
    ],
    after: [
      "This is the gritty, powerful middle. You’re past guessing — and now you’re learning to own your coaching approach. The gap between knowledge and consistent application is where great coaches are forged.",
      "At BirdBox Coaching, this is where we love working with Builders — because you’re ready to accelerate. If you want sharper systems, more confident decision-making, and movement conversations that actually create change — we’ve got the tools, frameworks, and support to help.",
    ],
  },

  refiner: {
    name: "Refiner",
    video: "https://www.youtube.com/watch?v=8AHdAOmuqs4",
    videoId: "8AHdAOmuqs4",
    next: { text: "The Coaches Course — Level 1", href: "/tcc/level-1/" },
    body: [
      "Your assessment places you in the Refiner phase — a powerful but often overlooked stage in a coach’s journey. You’re not figuring things out anymore — you’re fine-tuning them. And that’s where some of the deepest breakthroughs happen.",
      "You’ve got real-world experience. You understand movement, you know your systems, and you’ve coached or trained enough to recognize patterns. Your decisions aren’t guesses — they’re informed by principle and practice. You’re not reacting — you’re responding with clarity.",
      "But here’s the reality at this level: small inefficiencies now create big gaps later. You’re no longer struggling with what to do — you’re wrestling with how to do it better, faster, and more consistently. And sometimes, that feels like chasing shadows.",
      "You might be asking:",
    ],
    bullets: [
      "Am I missing subtleties others don’t see?",
      "Are my corrections landing as deeply as they could?",
      "How do I sharpen my delivery without overcomplicating it?",
    ],
    after: [
      "The Refiner phase is about precision. It’s not just about getting the job done — it’s about executing with elegance, efficiency, and depth. At this level, it’s less about learning more… and more about stripping away the noise so what’s left is clear, intentional, and effective.",
    ],
    bullets2: [
      "Polish your movement lens to spot subtle compensations",
      "Tighten your cueing so each word lands with purpose",
      "Scale your communication — especially if you’re coaching teams or leading other coaches",
      "Build a feedback loop that sharpens you without pulling you into over-analysis",
    ],
    after2: [
      "At BirdBox Coaching, we specialize in helping Refiners like you move from really good to remarkably sharp. We’re not here to throw more information at you — we’re here to challenge, refine, and enhance what you’re already doing.",
    ],
  },

  leader: {
    name: "Leader",
    video: "https://youtu.be/SrHLFHbW9j0",
    videoId: "SrHLFHbW9j0",
    next: { text: "The Coaches Course — Level 1", href: "/tcc/level-1/" },
    body: [
      "Based on your assessment, you’re operating in the Leader phase — and that’s no small thing. You’ve likely invested time, energy, and thought into your development, and it shows.",
      "You have clarity in your approach, you recognize the value of biomechanics, and you’re not just reacting — you’re observing, guiding, and executing with intention. You probably have systems in place, a strong grasp of movement principles, and a feedback loop that’s shaping your athletes or your own growth.",
      "But here’s the challenge at this level — staying sharp without becoming stagnant. At the Leader level, refinement becomes more nuanced. It’s not about overhauling what you’re doing — it’s about fine-tuning for leverage. You may find that small blind spots or assumptions, if unaddressed, start to compound. And sometimes, the higher you go, the harder it is to get clear, constructive feedback.",
      "The best leaders constantly revisit the fundamentals with a fresh lens — especially in how they communicate with athletes, adapt to new information, or transfer complex movement corrections into real-world performance. At BirdBox, we often see leaders plateau not because of a lack of knowledge, but because they’ve outgrown their feedback systems.",
      "So here’s your next best step:",
    ],
    bullets: [
      "Seek targeted feedback — from someone who understands performance and sees what others miss.",
      "Audit your coaching conversations — are you leading athletes to autonomy, or staying in the expert seat too often?",
      "Revisit your blind spots — especially around how movement limitations are perceived versus how they’re corrected.",
    ],
    after: [
      "If you want outside eyes, sharper systems, or just someone to help you tune your coaching engine — that’s what we do at BirdBox Coaching. We work with leaders like you to push through plateaus, elevate your coaching identity, and scale your impact.",
      "You’re already doing great work. Let’s make sure you keep building in the right direction.",
    ],
  },
};

// The result as the page and the email both consume it.
function resultFor(key, firstName) {
  const s = STAGES[key];
  return {
    key,
    name: s.name,
    greeting: "Hello " + firstName + ",",
    opening: OPENING,
    body: s.body,
    bullets: s.bullets || [],
    after: s.after || [],
    bullets2: s.bullets2 || [],
    after2: s.after2 || [],
    video: s.video,
    videoId: s.videoId,
    next: s.next,
    closing: CLOSING,
  };
}

// ------------------------------------------------------------------ email

function esc(t) {
  return String(t).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function emailHtml(r) {
  const p = (t) =>
    `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#1d2126">${esc(t)}</p>`;
  const ul = (items) =>
    items.length
      ? `<ul style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:1.6;color:#1d2126">` +
        items.map((i) => `<li style="margin-bottom:8px">${esc(i)}</li>`).join("") +
        `</ul>`
      : "";

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2">
<tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="max-width:620px;background:#ffffff;border:1px solid #e2e2de">
  <tr><td style="background:#101215;padding:20px 28px">
    <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9aa1a9;
                font-family:Helvetica,Arial,sans-serif">BirdBox Coaching</div>
    <div style="font-size:20px;font-weight:700;color:#ffffff;margin-top:4px;
                font-family:Helvetica,Arial,sans-serif">Your Coaching Self-Assessment</div>
  </td></tr>
  <tr><td style="padding:28px;font-family:Helvetica,Arial,sans-serif">
    ${p(r.greeting)}
    ${r.opening.map(p).join("")}
    <div style="margin:26px 0 16px;padding:14px 18px;background:#f0f2f5;border-left:4px solid #2f7fd0">
      <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#5b636d">
        Your stage</div>
      <div style="font-size:26px;font-weight:700;color:#101215;margin-top:2px">${esc(r.name)}</div>
    </div>
    ${r.body.map(p).join("")}
    ${ul(r.bullets)}
    ${r.after.map(p).join("")}
    ${ul(r.bullets2)}
    ${r.after2.map(p).join("")}
    <p style="margin:26px 0 10px;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#5b636d">
      Learn more on effective coaching</p>
    <p style="margin:0 0 26px">
      <a href="${esc(r.video)}"
         style="display:inline-block;background:#2f7fd0;color:#ffffff;text-decoration:none;
                font-weight:700;font-size:15px;padding:13px 22px">Watch your ${esc(r.name)} video &rarr;</a>
    </p>
    ${r.closing.map(p).join("")}
    <p style="margin:26px 0 0">
      <a href="${SITE}${esc(r.next.href)}"
         style="color:#2f7fd0;font-weight:700;text-decoration:none">
        Next step: ${esc(r.next.text)} &rarr;</a>
    </p>
  </td></tr>
  <tr><td style="padding:18px 28px;background:#f7f7f5;border-top:1px solid #e2e2de;
                 font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b7178">
    BirdBox Coaching Limited &middot; 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland<br>
    <a href="mailto:${OFFICE}" style="color:#6b7178">${OFFICE}</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function emailText(r) {
  const lines = [
    r.greeting, "",
    ...r.opening, "",
    "YOUR STAGE: " + r.name.toUpperCase(), "",
    ...r.body, "",
    ...r.bullets.map((b) => "- " + b), "",
    ...r.after, "",
    ...r.bullets2.map((b) => "- " + b),
    ...(r.bullets2.length ? [""] : []),
    ...r.after2, "",
    "Watch your " + r.name + " video: " + r.video, "",
    ...r.closing, "",
    "Next step: " + r.next.text + " " + SITE + r.next.href,
  ];
  return lines.join("\n");
}

async function sendResult(to, r) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("No Resend key; quiz result not sent to", to); return false; }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox Coaching <${FROM}>`,
        to: [to],
        reply_to: OFFICE,
        subject: `Your coaching stage: ${r.name}`,
        text: emailText(r),
        html: emailHtml(r),
      }),
    });
    if (!res.ok) {
      console.error("Resend rejected the quiz result to", to, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Quiz result email failed for", to, e);
    return false;
  }
}

// ---------------------------------------------------------------- handler

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const body = await req.json();

    const answers = Array.isArray(body.answers) ? body.answers.map(Number) : [];
    if (answers.length !== 12 || answers.some((n) => !Number.isInteger(n) || n < 1 || n > 4)) {
      return json({ error: "Please answer every question." }, 400);
    }

    const firstName = String(body.firstName || "").trim().slice(0, 80);
    const lastName = String(body.lastName || "").trim().slice(0, 80);
    const email = String(body.email || "").trim().toLowerCase().slice(0, 200);

    if (!firstName || !lastName) {
      return json({ error: "Both names, please." }, 400);
    }
    if (!email || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
      return json({ error: "A valid email address is needed to send your result." }, 400);
    }

    const consent = body.marketingConsent === true;
    const score = answers.reduce((a, b) => a + b, 0);
    const key = bandFor(score);
    const utm = body.utm && typeof body.utm === "object" ? body.utm : {};
    const cut = (v) => (v == null ? null : String(v).slice(0, 200));

    const { data: row, error: insErr } = await supabase.from("quiz_responses").insert({
      first_name: firstName,
      last_name: lastName,
      email,
      answers,
      score,
      archetype: key,
      marketing_consent: consent,
      consent_at: consent ? new Date().toISOString() : null,
      utm_source: cut(utm.source),
      utm_medium: cut(utm.medium),
      utm_campaign: cut(utm.campaign),
      utm_content: cut(utm.content),
      utm_term: cut(utm.term),
      referer: cut(body.referer),
    }).select("id").single();

    // A failed write must not cost the person their result — they answered
    // twelve questions for it. Log it and carry on.
    if (insErr) console.error("quiz_responses insert failed", insErr);

    const result = resultFor(key, firstName);
    const sent = await sendResult(email, result);

    if (sent && row && row.id) {
      await supabase
        .from("quiz_responses")
        .update({ emailed_at: new Date().toISOString() })
        .eq("id", row.id);
    }

    return json({ ok: true, id: row ? row.id : null, emailed: sent, score, result });
  } catch (e) {
    console.error("quiz-submit failed", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
