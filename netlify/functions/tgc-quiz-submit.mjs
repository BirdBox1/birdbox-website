// netlify/functions/tgc-quiz-submit.mjs
//
// The TGC gymnastics coaching focus diagnostic.
//
// The gymnastics-side counterpart to quiz-submit.mjs. Same architecture —
// server-side scoring, result email, chain enrolment, interest_signups,
// Conversions API Lead — but a different shape of answer.
//
// TCC asks what stage of coach you are and bands a single total. This asks
// what your coaching needs next, and the four focus areas are a LADDER, not
// four independent types. TGC teaches an order of operations: static before
// dynamic, strict before kipping, build an isometric base. A coach cannot
// usefully work on dynamic timing with athletes who have no base, and
// periodising volume before positions are right just accumulates a fault.
//
// So the result is the EARLIEST rung the coach falls below on, not the worst
// one. Somebody weak on the eye and weak on periodisation is told to work on
// the eye, because that is the advice they would be given in the room.
//
// Twelve questions, three per rung, each answered 1-4. Each rung scores 3-12
// and passes at 8. Scored here rather than in the browser, so the page can be
// edited without changing anybody's result.

import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const OFFICE = "info@birdboxcoaching.com";
const FROM = process.env.ALERT_FROM || OFFICE;
const SITE = "https://www.birdboxcoaching.com";

// ---------------------------------------------------------------- scoring

// Ladder order. Questions 1-3 are rung 1, 4-6 rung 2, and so on.
const RUNGS = ["eye", "methodology", "dynamic", "periodisation"];

// A rung passes at 8 of a possible 12 — an average of a little under 3.
// This is a starting guess. Once a few hundred responses are in, the
// distribution in quiz_responses will say whether it is pitched right: if
// almost everybody lands on the eye, that may simply be true, or it may mean
// the rung-1 questions are too hard.
const PASS = 8;

function rungScores(answers) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    out.push(answers[i * 3] + answers[i * 3 + 1] + answers[i * 3 + 2]);
  }
  return out;
}

// The first rung below the pass mark, walking up from the bottom. Somebody
// who clears all four gets the top rung as a refinement rather than a gap.
function focusFor(scores) {
  for (let i = 0; i < RUNGS.length; i++) {
    if (scores[i] < PASS) return RUNGS[i];
  }
  return "periodisation";
}

// ---------------------------------------------------------------- content

// Said once, above and below every result.
const OPENING = [
  "Thanks for taking the assessment.",
  "This isn’t a score, and it isn’t a verdict on how good a coach you are. It’s a read on where the next real gain in your coaching is sitting — because gymnastics coaching is an order of operations, and working on the wrong rung is how coaches put in years of effort for very little return.",
  "Everyone is somewhere on this ladder. Below is where you are, why it matters, and one thing you can do about it this week.",
];

const CLOSING = [
  "Wherever you are on this ladder, it isn’t a ceiling. Coaches move up it quickly once they know which rung they’re standing on — the wasted years come from working hard on the wrong one.",
  "Over the next few weeks we’ll send you five short emails on your focus area. Not a sales sequence — things worth thinking about, and things you can try with the athletes in front of you.",
  "Nathan Bird and the BirdBox team",
];

// Every result points at TGC Level 1, and each names the objective the
// seminar already advertises that answers their rung. The coach is told which
// part of the room is theirs rather than handed a generic course page.
const NEXT = { text: "The Gymnastics Course — Level 1", href: "/tgc/level-1/" };

