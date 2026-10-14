// netlify/functions/online-offer-send.mjs
//
// "Send 50% link" on a participant's card in the portal.
//
// Someone who has been on a Level 1 seminar emails asking for the
// online course at half price. One click here and the office is done:
// they get a thank-you email with a button to their own page
// (/offer/?t=TOKEN), where they give their name and billing address
// (which sets the VAT), choose pay in full or monthly, and pay. The
// webhook enrols them and emails their login, exactly as for any
// other seminar offer (online-checkout.mjs).
//
// The link cannot be passed on usefully: it works once, and the
// course always goes to the email on THEIR registration, whoever
// fills the page in. No discount code exists to share.
//
// Admin only.
//
//   POST { registration_id }                   send it
//   POST { registration_id, mark_attended }    tick them attended first
//   POST { registration_id, resend }           send it again

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { BRAND_LOGO, senderFor, withOffer, sendEmail } from "./course-email-send.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const SITE = (process.env.SITE_URL || "https://birdboxcoaching.com").replace(/\/+$/, "");

// The same courses the follow-up email offers it for.
const OFFER_COURSES = new Set(["tcc:1", "tgc:1"]);
const DISCOUNT = 50;

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

    return await send(await request.json(), me);
  } catch (err) {
    console.error("online-offer-send failed:", err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

async function send(b, me) {
  const { data: reg, error } = await supabase
    .from("registrations")
    .select("id, first_name, last_name, email, status, attended, " +
            "courses!registrations_course_id_fkey(id, title, brand, level, type, city)")
    .eq("id", b.registration_id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!reg) return json({ error: "Registration not found." }, 404);

  const course = reg.courses || {};
  const brand = String(course.brand || "").toLowerCase();
  const level = String(course.level == null ? "" : course.level).replace(/\D/g, "");
  if (course.type !== "live_seminar" || !OFFER_COURSES.has(`${brand}:${level}`)) {
    return json({ error: "The 50% online course is only for Level 1 seminars (TCC and TGC)." }, 400);
  }
  if ((reg.status || "active") !== "active") return json({ error: "This registration is not active." }, 400);
  if (!reg.email || !reg.email.includes("@")) return json({ error: "There is no email on this registration. Edit it first." }, 400);

  // The offer page only opens for someone ticked as attended.
  if (reg.attended !== true) {
    if (!b.mark_attended) return json({ needs_attended: true });
    const { error: aErr } = await supabase.from("registrations").update({
      attended: true,
      attendance_marked_at: new Date().toISOString(),
      attendance_marked_by: me.id,
    }).eq("id", reg.id);
    if (aErr) return json({ error: "Could not mark them attended: " + aErr.message }, 500);
  }

  // Their one offer, made now if the follow-up never made it.
  let { data: offer } = await supabase
    .from("online_offers")
    .select("id, token, redeemed_at, emailed_at")
    .eq("registration_id", reg.id)
    .maybeSingle();

  if (offer && offer.redeemed_at) {
    return json({ error: `${reg.first_name} has already bought the online course with their 50% (${day(offer.redeemed_at)}).` }, 409);
  }
  if (offer && offer.emailed_at && !b.resend) {
    return json({ already_sent: offer.emailed_at });
  }
  if (!offer) {
    const { error: insErr } = await supabase.from("online_offers").upsert({
      token: randomBytes(18).toString("base64url"),
      registration_id: reg.id,
      course_id: course.id,
      brand,
      level,
      discount_percent: DISCOUNT,
    }, { onConflict: "registration_id", ignoreDuplicates: true });
    if (insErr) return json({ error: "Could not make their link: " + insErr.message }, 500);
    ({ data: offer } = await supabase
      .from("online_offers")
      .select("id, token, redeemed_at, emailed_at")
      .eq("registration_id", reg.id)
      .single());
  }

  const url = `${SITE}/offer/?t=${offer.token}`;
  const signOff = String(me.full_name || "").split(/\s+/)[0] || "BirdBox Coaching";
  const seminar = course.title || "the seminar";

  const text = [
    `Hi ${reg.first_name || "there"},`,
    `Thank you for asking about the online course, and for coming to ${seminar}. Because you have completed the seminar, you can have the online course at half price.`,
    "{{offer_button}}",
    "The button opens your own page. Add your billing address there, so you are charged the right VAT for where you live, then choose to pay in full or spread it over monthly payments. There is no account to set up first: as soon as you have paid, we email you a link straight into the course.",
    `The seminar rate is just for you: the link works once, and your course is sent to ${reg.email}.`,
    "Any questions, just reply to this email.",
    `${signOff}\nBirdBox Coaching`,
  ].join("\n\n");

  const result = await sendEmail({
    to: reg.email,
    sender: senderFor(me),
    subject: "Your 50% place on the online course",
    text: withOffer(text, url),
    brand: BRAND_LOGO[brand] || null,
    offerUrl: url,
    rich: true,
  });
  if (!result.ok) return json({ error: "The email did not send: " + result.error }, 502);

  await supabase.from("online_offers")
    .update({ emailed_at: new Date().toISOString(), emailed_by: me.id })
    .eq("id", offer.id);

  return json({ sent: true, to: reg.email });
}

function day(iso) {
  return new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
