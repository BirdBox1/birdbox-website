// netlify/functions/outreach-send.mjs
//
// One-off cold outreach sender for the Ipswich TCC L1 seminar.
// Sends 13 individual emails via Resend. Each recipient gets exactly one
// message addressed only to them — no CC, no BCC of other recipients.
//
// USAGE
//   Dry run (default — sends nothing, shows what would go):
//     https://birdboxcoaching.com/.netlify/functions/outreach-send?key=YOUR_KEY
//
//   Send for real:
//     ...?key=YOUR_KEY&send=1
//
//   Send only certain ones (1-based, matches the numbering in the drafts):
//     ...?key=YOUR_KEY&send=1&only=6,10,12
//
// ENV VARS REQUIRED
//   RESEND_API_KEY    already set for the rest of the site
//   OUTREACH_KEY      set this to any random string; it guards the endpoint
//   CONFIRM_FROM      optional, defaults to info@birdboxcoaching.com

const FROM     = process.env.CONFIRM_FROM || "info@birdboxcoaching.com";
const REPLY_TO = "info@birdboxcoaching.com";

// Set to an address to keep a copy of every send. Leave null for none.
// Using the sending address means copies land back in the same inbox.
const BCC = "info@birdboxcoaching.com";


const SIGNATURE = `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:520px; max-width:520px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <tr>
    <td bgcolor="#14100F" style="background-color:#14100F; padding:14px 20px;">
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td valign="middle" style="padding-right:18px;">
            <img src="https://birdbox-train.netlify.app/logos/birdbox-light.png" alt="BirdBox Coaching" width="43" height="46" style="width:43px; height:46px; display:block; border:0;">
          </td>
          <td valign="middle" style="border-left:1px solid #3A3436; padding-left:18px;">
            <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td valign="top" style="padding-right:24px;"><a href="https://www.birdboxcoaching.com/tcc" style="text-decoration:none;"><img src="https://birdbox-train.netlify.app/logos/tcc.png" alt="The Coaches Course" width="67" height="31" style="width:67px; height:31px; display:block; border:0;"></a></td>
                <td valign="top" style="padding-right:24px;"><a href="https://www.birdboxcoaching.com/tgc" style="text-decoration:none;"><img src="https://birdbox-train.netlify.app/logos/tgc.png" alt="The Gymnastics Course" width="49" height="40" style="width:49px; height:40px; display:block; border:0;"></a></td>
                <td valign="top" style="padding-right:24px;"><a href="https://www.birdboxcoaching.com/tec" style="text-decoration:none;"><img src="https://birdbox-train.netlify.app/logos/tec.png" alt="The Endurance Course" width="52" height="32" style="width:52px; height:32px; display:block; border:0;"></a></td>
                <td valign="top"><a href="https://www.birdboxcoaching.com/twc" style="text-decoration:none;"><img src="https://birdbox-train.netlify.app/logos/twc.png" alt="The Weightlifting Course" width="67" height="30" style="width:67px; height:30px; display:block; border:0;"></a></td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:16px 0 0 0;">
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:21px; line-height:25px; font-weight:bold; color:#14100F; text-transform:uppercase; letter-spacing:0.01em;">Nathan Bird</div>
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:12px; line-height:18px; color:#6E7378; letter-spacing:0.04em; padding-top:4px;">BSc, MSc, PhD Candidate, CSCS, CCFT</div>
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; line-height:16px; color:#2B87CE; text-transform:uppercase; letter-spacing:0.09em; font-weight:bold; padding-top:8px;">Founder &amp; CEO</div>
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:13px; line-height:19px; color:#14100F;">BirdBox Coaching</div>
    </td>
  </tr>

  <tr>
    <td style="padding:16px 0 0 0;">
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:520px;">
        <tr>
          <td valign="middle" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:12px; line-height:20px; color:#6E7378; padding-right:24px;">
            <a href="https://www.birdboxcoaching.com" style="color:#14100F; text-decoration:none;">birdboxcoaching.com</a><br>
            <a href="https://www.instagram.com/birdbox_coaching" style="color:#6E7378; text-decoration:none;">@birdbox_coaching</a>
          </td>
          <td valign="middle" align="right">
            <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td bgcolor="#4FA8DE" style="background-color:#4FA8DE; padding:10px 20px;">
                  <a href="https://www.birdboxcoaching.com/seminars/" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:12px; line-height:14px; font-weight:bold; color:#0C1116; text-decoration:none; text-transform:uppercase; letter-spacing:0.08em;">Upcoming seminars</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:14px 0 0 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:10px; line-height:15px; color:#9AA0A6;">
      BirdBox Coaching Ltd &mdash; The Coaches Course, The Gymnastics Course, The Endurance Course, The Weightlifting Course
    </td>
  </tr>
</table>`;