const FOCUS = {
  eye: {
    name: "The Coach’s Eye",
    lede: "Your focus: seeing and transferring foundational shapes.",
    body: [
      "You can tell when a movement is wrong. Most coaches can. What’s harder — and what separates coaches who get consistent results from coaches who get occasional ones — is knowing what is wrong, in the first rep, and knowing which position it traces back to.",
      "Right now, that read isn’t reliable yet. It shows up in small ways. Two athletes fail the same movement and get the same cue. You demonstrate a shape and four different versions come back at you. You know something’s off, but by the time you’ve worked out what, the set is finished.",
      "This is the first rung for a reason. Everything above it depends on it. A methodology you can’t see faults against is a schedule, not a system. Timing work on an athlete whose shape is wrong makes the wrong thing faster. Volume on top of that accumulates the fault instead of the skill.",
      "The good news is that a coach’s eye is trainable. It isn’t talent, and it isn’t simply years on the floor — plenty of coaches accumulate a decade of watching without it, because they were never looking at anything in particular. But it does take time. Time spent deliberately, on the right things, in the right order. That’s the part nobody can shortcut for you, and it’s also the part that moves fastest once you know where to point your attention.",
    ],
    tryThis: [
      "Pick one movement your class does often. Before the session, write down the three things you will look at, in order — not what good looks like overall, but three specific checkpoints. Coach the whole session looking only at those three.",
      "A hint: the body is a series of links. A fault you can see is rarely where the fault starts.",
      "You’ll see more with three deliberate checks than with an open-ended look at everything, because your attention finally has somewhere to go. Do it for a week and you’ll notice the second thing — how much you were missing while looking at all of it.",
    ],
    taught:
      "Movement Assessment is one of the four things TGC Level 1 is built around. Two days of learning to see and correct movement more simply, with your hands on real athletes and coaches watching you do it.",
  },

  methodology: {
    name: "The Application Methodology",
    lede: "Your focus: the foundational steps of a gymnastics coaching methodology, and how to apply them.",
    body: [
      "You can see it. That’s not the gap. You watch an athlete and you know what’s wrong — the question you can’t always answer is what to do about it, in what order, and why that order and not another one.",
      "It shows up as decisions made in the moment. What an athlete works on next comes from what today’s programme happens to hold, or what they’re struggling with most, or what they’ve asked for. Each is a reasonable answer to a single session. None of them is a method, and the difference shows over months rather than days.",
      "Here’s the distinction that matters, and it’s the one most coaches miss: a progression is a list of steps. A methodology is the reasoning underneath them. A progression says do this, then this. A methodology says what quality each step is building — control held still, control under lengthening, control expressed — and why that quality has to come before the next one. The steps without the reasoning are a sequence you inherited. With the reasoning, they’re a system you can defend, adapt for an athlete who doesn’t fit, and hand to another coach.",
      "There’s a straightforward test. If another coach took your athletes for a month, could they carry on? Not guess — carry on, in the same direction, for the same reasons. If the answer lives mostly in your head, you have judgement, which is worth a great deal and doesn’t scale, can’t be handed over, and quietly disappears when you’re tired.",
    ],
    tryThis: [
      "Take one movement and write the order out, start to finish. Then next to each step write two things: what quality that step is building, and why it has to come before the one after it.",
      "The steps will come easily. The second column is where most coaches find they’ve been improvising — and that column is the methodology.",
    ],
    taught:
      "TGC Level 1 opens on the coaching methodology and the hierarchy of development — the reasoning underneath the steps rather than the steps themselves, and why the order is the order.",
  },

  dynamic: {
    name: "Dynamic Technical Coaching",
    lede: "Your focus: technical coaching toward dynamic movement timing.",
    body: [
      "Your athletes have positions and they have strength. What they don’t reliably have is rhythm — and that’s the point where a lot of otherwise excellent coaching quietly stops.",
      "You’ll recognise it. An athlete with a solid strict pull-up whose kip has never looked the same twice. Skills that hold together fresh and fall apart at rep eight, where the strength clearly hasn’t gone anywhere but the sequence has. Progress that comes from repetition rather than from coaching, which means it takes months and you can’t say what made the difference.",
      "Here’s what makes this rung different from the two below it. A position is a thing you can see held still. Timing only exists in motion, which means you can’t coach it by pausing it — and the moment you slow a dynamic movement down to explain it, you’re no longer teaching the thing you’re trying to teach.",
      "And this is where most coaches make it worse rather than better. Faced with an athlete whose timing is off, the instinct is to explain more: another cue, another rule, another thing to think about on the way up. But every rule you add gives the athlete another piece to monitor, and an athlete monitoring pieces stops moving as a whole. They break the movement down exactly where it needs to stay together. More explicit instruction produces a more decomposed, more self-conscious, more inconsistent athlete — the opposite of what you were aiming at.",
      "The way through is implicit rather than explicit. Less telling. Conditions arranged so the athlete finds the timing themselves, because the right timing is the only one that works.",
    ],
    tryThis: [
      "Take an athlete whose dynamic skill is inconsistent and stop telling them what to do with their body. Change one thing about the task instead, so the correct timing is the easy one. Then say nothing and let them have ten attempts.",
      "What they solve on their own will tell you more about what they actually understand than any amount of cueing.",
    ],
    taught:
      "TGC Level 1 teaches spotting and self-spotting, which is the best form of scaling there is. Spotting an athlete through a dynamic movement is how they find the smoothness — and the understanding that comes with it — without you having to talk them through it.",
  },

  periodisation: {
    name: "Progression Periodisation",
    lede: "Your focus: the later stages of athlete development, once position and precision are there.",
    body: [
      "You’re past the problems most coaches are still working on. Your athletes move well, you can see what’s happening, and you have an order you coach in. Which puts you somewhere quite specific — the point where coaching stops being about correcting movement and starts being about prescribing it.",
      "The symptom is the athlete who’s doing everything right and has stopped progressing. Clean positions, decent timing, showing up, working hard, and flat for three months. There’s nothing to fix, so there’s nothing obvious to coach — and the usual instinct is to add. More reps, more days, more accessory work. Sometimes that’s the answer. Often the athlete was already receiving more than they were adapting to, and the problem was never the amount.",
      "This rung is about dose. How much of a thing, how hard, how often, and against everything else in their week — because gymnastics volume doesn’t sit in isolation, it competes with every other demand the athlete has. It’s the least visible part of coaching and the one with the longest feedback loop, which is why most coaches never systematise it. You can be wrong for eight weeks before anything tells you.",
      "Getting it right is what turns a good coach into one whose athletes keep progressing years in.",
    ],
    tryThis: [
      "Pick one athlete who’s stalled. Write down everything they did in the last four weeks — all of it, not just the gymnastics. Then ask a harder question than “what should I add”: what are they actually adapting to, and is anything in that list preventing it?",
      "The answer is more often subtraction than addition, and almost never what the athlete expects.",
    ],
    taught:
      "Programming and scaling is the fourth thing TGC Level 1 is built around. Gymnastics programming doesn’t need to be hard — it needs to be often, and prescribed against everything else the athlete is doing.",
  },
};

