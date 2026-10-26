// netlify/functions/directory-contact.mjs
//
// POST { slug, name, email, phone?, looking_for, message, company?, t }
//   -> { ok: true }
// GET  ?report=<request id>&sig=<signature>
//   -> the "not genuine? report it" link in the coach's email
//
// "Contact <coach>" on a coach's directory page. A coach's email and
// phone are never shown; the request is emailed to them with the
// visitor's details, and they choose whether to reply.
//
// The directory is a list of qualified coaches with their contact route,
// which is exactly what marketers and bots go looking for. So every
// request is screened, and anything doubtful is HELD for the office
// (portal -> Trainer directory -> Held messages) rather than sent. The
// sender is told it was sent either way, so there is nothing to learn
// from trying again.
//
// Turned away outright (sender is told what to fix):
//   - links or email addresses in the message: genuine enquiries do not
//     need them, almost every pitch has one
//   - more than 5 requests an hour from one network
//   - a second request to the same coach from the same person in a day
// Quietly dropped (bots):
//   - the hidden "company" field filled in
//   - the form sent less than 3 seconds after it was opened
// Held for the office:
//   - a sender a coach has reported, or the office has blocked
//   - one sender contacting a third coach within a day
//   - judged to be marketing or spam by a quick AI read of the message,
//     or, if that is unavailable, by a list of sales phrases

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  db, json, OFFICE, SITE_URL, PROFILE_FIELDS, qualificationsFor, statusOf, sendMail, esc,
} from "../lib/directory.mjs";

// Stricter than elsewhere: the address is used in a database filter, so
// quotes, commas and brackets are not allowed in it.
// A sender who reaches this many different coaches in a day is held, and so
// is everything of theirs still in the queue.
export const SPREAD_LIMIT = 3;
// How long a request waits before it is emailed to the coach.
const SEND_DELAY_MIN = 15;

const EMAIL_RE = /^[^@\s,"'()]+@[^@\s,"'()]+\.[^@\s,"'()]+$/;
const LOOKING_FOR = {
  personal: "Coaching for myself",
  online: "Online coaching",
  join: "Joining a gym",
  other: "Something else",
};
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|ai|app|info|biz|me|ly|gg|link|site|online|store|shop)\b|[^@\s]+@[^@\s]+\.[a-z]{2,})/i;
const SALES_RE = /\b(seo|search engine|backlinks?|guest post|web ?design|website (design|redesign|development)|marketing agency|digital marketing|lead gen|more leads|more clients|grow your (business|gym|following|instagram)|followers|social media (management|growth)|ad spend|facebook ads|google ads|book a (call|demo)|calendly|partnership opportunit|sponsor|affiliate program|white ?label|software|app for (coaches|gyms)|crypto|bitcoin|forex|investment opportunit|loan|whatsapp me|dm me|limited offer|free trial|ranking|rank on google)\b/i;

