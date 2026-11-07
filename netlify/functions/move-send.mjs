// netlify/functions/move-send.mjs
//
// The CoachRx move email (Nathan, 1 Nov 2026). Each athlete Barney
// invited (train.move_offers, loaded from his sheet) gets one email from
// BirdBox, with Barney copied, and a button to their own page
// (/learn/?move=CODE). There one tap emails them a login link, and once
// in they see their offer: their price, Tier 2 where offered, and the
// free trial only for someone not paying CoachRx now.
//
// Admin only. Nothing goes out without one of these being asked for:
//
//   POST { list: true }                 -> { offers }   everyone, for the portal
//   POST { preview: email }             -> { subject, text }   nothing sent
//   POST { test: email, to }            -> that person's email, sent to "to"
//                                          only; their status is not changed
//   POST { send: true, emails? }        -> up to 10 of those still "ready"
//                                          (or just the emails listed) are
//                                          sent and marked "emailed";
//                                          { sent, failed, remaining }
//
// The reminder (Nathan, 7 Nov 2026): add reminder: true to preview or test
// to see it, and POST { remind: true } sends it, 10 at a time, to everyone
// "emailed" who has not been reminded yet. Anyone already on a plan is
// skipped (and marked, so they are not looked at again).
//                                          { sent, skipped, failed, remaining }

import { createClient } from "@supabase/supabase-js";
import { senderFor, sendEmail } from "./course-email-send.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const train = supabase.schema("train");