const RECIPIENTS = [
  {
    gym: "HUNTER STRENGTH AND FITNESS",
    to: "info@hunterstrengthandfitness.com",
    subject: "Coaching seminar down the road this weekend",
    body: "Hi,\n\nI run BirdBox Coaching. We're at Orwell Fitness on Peppers Lane this\nSaturday and Sunday with The Coaches Course Level 1.\n\nThe two days are built around one distinction: an instructor delivers\na session, a coach changes what happens in it. We cover movement\nmastery, the biomechanical principles behind it, and the interventions\nthat actually fix a fault — plus the leadership and communication side\nthat decides whether any of it lands.\n\nYou've got serious lifters and serious knowledge in that building. The\nquestion this course answers is how you transfer it to someone else.\n\nTwo days, £600. We can spread it over eight months with no interest —\nnot on the booking page, so just say the word.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/\n\nEven if this weekend's wrong, worth a reply. We run UK dates through\n2027 and it's easier to plan with notice."
  },
  {
    gym: "FORTITUDE FITNESS",
    to: "hello@fortitudefitness.co",
    subject: "Coaching seminar in Ipswich this weekend",
    body: "Hi Jemma,\n\nNathan from BirdBox Coaching. We're running The Coaches Course Level 1\nat Orwell Fitness this Saturday and Sunday.\n\nTwo days on the difference between an instructor and a coach. Movement\nmastery and the biomechanical principles underneath it, the\ninterventions that change what someone's doing, and a framework for\nthinking like a coach rather than working from a script.\n\nAnyone can run a class off a plan. The skill is spotting the person\nwho needs something different and knowing what to do about it.\n\n£600. If cost is the sticking point we can spread it over eight months\nwith no interest — reply and I'll set it up.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/\n\nThree days' notice is short. Reply either way and I'll tell you when\nwe're next nearby — most people say they'd have come if they'd known."
  },
  {
    gym: "RESHAPE",
    to: "team@reshapeclub.com",
    subject: "Coach development seminar, Ipswich this weekend",
    body: "Hi,\n\nNathan from BirdBox Coaching. We're at Orwell Fitness this Saturday and\nSunday with The Coaches Course Level 1.\n\nThe course is built around the gap between an instructor and a coach.\nMovement mastery, biomechanical principles, interventions that actually\nchange what a person does, and a framework for thinking like a coach —\nalongside leadership, communication and individualised coaching.\n\nYou've built the business on coaches carrying people through a long\nprocess. That's a coaching job, not an instructing one, and this is the\nmaterial that separates the two.\n\n£600. We can arrange eight monthly payments with no interest, useful if\nyou're sending more than one — just ask.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/\n\nIf this weekend doesn't work, reply and I'll send our UK dates for next\nyear."
  },
  {
    gym: "AIRBORNE FIT",
    to: "enquiries@airbornefit.com",
    subject: "Coach development seminar at Orwell Fitness this weekend",
    body: "Hi Luke,\n\nNathan from BirdBox Coaching. We're running The Coaches Course Level 1\nat Orwell Fitness this Saturday and Sunday.\n\nTwo days on what separates a coach from an instructor. Movement\nmastery, biomechanical principles, interventions, and a framework for\nthinking like a coach — plus leadership, communication and coaching\nphilosophy, which is the part that makes a room work.\n\nThe community at Airborne is clearly built rather than lucky. That's a\ncoaching skill, and it's one nobody teaches formally. We do. Might suit\nMJ or whoever else is leading sessions.\n\n£600. We can split it into eight interest-free monthly payments if that\nmakes sending a couple of coaches easier — reply and I'll sort it.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/\n\nThree days' notice is nothing, I realise. Worth a reply anyway — we\nplan UK dates well ahead."
  },
  {
    gym: "GRANGE FITNESS & PERFORMANCE",
    to: "gym@grangefitness.com",
    subject: "Coach development seminar in Ipswich this weekend",
    body: "Hi,\n\nNathan from BirdBox Coaching. We're at Orwell Fitness this Saturday and\nSunday running The Coaches Course Level 1 — a CrossFit approved course.\n\nThe two days are about becoming a coach rather than an instructor.\nMovement mastery, the biomechanical principles behind it, interventions\nthat fix rather than just flag a fault, and a framework for thinking\nlike a coach — with leadership, communication and coaching styles\nrunning through it.\n\nRelevant to you specifically: your coaches move between CrossFit,\nboxing and the kids programme. The technical knowledge transfers. The\ncoaching approach doesn't, not automatically — that's the material\nhere.\n\nWe also run a gymnastics course, which given the kids programme may be\nthe better fit longer term. Happy to send details.\n\n£600, and we can arrange eight monthly payments with no interest —\nit isn't on the page, so just ask.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/"
  },
  {
    gym: "CLAYDON CROSSFIT",
    to: "ben@claydoncrossfit.co.uk",
    subject: "Coach development seminar at Orwell Fitness this weekend",
    body: "Hi Ben,\n\nNathan from BirdBox Coaching. We're at Orwell Fitness on Peppers Lane\nthis Saturday and Sunday with The Coaches Course Level 1 — a CrossFit\napproved course.\n\nWriting rather than assuming you're covered, because this isn't a\nrepeat of the L1. It's built on the difference between an instructor\nand a coach: movement mastery and the biomechanical principles behind\nit, the interventions that change what someone's actually doing, and a\nframework for thinking like a coach instead of running a script.\n\nThe L1 tells your coaches what a good air squat looks like. It doesn't\ntell them what to do about the one that still isn't fixed after the\nthird cue.\n\n£600. If you want to send more than one, we can spread the cost over\neight months with no interest — reply and I'll set that up.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/"
  },
  {
    gym: "BREAKTHROUGH FITNESS",
    to: "josh@breakthroughfitness.co.uk",
    subject: "Coach development seminar, Ipswich this weekend",
    body: "Hi Josh,\n\nNathan from BirdBox Coaching. We're running The Coaches Course Level 1\nat Orwell Fitness this Saturday and Sunday.\n\nTwo days on coaching rather than instructing. Movement mastery,\nbiomechanical principles, interventions, individualised coaching, and a\nframework for thinking like a coach when the plan meets a real person.\n\nGiven who you work with, you're already doing the hardest version of\nthis daily — the standard progression doesn't apply and you have to\nreason from principles instead. That's exactly what the course builds.\n\n£600. We can also do eight monthly payments with no interest if that's\neasier — just ask, it isn't on the booking page.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/\n\nVery short notice. Reply either way and I'll flag our next UK dates."
  },
  {
    gym: "ATP FITNESS FELIXSTOWE",
    to: "george@atpfitnessfelixstowe.com",
    subject: "Coach development seminar in Ipswich this weekend",
    body: "Hi George,\n\nNathan from BirdBox Coaching. We're at Orwell Fitness this Saturday and\nSunday with The Coaches Course Level 1.\n\nThe two days are built on the split between an instructor and a coach.\nMovement mastery, biomechanical principles, the interventions that\nactually shift a fault, and a framework for coaching a group where\neveryone needs something slightly different.\n\nYou cap classes at ten or twelve, which means you're coaching them\nrather than counting reps. That's where interventions matter — you can\nsee everyone, so there's nowhere to hide from the fault you spotted.\n\n£600, and we can spread it over eight interest-free monthly payments —\nreply and I'll arrange it.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/\n\nTwenty-minute drive and three days' notice. If not this time, reply and\nI'll let you know when we're back."
  },
  {
    gym: "THE TRAINING GROUND",
    to: "woolener@hotmail.co.uk",
    subject: "Coach development seminar in Ipswich this weekend",
    body: "Hi Chris,\n\nNathan from BirdBox Coaching. We're running The Coaches Course Level 1\nat Orwell Fitness this Saturday and Sunday.\n\nMovement mastery, biomechanical principles, interventions, and a\nframework for thinking like a coach rather than an instructor —\nalongside leadership, communication and individualised coaching.\n\nTen years in, you'll have most of this in your hands already. What\nexperienced coaches tend to take from it is the framework — being able\nto explain why you're doing something, which matters as much for\nselling the session as delivering it.\n\n£600. We can split it into eight monthly payments with no interest if\nthat suits better — just say.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/"
  },
  {
    gym: "CROSSFIT COLCHESTER",
    to: "info@crossfitcolchester.com",
    subject: "Coach development seminar at Orwell Fitness, Ipswich",
    body: "Hi Chris,\n\nNathan from BirdBox Coaching. We're at Orwell Fitness in Ipswich this\nSaturday and Sunday with The Coaches Course Level 1 — a CrossFit approved\ncourse.\n\nIt sits alongside the CrossFit pathway rather than repeating it. The\ntwo days are built on the difference between an instructor and a coach:\nmovement mastery, biomechanical principles, interventions that resolve\na fault instead of just naming it, and a framework for thinking like a\ncoach.\n\nYou've been going long enough to have coaches at very different stages.\nThis is usually most valuable for the ones who know the mechanics cold\nand still can't get a member to change anything.\n\n£600. If you're sending more than one, we can spread the cost over\neight months with no interest — reply and I'll arrange it.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/\n\nForty minutes up the A12 and short notice. Reply either way and I'll\nsend our 2027 UK dates."
  },
  {
    gym: "FORTIFY FITNESS",
    to: "fortifyfitnesslimited@outlook.com",
    subject: "Coach development seminar, Ipswich this weekend",
    body: "Hi,\n\nNathan from BirdBox Coaching. We're running The Coaches Course Level 1\nat Orwell Fitness in Ipswich this Saturday and Sunday.\n\nMovement mastery, biomechanical principles, interventions, and a\nframework for thinking like a coach rather than an instructor — plus\nleadership, communication and individualised coaching.\n\nYou've got Ben, Connor and Lleyton all coaching, from what I can see.\nA shared framework is where this pays off — it's the difference\nbetween three good coaches and a gym that coaches consistently.\n\n£600 each. We can spread that over eight interest-free monthly\npayments, which makes sending a few far easier to absorb — just ask.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/\n\nFair drive from Sudbury and I'm giving you three days. Reply and I'll\nmake sure you know about the next one properly in advance."
  },
  {
    gym: "T800 CROSSFIT",
    to: "training@t800crossfit.co.uk",
    subject: "Coach development seminar in Ipswich this weekend",
    body: "Hi Paul,\n\nNathan from BirdBox Coaching. We're at Orwell Fitness in Ipswich this\nSaturday and Sunday with The Coaches Course Level 1 — a CrossFit approved\ncourse.\n\nIt's the coaching layer rather than the methodology: movement mastery,\nbiomechanical principles, the interventions that change what someone's\ndoing, and a framework for thinking like a coach rather than an\ninstructor.\n\nI gather your members run from four years old to seventy-two. Coaching\nthat range isn't a scaling problem — the same intervention has to be\ndelivered completely differently depending on who's in front of you.\nThat's most of these two days.\n\n£600. We can arrange eight monthly payments with no interest if you\nwant to bring Thomas and Emily too — reply and I'll set it up.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/\n\nShort notice and a drive from Eye. Reply either way — I'd rather you\nhad proper warning next time."
  },
  {
    gym: "CROSSFIT BEORN",
    to: "info@crossfitbeorn.com",
    subject: "Coach development seminar in Ipswich this weekend",
    body: "Hi Richard,\n\nNathan from BirdBox Coaching. We're running The Coaches Course Level 1\nat Orwell Fitness in Ipswich this Saturday and Sunday — a CrossFit\napproved course.\n\nIt complements the CrossFit pathway rather than duplicating it. Two\ndays on movement mastery and the biomechanical principles behind it,\nthe interventions that resolve a fault, and a framework for thinking\nlike a coach instead of an instructor.\n\nYou've said form and technique are the focus at Beorn. This adds the\nnext bit: what you do when someone understands the movement perfectly\nand still isn't performing it. Knowing the fault and fixing it are\ndifferent skills.\n\n£600, and we can spread it over eight months with no interest — just\nask, it isn't on the booking page.\n\nhttps://birdboxcoaching.com/c/tcc-l1-ipswich-0926/\n\nBury to Ipswich with three days' notice is a big ask. Reply and I'll\nmake sure you get the 2027 dates early."
  }
];