export default async (req) => {
  if (req.method === "GET") return report(req);
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const b = await req.json().catch(() => ({}));
  const fakeOk = () => json({ ok: true });

  // Bots: a filled honeypot, or a form completed faster than a person can type.
  if (b.company) return fakeOk();
  if (!(Number(b.t) >= 3000)) return fakeOk();

  const slug = String(b.slug || "").trim().toLowerCase();
  const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 254);
  const phone = String(b.phone || "").replace(/\s+/g, " ").trim().slice(0, 40) || null;
  const lookingFor = LOOKING_FOR[b.looking_for] ? b.looking_for : null;
  const message = String(b.message || "").replace(/\r/g, "").trim().slice(0, 1000);

  if (name.length < 2) return json({ error: "Add your name." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "Add an email the coach can reply to." }, 400);
  if (!lookingFor) return json({ error: "Choose what you are looking for." }, 400);
  if (message.length < 15) return json({ error: "Tell the coach a little about what you are looking for." }, 400);
  if (LINK_RE.test(message)) {
    return json({ error: "Please leave links and email addresses out of your message. The coach gets your email and can ask for anything else when they reply." }, 400);
  }

  try {
    const { data: p } = await db.from("directory_profiles").select(PROFILE_FIELDS)
      .eq("slug", slug).eq("visible", true).is("hidden_at", null).maybeSingle();
    if (!p) return json({ error: "That coach is not in the directory any more." }, 404);
    const quals = (await qualificationsFor([p])).get(p.id);
    if (statusOf(p, quals) !== "live") return json({ error: "That coach is not in the directory any more." }, 404);

    const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const ip_hash = ip ? createHash("sha256").update(ip + secret()).digest("hex").slice(0, 32) : null;
    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const dayAgo = new Date(Date.now() - 86400e3).toISOString();

    if (ip_hash) {
      const { count } = await db.from("directory_contact_requests").select("id", { count: "exact", head: true })
        .eq("ip_hash", ip_hash).gte("created_at", hourAgo);
      if ((count || 0) >= 5) return json({ error: "You have sent a few requests already. Try again in an hour." }, 429);
    }
    const { data: toThisCoach } = await db.from("directory_contact_requests").select("email")
      .eq("profile_id", p.id).gte("created_at", dayAgo);
    if ((toThisCoach || []).some((r) => r.email === email)) {
      return json({ error: "You have already sent this coach a request today. They will be in touch if they can help." }, 429);
    }
    if ((toThisCoach || []).length >= 20) {
      return json({ error: "This coach has had a lot of requests today. Please try again tomorrow." }, 429);
    }

    // ---- screening: anything doubtful is held, not sent ----
    let hold = null;

    const blockedQ = db.from("directory_blocked_senders").select("id").limit(1);
    const { data: blocked } = ip_hash
      ? await blockedQ.or(`email.eq.${JSON.stringify(email)},ip_hash.eq.${ip_hash}`)
      : await blockedQ.eq("email", email);
    if (blocked && blocked.length) hold = "Sender was reported or blocked before";

    if (!hold) {
      const others = await coachesContacted(email, ip_hash, dayAgo);
      others.add(p.id);
      if (others.size >= SPREAD_LIMIT) {
        hold = `Contacting several coaches (${others.size} today)`;
        // Anything from them still waiting to be sent is held too, so the
        // first messages of a blast never reach a coach.
        await holdQueued(email, ip_hash, hold);
      }
    }

    if (!hold) {
      const verdict = await screen({ name, lookingFor: LOOKING_FOR[lookingFor], message });
      if (verdict && verdict.verdict !== "genuine") hold = `Looks like ${verdict.verdict}: ${verdict.reason || ""}`.trim();
      if (!verdict && SALES_RE.test(message + " " + name)) hold = "Sales wording in the message";
    }

    // Nothing is emailed straight away. Requests that pass wait in a queue
    // for SEND_DELAY_MIN minutes; directory-contact-send emails them, after
    // checking again that the sender has not started messaging other
    // coaches in the meantime.
    const { error } = await db.from("directory_contact_requests").insert({
      profile_id: p.id, name, email, phone, message, ip_hash,
      looking_for: lookingFor, status: hold ? "held" : "queued", hold_reason: hold,
      send_after: hold ? null : new Date(Date.now() + SEND_DELAY_MIN * 60e3).toISOString(),
    });
    if (error) throw error;
    return fakeOk();
  } catch (err) {
    console.error("directory-contact:", err.message || err);
    return json({ error: "That did not send. Try again, or write to " + OFFICE + "." }, 500);
  }
};

// The coaches this sender (same email, or same network) has contacted
// since a given time.
export async function coachesContacted(email, ipHash, since) {
  const { data } = await db.from("directory_contact_requests").select("profile_id")
    .gte("created_at", since)
    .or(ipHash ? `email.eq.${JSON.stringify(email)},ip_hash.eq.${ipHash}` : `email.eq.${JSON.stringify(email)}`);
  return new Set((data || []).map((r) => r.profile_id));
}

export async function holdQueued(email, ipHash, reason) {
  let q = db.from("directory_contact_requests").update({ status: "held", hold_reason: reason, send_after: null })
    .eq("status", "queued");
  q = ipHash ? q.or(`email.eq.${JSON.stringify(email)},ip_hash.eq.${ipHash}`) : q.eq("email", email);
  await q;
}

// A quick read of the message by Claude: is this someone looking for a
// coach, or someone selling to one? Returns null if it cannot tell (no
// key, slow, or an odd answer), and the phrase list is used instead.
async function screen({ name, lookingFor, message }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(6000),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 120,
        system:
`You screen messages sent through the contact form of a directory of fitness coaches. Coaches should only receive genuine enquiries.

genuine: a person (or gym) who wants coaching, training, programming, a seminar, advice, or has a real question for the coach. It says something about their training, goals, sport, gym or situation. Short or badly written is still genuine.
marketing: anyone selling or pitching to the coach: SEO, websites, ads, leads, software, apps, social media growth, collaborations, sponsorships, affiliate or brand deals, recruiting, supplements, MLM.
spam: nonsense, scams, crypto, adult content, phishing, or obviously automated text. Includes scam openers that say nothing about training and only try to start a conversation, such as "I would like us to talk before making an appointment, please respond before I go further", "I have a proposal for you", "kindly get back to me", inheritance or funds offers. If the message could be sent unchanged to any business and never mentions fitness, training or coaching, it is spam.

Reply with JSON only: {"verdict":"genuine"|"marketing"|"spam","reason":"a few words"}`,
        messages: [{ role: "user", content: `Name: ${name}\nLooking for: ${lookingFor}\nMessage:\n${message}` }],
      }),
    });
    if (!res.ok) { console.warn("screen: API", res.status); return null; }
    const d = await res.json();
    const text = (d.content || []).map((c) => c.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    const v = m ? JSON.parse(m[0]) : null;
    return v && ["genuine", "marketing", "spam"].includes(v.verdict) ? v : null;
  } catch (e) {
    console.warn("screen failed:", e.message);
    return null;
  }
}