// The result as the page and the email both consume it.
function resultFor(key, firstName, scores) {
  const f = FOCUS[key];
  return {
    key,
    name: f.name,
    lede: f.lede,
    greeting: "Hello " + firstName + ",",
    opening: OPENING,
    body: f.body,
    tryThis: f.tryThis,
    taught: f.taught,
    next: NEXT,
    closing: CLOSING,
    scores,
    rungs: RUNGS.map((k, i) => ({ key: k, name: FOCUS[k].name, score: scores[i] })),
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

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2">
<tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="max-width:620px;background:#ffffff;border:1px solid #e2e2de">
  <tr><td style="background:#101215;padding:20px 28px">
    <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9aa1a9;
                font-family:Helvetica,Arial,sans-serif">The Gymnastics Course</div>
    <div style="font-size:20px;font-weight:700;color:#ffffff;margin-top:4px;
                font-family:Helvetica,Arial,sans-serif">What your coaching needs next</div>
  </td></tr>
  <tr><td style="padding:28px;font-family:Helvetica,Arial,sans-serif">
    ${p(r.greeting)}
    ${r.opening.map(p).join("")}
    <div style="margin:26px 0 16px;padding:14px 18px;background:#f0f2f5;border-left:4px solid #D8393D">
      <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#5b636d">
        Your focus</div>
      <div style="font-size:26px;font-weight:700;color:#101215;margin-top:2px">${esc(r.name)}</div>
      <div style="font-size:14px;color:#3d444c;margin-top:6px">${esc(r.lede)}</div>
    </div>
    ${r.body.map(p).join("")}
    <div style="margin:26px 0;padding:18px;background:#f7f7f5;border:1px solid #e2e2de">
      <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#5b636d;
                  margin-bottom:10px">Try this week</div>
      ${r.tryThis.map(p).join("")}
    </div>
    <div style="margin:26px 0;padding:18px;background:#101215">
      <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#9aa1a9;
                  margin-bottom:8px">Where this is taught</div>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#e8eaed">${esc(r.taught)}</p>
    </div>
    ${r.closing.map(p).join("")}
    <p style="margin:26px 0 0">
      <a href="${SITE}${esc(r.next.href)}"
         style="display:inline-block;background:#D8393D;color:#ffffff;text-decoration:none;
                font-weight:700;font-size:15px;padding:13px 22px">Next step: ${esc(r.next.text)} &rarr;</a>
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
  return [
    r.greeting, "",
    ...r.opening, "",
    "YOUR FOCUS: " + r.name.toUpperCase(),
    r.lede, "",
    ...r.body, "",
    "TRY THIS WEEK", "",
    ...r.tryThis, "",
    "WHERE THIS IS TAUGHT", "",
    r.taught, "",
    ...r.closing, "",
    "Next step: " + r.next.text + " " + SITE + r.next.href,
  ].join("\n");
}

async function sendResult(to, r) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("No Resend key; TGC quiz result not sent to", to); return false; }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `The Gymnastics Course <${FROM}>`,
        to: [to],
        reply_to: OFFICE,
        subject: `What your coaching needs next: ${r.name}`,
        text: emailText(r),
        html: emailHtml(r),
      }),
    });
    if (!res.ok) {
      console.error("Resend rejected the TGC quiz result to", to, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("TGC quiz result email failed for", to, e);
    return false;
  }
}