// Plain text -> simple HTML. Blank-line separated paragraphs, bare URLs linked.
function toHtml(text) {
  const esc = (s) => s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const paras = text.split(/\n\s*\n/).map((p) => {
    // Rejoin the hard-wrapped lines so the email reflows on any screen.
    let joined = esc(p.split("\n").map((l) => l.trim()).join(" ")).trim();
    joined = joined.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" style="color:#2B87CE;">$1</a>'
    );
    return `<p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#14100F; margin:0 0 16px 0;">${joined}</p>`;
  });

  return `<div style="max-width:520px;">
${paras.join("\n")}
<div style="padding-top:12px;">
${SIGNATURE}
</div>
</div>`;
}

// Plain-text alternative, for clients that won't render HTML.
function toText(text) {
  return text + "\n\n--\nNathan Bird\nBSc, MSc, PhD Candidate, CSCS, CCFT\nFounder & CEO, BirdBox Coaching\nbirdboxcoaching.com\n";
}

async function sendOne(r) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `Nathan Bird <${FROM}>`,
      to: [r.to],
      ...(BCC ? { bcc: [BCC] } : {}),
      reply_to: REPLY_TO,
      subject: r.subject,
      html: toHtml(r.body),
      text: toText(r.body)
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || `Resend returned ${res.status}`);
  }
  return data.id || "sent";
}