function secret() {
  return process.env.DIRECTORY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}
function sign(id) {
  return createHmac("sha256", secret()).update("report:" + id).digest("hex").slice(0, 32);
}

export async function emailCoach(p, requestId, { name, email, phone, lookingFor, message }) {
  const to = p.public_email || p.email;
  const first = String(p.full_name || "").split(" ")[0] || "there";
  const manage = `${SITE_URL}/learn/directory/`;
  const reportUrl = `${SITE_URL}/.netlify/functions/directory-contact?report=${requestId}&sig=${sign(requestId)}`;
  return sendMail({
    to,
    replyTo: email,
    subject: `New contact request from ${name} — BirdBox Trainer Directory`,
    text:
`Hi ${first},

${name} found you in the BirdBox Trainer Directory and would like to get in touch.

Name: ${name}
Email: ${email}${phone ? `\nPhone: ${phone}` : ""}
Looking for: ${lookingFor}

Their message:
${message}

Reply to this email to answer them directly. We have not shared your email or phone with them; they only see it if you reply.

Not a genuine enquiry? Report it and we will block the sender: ${reportUrl}

Manage your listing: ${manage}

BirdBox Coaching`,
    html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#16181b;max-width:560px">
<p>Hi ${esc(first)},</p>
<p><strong>${esc(name)}</strong> found you in the BirdBox Trainer Directory and would like to get in touch.</p>
<table style="border-collapse:collapse;font-size:15px;margin:0 0 16px">
<tr><td style="padding:2px 14px 2px 0;color:#6c7178">Name</td><td>${esc(name)}</td></tr>
<tr><td style="padding:2px 14px 2px 0;color:#6c7178">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
${phone ? `<tr><td style="padding:2px 14px 2px 0;color:#6c7178">Phone</td><td>${esc(phone)}</td></tr>` : ""}
<tr><td style="padding:2px 14px 2px 0;color:#6c7178">Looking for</td><td>${esc(lookingFor)}</td></tr>
</table>
<div style="background:#f4f3f0;border-left:4px solid #4FA8DE;padding:14px 16px;white-space:pre-line">${esc(message)}</div>
<p style="margin-top:18px"><strong>Reply to this email to answer them directly.</strong> We have not shared your email or phone with them; they only see it if you reply.</p>
<p style="color:#6c7178;font-size:14px">Not a genuine enquiry? <a href="${reportUrl}">Report it</a> and we will block the sender.<br>
You are getting this because you are listed in the BirdBox Trainer Directory. <a href="${manage}">Manage or hide your listing</a>.</p>
<p>BirdBox Coaching</p>
</div>`,
  });
}

// The coach's "report it" link: marks the request as spam and blocks the
// sender, so anything else from them is held for the office.
async function report(req) {
  const url = new URL(req.url);
  const id = String(url.searchParams.get("report") || "");
  const sig = String(url.searchParams.get("sig") || "");
  const page = (title, text) => new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#14100F;color:#F2EFEF;font-family:-apple-system,Helvetica,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
div{max-width:440px;border:1px solid #342F31;background:#1C1719;padding:28px}h1{font-size:20px;margin:0 0 10px}p{color:#C9C4C5;line-height:1.6;margin:0}a{color:#6FB9E8}</style></head>
<body><div><h1>${esc(title)}</h1><p>${text}</p></div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

  const expected = sign(id);
  if (!/^[0-9a-f-]{36}$/.test(id) || sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return page("That link did not work", `Forward the message to <a href="mailto:${OFFICE}">${OFFICE}</a> and we will deal with it.`);
  }
  const { data: r } = await db.from("directory_contact_requests").select("id, email, ip_hash, status").eq("id", id).maybeSingle();
  if (!r) return page("Already dealt with", "Thank you. There is nothing more to do.");
  if (r.status !== "spam") {
    await db.from("directory_contact_requests").update({ status: "spam", reviewed_at: new Date().toISOString() }).eq("id", id);
    await db.from("directory_blocked_senders").insert({ email: r.email, ip_hash: r.ip_hash, reason: "Reported by a coach" });
  }
  return page("Thanks, reported", "We have blocked that sender. Anything else they send through the directory comes to us, not you.");
}