// ------------------------------------------------------------ interest list
//
// As with the TCC quiz, this does not talk to Brevo directly. It writes a row
// to interest_signups and the existing brevo-sync webhook does the rest —
// country to region, region list, brand list, General list, LIFECYCLE. Brand
// is tgc here rather than tcc, so these people land on the TGC list.
//
// The archetype column carries the focus key. It was added for the TCC quiz
// and holds the same kind of thing: which of a small set of results this
// person got.
export async function fileInterest(supabase, { email, firstName, lastName, focus, country }) {
  const { error } = await supabase.from("interest_signups").insert({
    brand: "tgc",
    email,
    name: [firstName, lastName].filter(Boolean).join(" ") || null,
    country: country || null,
    source: "tgc-quiz",
    archetype: focus,
  });
  if (error) console.error("interest_signups insert failed", error);
}

// ------------------------------------------------------- Conversions API
//
// Identical to the TCC quiz. The browser copy is lost whenever an ad blocker
// or tracking prevention gets in the way; this one leaves a server and always
// arrives. Meta collapses the two on event_id.
//
// Consent still decides. The page reports whether the pixel was allowed to
// run, and if it was not, nothing is sent from either side.

const CAPI_VERSION = "v25.0";
const PIXEL_ID = process.env.META_PIXEL_ID || "2663209040595150";

const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");
const norm = (v) => String(v || "").trim().toLowerCase();

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return null; }
    }
  }
  return null;
}

export async function sendLeadToMeta(req, context, info) {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) {
    console.error("META_CAPI_TOKEN is not set — the server-side Lead was not sent");
    return false;
  }

  const cookies = req.headers.get("cookie") || "";
  const country = norm(context?.geo?.country?.code);

  const user_data = {
    em: [sha256(norm(info.email))],
    fn: [sha256(norm(info.firstName))],
    ln: [sha256(norm(info.lastName))],
  };

  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || null;
  const ua = req.headers.get("user-agent") || null;
  if (ip) user_data.client_ip_address = ip;
  if (ua) user_data.client_user_agent = ua;
  if (country) user_data.country = [sha256(country)];

  const fbp = readCookie(cookies, "_fbp");
  const fbc = readCookie(cookies, "_fbc");
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;

  const payload = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        event_id: info.eventId,
        event_source_url: info.pageUrl,
        action_source: "website",
        user_data,
        custom_data: {
          content_name: "Gymnastics coaching focus",
          content_category: info.focus,
        },
      },
    ],
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${CAPI_VERSION}/${PIXEL_ID}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      }
    );
    const out = await res.json().catch(() => null);
    if (!res.ok) {
      console.error("Meta rejected the Lead", res.status, JSON.stringify(out));
      return false;
    }
    console.log("Lead sent to Meta", JSON.stringify(out));
    return true;
  } catch (e) {
    console.error("Meta Conversions API call failed", e);
    return false;
  }
}