const SITE = (process.env.SITE_URL || "https://birdboxcoaching.com").replace(/\/+$/, "");
const BARNEY = process.env.MOVE_CC || "barney@birdboxcoaching.com";
const MOVE_DAY = "Monday 9 November";
// the offer must be taken by then (learn-account.mjs MOVE_DEADLINE), Nathan 6 Nov 2026
const DEADLINE = "Sunday 22 November";
const BATCH = 10;
const APP_STORE = "https://apps.apple.com/app/id6806654607";
const PLAY_STORE = "https://play.google.com/store/apps/details?id=com.birdboxcoaching.programming";

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return json({ error: "Not signed in" }, 401);
    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth || !auth.user) return json({ error: "Your session has expired — sign in again." }, 401);

    const { data: me } = await supabase
      .from("staff")
      .select("id, full_name, email, role, active")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (!me || !me.active) return json({ error: "Not a member of staff" }, 403);
    if (me.role !== "admin") return json({ error: "Only an admin can do this" }, 403);

    const b = await request.json();
    if (b.list) {
      const { data, error } = await train.from("move_offers")
        .select("email, first_name, last_name, offer, price_cents, free_until, coachrx_status, notes, status, emailed_at, reminded_at, moved_at, moved_tier, upgrade_until")
        .order("last_name");
      if (error) throw new Error(error.message);
      return json({ offers: data || [] });
    }
    if (b.preview) {
      const o = await offer(b.preview);
      return o ? json(b.reminder ? writeReminder(o) : write(o)) : json({ error: "No offer for that email." }, 404);
    }
    if (b.test) {
      const o = await offer(b.test);
      if (!o) return json({ error: "No offer for that email." }, 404);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.to || ""))) return json({ error: "Say who the test goes to." }, 400);
      const m = b.reminder ? writeReminder(o) : write(o);
      const r = await sendEmail({ to: b.to, sender: SENDER, subject: "[Test] " + m.subject, text: m.text, html: m.html, copyOffice: false });
      return r.ok ? json({ sent: true, to: b.to }) : json({ error: "The email did not send: " + r.error }, 502);
    }
    if (b.send === true) return json(await sendBatch(b.emails));
    if (b.remind === true) return json(await remindBatch());
    return json({ error: "Nothing asked for." }, 400);
  } catch (err) {
    console.error("move-send failed:", err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

// From BirdBox, not from whoever pressed the button
const SENDER = senderFor({ full_name: "BirdBox Coaching", email: "info@birdboxcoaching.com" });

async function offer(email) {
  const { data } = await train.from("move_offers")
    .select("*").eq("email", String(email).trim().toLowerCase()).maybeSingle();
  return data;
}

async function sendBatch(emails) {
  let q = train.from("move_offers").select("*").eq("status", "ready").order("created_at").limit(BATCH);
  if (Array.isArray(emails) && emails.length) q = q.in("email", emails.map((e) => String(e).trim().toLowerCase()));
  const { data: list, error } = await q;
  if (error) throw new Error(error.message);

  const sent = [], failed = [];
  for (const o of list || []) {
    const m = write(o);
    const r = await sendEmail({ to: o.email, sender: SENDER, subject: m.subject, text: m.text, html: m.html,
      copyOffice: false, cc: [BARNEY] });
    if (!r.ok) { failed.push({ email: o.email, error: r.error }); continue; }
    await train.from("move_offers").update({ status: "emailed", emailed_at: new Date().toISOString() }).eq("id", o.id);
    sent.push(o.email);
  }
  const { count } = await train.from("move_offers").select("id", { count: "exact", head: true }).eq("status", "ready");
  return { sent, failed, remaining: count || 0 };
}

// The reminder, 10 at a time: everyone emailed, not moved, not reminded.
// Someone already on a programming plan (an older free account, say) is
// skipped and marked so the next batch moves on.
async function remindBatch() {
  const todo = () => train.from("move_offers").select("*", { count: "exact" })
    .eq("status", "emailed").is("reminded_at", null);
  const { data: list, error } = await todo().order("created_at").limit(BATCH);
  if (error) throw new Error(error.message);

  const sent = [], skipped = [], failed = [];
  for (const o of list || []) {
    if (await onPlan(o.email)) {
      await train.from("move_offers").update({ reminded_at: new Date().toISOString() }).eq("id", o.id);
      skipped.push(o.email);
      continue;
    }
    const m = writeReminder(o);
    const r = await sendEmail({ to: o.email, sender: SENDER, subject: m.subject, text: m.text, html: m.html,
      copyOffice: false, cc: [BARNEY] });
    if (!r.ok) { failed.push({ email: o.email, error: r.error }); continue; }
    await train.from("move_offers").update({ reminded_at: new Date().toISOString() }).eq("id", o.id);
    sent.push(o.email);
  }
  const { count } = await todo().limit(1);
  return { sent, skipped, failed, remaining: count || 0 };
}

// on a programming plan already (not the trial)
async function onPlan(email) {
  const { data: a } = await train.from("athletes").select("id").eq("email", email).maybeSingle();
  if (!a) return false;
  const { count } = await train.from("enrolments").select("id", { count: "exact", head: true })
    .eq("athlete_id", a.id).eq("is_trial", false).in("status", ["consulting", "active", "past_due", "paused"]);
  return (count || 0) > 0;
}

// The reminder (Nathan, 7 Nov 2026). Only 15 of 174 had moved by the
// evening: most had not opened the first email, and of those who started,
// most opened the app before adding their card and found no programming.
// So: short, CoachRx is ending, their offer in one line, and the two steps
// in the right order, card first, app second.
function writeReminder(o) {
  const name = o.first_name || "there";
  const link = `${SITE}/learn/?move=${o.code}`;
  const free = o.offer === "free";
  const price = euro(o.price_cents);
  const dublin = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });
  const ending = dublin <= "2026-11-08"
    ? (dublin === "2026-11-08" ? "CoachRx programming ends today." : "CoachRx programming ends on Sunday 8 November.")
    : "CoachRx programming has now ended.";
  const offerLine = free
    ? "Your offer: a free account with the full TGC programming. No card needed."
    : o.offer === "t2_offer"
      ? `Your offer: Gymnastics + Community, normally ${euro(NORMAL[2])} a month, yours for ${price} a month for as long as you keep it.`
      : `Your offer: Gymnastics at ${price} a month for as long as you keep it.`;
  const payLine = free ? null : o.free_until
    ? `Nothing is taken until ${dayLong(o.free_until)}, as you have already paid CoachRx up to then. Not sure yet? Add your card anyway: you can cancel any time before then and nothing is ever taken.`
    : "Your first payment is taken when you join, then on the same day each month.";
  const step1 = free
    ? "Tap <b>See my offer</b>, sign in with this email and tap <b>Start my free account</b>."
    : "Tap <b>See my offer</b>, sign in with this email and add your card.";
  const step2 = "Then get the BirdBox Coaching app and sign in with the same email. Your programming will be there.";
  const warn = "Please do step 1 first. If you open the app before, it cannot find your programming yet.";
  const intro = `A quick reminder from us and Barney. ${ending} Your programming carries on in our own app, BirdBox Coaching, and your place is waiting for you.`;

  const text = [
    `Hi ${name},`,
    intro,
    offerLine,
    payLine,
    "Two steps, in this order:",
    `1. ${strip(step1)}\n2. ${strip(step2)}`,
    `[[BUTTON: See my offer | ${link}]]`,
    warn,
    `Get the app: ${GET_APP}`,
    `This offer is open until ${DEADLINE}. Any questions, just reply to this email. Barney is copied in.`,
    "Nathan and Barney\nBirdBox Coaching",
  ].filter(Boolean).join("\n\n");

  const p = "margin:0 0 14px;font-size:15px;line-height:1.6;color:#3d3936;";
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f3f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f1;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e3e0;">
  <tr><td style="padding:22px 26px 14px;" align="center">
    <img src="${LOGO}" alt="The Gymnastics Course" width="300" style="display:block;width:100%;max-width:300px;height:auto;border:0;" />
  </td></tr>
  <tr><td style="padding:8px 26px 30px;">
    <h1 style="margin:0 0 16px;font-size:22px;color:#191513;letter-spacing:-0.3px;">One step to keep your programming</h1>
    <p style="${p}">Hi ${esc(name)},</p>
    <p style="${p}">${intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:#f4f3f1;border-radius:10px;" bgcolor="#f4f3f1"><tr><td bgcolor="#f4f3f1" style="padding:16px 18px;">
      <p style="margin:0 0 ${payLine ? 8 : 0}px;font-size:15px;line-height:1.6;color:#191513;"><b>${offerLine}</b></p>
      ${payLine ? `<p style="margin:0;font-size:14px;line-height:1.6;color:#191513;">${payLine}</p>` : ""}
    </td></tr></table>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#191513;"><b>Two steps, in this order:</b></p>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#3d3936;">1. ${step1}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 14px;"><tr>
      <td bgcolor="#191513" style="background:#191513;border-radius:10px;"><a href="${link}" style="display:inline-block;padding:14px 26px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">See my offer</a></td></tr></table>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#3d3936;">2. ${step2} <a href="${GET_APP}" style="color:#191513;">Get the app</a></p>
    <p style="margin:14px 0 14px;font-size:14px;line-height:1.6;color:#191513;padding:10px 14px;border:1px solid #e6e3e0;border-radius:10px;">${warn}</p>
    <p style="${p}">This offer is open until ${DEADLINE}. Any questions, just reply to this email. Barney is copied in.</p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#191513;">Nathan and Barney<br>BirdBox Coaching</p>
  </td></tr>
  <tr><td style="padding:14px 26px;border-top:1px solid #e6e3e0;font-size:12px;color:#3d3936;">BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland</td></tr>
</table></td></tr></table></body></html>`;

  const subject = dublin === "2026-11-08" ? "CoachRx ends today: one step to keep your programming"
    : "One step to keep your TGC programming";
  return { subject, text, html };
}

// The email, written for this one person's offer. Redesigned 7 Nov 2026
// (Nathan): The Gymnastics Course logo at the top as on the welcome email;
// "improved programming"; what they get and what it normally costs; their
// own payment day in a box of its own (card now, nothing taken until the
// date they paid CoachRx up to, CoachRx payments stopped, never charged
// twice); one dark "See my offer" button and one "Get the app" button with
// the two stores as small links, as the welcome email has.
const LOGO = "https://birdbox-train.netlify.app/logos/email-tgc.png";
const GET_APP = "https://birdbox-train.netlify.app/get-app.html";
const NORMAL = { 1: 3500, 2: 6000, 3: 12000 };

function write(o) {
  const price = euro(o.price_cents);
  const t3 = 12000 - Math.max(0, 3500 - o.price_cents);
  const free = o.offer === "free";
  const paid = !free && o.free_until;
  // on a CoachRx free trial, never paid: the free time is given, not paid for (Nathan, 7 Nov 2026)
  const trial = /^TRIALING/i.test(o.coachrx_status || "");
  const lapsed = /last payment failed/i.test(o.coachrx_status || "");
  const name = o.first_name || "there";
  const link = `${SITE}/learn/?move=${o.code}`;

  // what they get, and what it normally costs
  const plan = {
    t2_offer: { title: "Gymnastics + Community", line: `Normally ${euro(NORMAL[2])} a month. Yours for <b>${price} a month</b>, VAT included, for as long as you keep your plan.`,
      what: "The improved TGC programming plus the premium community: coaching questions answered, a place to share your training videos, and feedback from Barney in the group." },
    t1_promised: { title: "Gymnastics", line: `Normally ${euro(NORMAL[1])} a month. You keep <b>${price} a month</b>, VAT included, for as long as you keep your plan.`,
      what: "The improved TGC programming, with every session, demonstration video and your results in the app." },
    t1_only: { title: "Gymnastics", line: `<b>${price} a month</b>, VAT included, for as long as you keep your plan.`,
      what: "The improved TGC programming, with every session, demonstration video and your results in the app." },
    free: { title: "Gymnastics: free account", line: "<b>Free</b>. No card needed.",
      what: "The improved TGC programming, with every session, demonstration video and your results in the app." },
  }[o.offer];

  // their own payment day
  const monthly = paid ? `the ${ordinal(Number(o.free_until.slice(8, 10)))} of each month` : null;
  const payBox = free ? null : paid
    ? {
        head: `Nothing is taken until ${dayLong(o.free_until)}`,
        rows: [
          trial
            ? `As Barney said, you get the new app <b>free until ${dayLong(o.free_until)}</b>, in place of your CoachRx free trial.`
            : `You have already paid CoachRx up to <b>${dayLong(o.free_until)}</b>, so the new app is yours free until then.`,
          // no risk in adding the card (Nathan, 7 Nov 2026)
          `<b>Not sure yet? Add your card anyway.</b> If you decide not to continue, cancel in BirdBox Learn (Student Login on our website) any time before ${day(o.free_until)} and nothing is ever taken.`,
          `If you carry on, your first payment is ${price} on ${day(o.free_until)}, then on ${monthly}.`,
          trial
            ? "Your CoachRx trial ends without any payment, so nothing is taken there. You will never be charged twice."
            : "Your CoachRx payments are stopped, so nothing more is taken there. You will never be charged twice.",
        ],
      }
    : {
        // they have had the programming free while the app was built (Barney and Nathan, 7 Nov 2026)
        head: "Your first payment is when you join",
        rows: [
          // paid CoachRx, then the last payment failed (Nathan, 7 Nov 2026)
          lapsed
            ? "Your last CoachRx payment did not go through, and that plan has now ended. We will not ask for it."
            : "When the programme moved to CoachRx, a payment was never set up on your account, so you have had your programming free while we built the new app. Thank you for your patience. We will not ask for anything you missed.",
          `To carry on in the new app, a paid plan now starts: your first ${price} is taken when you join, then on the same day each month.`,
          "You can take the two-week free trial instead, but if you do, this offer is no longer available and afterwards you see the normal prices.",
        ],
      };

  const upLine = o.offer === "t1_promised" && t3 < 12000
    ? `For 40 days after you join you can also move up at a reduced price, from the same page: Gymnastics + Community for €35, or Gymnastics + 1:1 Feedback for ${euro(t3)} a month.`
    : null;
  const steps = [
    `Tap <b>See my offer</b>, then <b>Email me my login link</b>. We email a link to this address.`,
    free ? "The link opens your offer. Tap <b>Start my free account</b>." : "The link opens your offer. Tap the plan and add your card.",
    "Get the BirdBox Coaching app and sign in with this same email.",
  ];
  const intro = "As Barney mentioned, your TGC programming is moving from CoachRx to our own app, BirdBox Coaching. It is improved programming from the same coaches, with your sessions, videos and results in one place. CoachRx programming ends on Sunday 8 November, so please move over this weekend.";

  const text = [
    `Hi ${name},`,
    intro,
    `YOUR PLAN: ${plan.title}. ${strip(plan.line)} ${plan.what}`,
    payBox && `${payBox.head.toUpperCase()}\n${payBox.rows.map((r) => "- " + strip(r)).join("\n")}`,
    upLine,
    `This offer is open until ${DEADLINE}.`,
    `[[BUTTON: See my offer | ${link}]]`,
    steps.map((s, i) => `${i + 1}. ${strip(s)}`).join("\n"),
    `[[BUTTON: Get the app | ${GET_APP}]]`,
    `Or go straight to the App Store (${APP_STORE}) or Google Play (${PLAY_STORE}).`,
    "Any questions, just reply to this email. Barney is copied in.",
    "Nathan and Barney\nBirdBox Coaching",
  ].filter(Boolean).join("\n\n");

  const p = "margin:0 0 14px;font-size:15px;line-height:1.6;color:#3d3936;";
  const head = "margin:22px 0 8px;font-size:13px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#191513;";
  const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 14px;"><tr>
      <td bgcolor="#191513" style="background:#191513;border-radius:10px;"><a href="${href}" style="display:inline-block;padding:14px 26px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">${label}</a></td></tr></table>`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f3f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f1;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e3e0;">
  <tr><td style="padding:22px 26px 14px;" align="center">
    <img src="${LOGO}" alt="The Gymnastics Course" width="300" style="display:block;width:100%;max-width:300px;height:auto;border:0;" />
  </td></tr>
  <tr><td style="padding:8px 26px 30px;">
    <h1 style="margin:0 0 16px;font-size:22px;color:#191513;letter-spacing:-0.3px;">Your programming is moving</h1>
    <p style="${p}">Hi ${esc(name)},</p>
    <p style="${p}">${intro}</p>

    <p style="${head}">Your plan</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;border:1px solid #e6e3e0;border-radius:10px;"><tr><td style="padding:16px 18px;">
      <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#191513;">${plan.title}</p>
      <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#191513;">${plan.line}</p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#3d3936;">${plan.what}</p>
    </td></tr></table>

    ${payBox ? `<p style="${head}">Your payments</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;background:#f4f3f1;border-radius:10px;" bgcolor="#f4f3f1"><tr><td bgcolor="#f4f3f1" style="padding:16px 18px;">
      <p style="margin:0 0 10px;font-size:17px;font-weight:700;color:#191513;">${payBox.head}</p>
      ${payBox.rows.map((r) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#191513;">${r}</p>`).join("")}
    </td></tr></table>` : ""}

    ${upLine ? `<p style="${p}margin-top:14px;">${upLine}</p>` : ""}
    <p style="margin:18px 0 4px;font-size:15px;line-height:1.6;color:#191513;"><b>This offer is open until ${DEADLINE}.</b></p>
    ${button(link, "See my offer")}

    <p style="${head}">How to move</p>
    ${steps.map((s, i) => `<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#3d3936;">${i + 1}. ${s}</p>`).join("")}
    ${button(GET_APP, "Get the app")}
    <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#3d3936;">It opens the App Store on an iPhone and Google Play on Android. Or go straight to
      <a href="${APP_STORE}" style="color:#191513;">App Store</a> · <a href="${PLAY_STORE}" style="color:#191513;">Google Play</a>.</p>

    <p style="${p}">Any questions, just reply to this email. Barney is copied in.</p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#191513;">Nathan and Barney<br>BirdBox Coaching</p>
  </td></tr>
  <tr><td style="padding:14px 26px;border-top:1px solid #e6e3e0;font-size:12px;color:#3d3936;">BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland</td></tr>
</table></td></tr></table></body></html>`;

  return { subject: "Your programming is moving to the BirdBox Coaching app", text, html };
}

function euro(cents) {
  return "€" + (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));
}

function day(d) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-IE", { day: "numeric", month: "long", timeZone: "UTC" });
}

function dayLong(d) {
  const t = new Date(d + "T12:00:00Z");
  return t.toLocaleDateString("en-IE", { weekday: "long", timeZone: "UTC" }) + " " + day(d);
}

function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return n + s;
}

const strip = (s) => String(s).replace(/<[^>]+>/g, "");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