export default async (request) => {
  const url = new URL(request.url);

  // Guard. Without this the endpoint is public and anyone could fire it.
  const expected = process.env.OUTREACH_KEY;
  if (!expected || url.searchParams.get("key") !== expected) {
    return new Response("Not found", { status: 404 });
  }

  if (!process.env.RESEND_API_KEY) {
    return Response.json({ error: "RESEND_API_KEY is not set" }, { status: 500 });
  }

  const live = url.searchParams.get("send") === "1";

  // ?only=6,10 restricts to those numbers. Useful for re-running failures.
  const onlyParam = url.searchParams.get("only");
  const only = onlyParam
    ? onlyParam.split(",").map((n) => parseInt(n.trim(), 10)).filter(Boolean)
    : null;

  const queue = RECIPIENTS
    .map((r, i) => ({ ...r, n: i + 1 }))
    .filter((r) => !only || only.includes(r.n));

  const results = [];

  for (const r of queue) {
    if (!live) {
      results.push({
        n: r.n, gym: r.gym, to: r.to, subject: r.subject,
        status: "dry-run", chars: r.body.length
      });
      continue;
    }

    try {
      const id = await sendOne(r);
      results.push({ n: r.n, gym: r.gym, to: r.to, status: "sent", id });
    } catch (err) {
      results.push({
        n: r.n, gym: r.gym, to: r.to, status: "FAILED",
        error: String(err.message || err)
      });
    }

    // Small gap so we stay well inside Resend's rate limit.
    // 13 x 250ms is about 3 seconds of waiting, comfortably inside the
    // 10 second function timeout even with the API calls on top.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const sent   = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "FAILED");

  return Response.json({
    mode: live ? "LIVE" : "dry-run",
    from: FROM,
    replyTo: REPLY_TO,
    bcc: BCC || "(none)",
    queued: queue.length,
    sent,
    failed: failed.length,
    retryFailedWith: failed.length
      ? `?key=...&send=1&only=${failed.map((f) => f.n).join(",")}`
      : null,
    results
  });
};