// ---------------------------------------------------------------- handler

export default async (req, context) => {
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
    if (!email || /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email) === false) {
      return json({ error: "A valid email address is needed to send your result." }, 400);
    }

    const consent = body.marketingConsent === true;
    const pixelAllowed = body.pixelAllowed === true;
    const eventId = randomUUID();

    const scores = rungScores(answers);
    const total = answers.reduce((a, b) => a + b, 0);
    const key = focusFor(scores);

    const utm = body.utm && typeof body.utm === "object" ? body.utm : {};
    const cut = (v) => (v == null ? null : String(v).slice(0, 200));

    const { data: row, error: insErr } = await supabase.from("quiz_responses").insert({
      brand: "tgc",
      first_name: firstName,
      last_name: lastName,
      email,
      answers,
      score: total,
      rung_scores: scores,
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

    // ---- the follow-up chain ------------------------------------
    // Only people who ticked the box. The result email is the thing they
    // asked for and goes either way; this is marketing and does not.
    //
    // The one-chain rule is scoped to the TGC set only. Somebody already on a
    // TCC archetype chain can also be on a TGC focus chain — they are
    // different subjects and a coach may legitimately want both. Retaking the
    // TGC assessment and landing somewhere else leaves the original enrolment
    // standing rather than restarting them at week 1 of a different chain.
    if (consent) {
      try {
        const { data: already } = await supabase
          .from("drip_enrollments")
          .select("id")
          .eq("email", email)
          .in("chain", RUNGS)
          .limit(1);

        if (!already || !already.length) {
          const start = new Date();
          start.setDate(start.getDate() + 7);

          const { error: enrErr } = await supabase.from("drip_enrollments").insert({
            email,
            first_name: firstName,
            chain: key,
            start_date: start.toISOString().slice(0, 10),
            status: "active",
            source: "tgc-quiz",
          });
          if (enrErr) console.error("drip_enrollments insert failed", enrErr);
        }
      } catch (e) {
        console.error("Chain enrolment failed for", email, e);
      }

      try {
        await fileInterest(supabase, {
          email,
          firstName,
          lastName,
          focus: key,
          country: context?.geo?.country?.code ?? null,
        });
      } catch (e) {
        console.error("interest_signups failed for", email, e);
      }
    }

    // ---- tell Meta ----------------------------------------------
    // Everyone who finishes is a lead, whether or not they wanted the emails.
    // The advert did its job either way, and that is what the campaign is
    // optimised against. Consent to be tracked is a separate question from
    // consent to be written to, and only the first is being asked here.
    if (pixelAllowed) {
      try {
        await sendLeadToMeta(req, context, {
          eventId,
          email,
          firstName,
          lastName,
          focus: key,
          pageUrl: cut(body.pageUrl) || `${SITE}/tgc/quiz/`,
        });
      } catch (e) {
        console.error("Server-side Lead failed for", email, e);
      }
    }

    const result = resultFor(key, firstName, scores);
    const sent = await sendResult(email, result);

    if (sent && row && row.id) {
      await supabase
        .from("quiz_responses")
        .update({ emailed_at: new Date().toISOString() })
        .eq("id", row.id);
    }

    return json({
      ok: true,
      id: row ? row.id : null,
      emailed: sent,
      score: total,
      scores,
      result,
      eventId: pixelAllowed ? eventId : null,
    });
  } catch (e) {
    console.error("tgc-quiz-submit failed", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
