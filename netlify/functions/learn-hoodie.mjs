// netlify/functions/learn-hoodie.mjs
//
// The free hoodie card in BirdBox Learn (Nathan, 20 Nov 2026). Signed in
// with the Learn login (Authorization: Bearer <token>).
//
// GET                -> { bookings, hoodies }   hoodies only when one is still to claim
// GET ?catalogue=1   -> { hoodies }   no login: the shop's hoodies, to check the Printful link
// POST { registration_id, variant_id, recipient }  -> { ok, claim }
//
// One hoodie per live seminar booked 27 Nov - 30 Dec 2026 (see
// lib/hoodie.mjs for who counts). The order is confirmed with Printful at
// once and paid from the Printful wallet; the learner and info@ get an email.

import { db, json, userFrom, sendMail, esc, OFFICE } from "../lib/directory.mjs";
import { hoodieBookings, hoodieCatalogue, hoodieVariant, placeHoodieOrder } from "../lib/hoodie.mjs";

const clean = (v, max = 100) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
// Printful needs a state for these countries
const NEEDS_STATE = new Set(["US", "CA", "AU", "JP"]);

export default async (req) => {
  // the hoodies on offer, as in the public shop (no login needed; used to check the Printful link)
  if (req.method === "GET" && new URL(req.url).searchParams.get("catalogue") === "1") {
    try { return json({ hoodies: await hoodieCatalogue() }); }
    catch (e) { return json({ error: e.message }, 502); }
  }
  const user = await userFrom(req);
  if (!user) return json({ error: "Please log in again." }, 401);
  const email = String(user.email || "").trim().toLowerCase();

  try {
    if (req.method === "GET") {
      const bookings = await hoodieBookings(email);
      const open = bookings.some((b) => !b.claim);
      let hoodies = [], shopError = null;
      if (open) {
        try { hoodies = await hoodieCatalogue(); }
        catch (e) { console.error("Hoodie catalogue", e.message); shopError = "The hoodies could not be loaded just now. Please try again in a few minutes."; }
      }
      return json({ bookings, hoodies, shop_error: shopError });
    }

    if (req.method !== "POST") return json({ error: "Not allowed" }, 405);
    const body = await req.json().catch(() => ({}));

    const booking = (await hoodieBookings(email)).find((b) => b.registration_id === body.registration_id);
    if (!booking) return json({ error: "We could not find a seminar booking with a free hoodie on this login." }, 404);
    if (booking.claim) return json({ error: "The hoodie for this booking has already been claimed." }, 409);

    const variant = await hoodieVariant(body.variant_id);
    if (!variant) return json({ error: "Please choose a hoodie, colour and size." }, 400);

    const r = body.recipient || {};
    const recipient = {
      name: clean(r.name, 80),
      address1: clean(r.address1),
      address2: clean(r.address2) || undefined,
      city: clean(r.city, 60),
      state_code: clean(r.state_code, 10).toUpperCase() || undefined,
      zip: clean(r.zip, 20),
      country_code: clean(r.country_code, 2).toUpperCase(),
      phone: clean(r.phone, 30) || undefined,
      email,
    };
    if (!recipient.name || !recipient.address1 || !recipient.city || !recipient.zip || !/^[A-Z]{2}$/.test(recipient.country_code)) {
      return json({ error: "Please fill in your name, address, town or city, postcode and country." }, 400);
    }
    if (NEEDS_STATE.has(recipient.country_code) && !recipient.state_code) {
      return json({ error: "Please add your state or province code (for example CA or NSW)." }, 400);
    }

    // Hold the booking first, so a double tap can never order two.
    const { data: claim, error: holdErr } = await db.from("hoodie_claims").insert({
      registration_id: booking.registration_id, email, sync_variant_id: variant.id,
      product_name: variant.product, colour: variant.colour, size: variant.size, recipient,
    }).select("id").single();
    if (holdErr) {
      if (holdErr.code === "23505") return json({ error: "The hoodie for this booking has already been claimed." }, 409);
      throw holdErr;
    }

    let order;
    try {
      order = await placeHoodieOrder({ claimId: claim.id, variantId: variant.id, recipient });
    } catch (e) {
      // Let them fix the address and try again.
      await db.from("hoodie_claims").delete().eq("id", claim.id);
      console.error("Printful order failed", email, e.message);
      return json({ error: "Printful could not take the order: " + e.message + " Please check your address and try again, or write to info@birdboxcoaching.com." }, 400);
    }

    await db.from("hoodie_claims").update({
      status: "ordered", printful_order_id: order?.id || null, ordered_at: new Date().toISOString(),
      printful_cost: order?.costs ? `${order.costs.total} ${order.costs.currency || ""}`.trim() : null,
    }).eq("id", claim.id);

    const what = `${variant.product} · ${variant.colour} · ${variant.size}`;
    const addr = [recipient.name, recipient.address1, recipient.address2, recipient.city, recipient.state_code, recipient.zip, recipient.country_code].filter(Boolean);
    const first = (booking.name || recipient.name).split(" ")[0];

    await sendMail({
      to: email,
      subject: "Your free BirdBox hoodie is on its way",
      text: `Hi ${first},\n\nThank you for booking ${booking.course}. Your free hoodie is ordered:\n\n${what}\n\nIt will be sent to:\n${addr.join("\n")}\n\nIt is printed to order, so please allow 2 to 3 weeks for it to arrive. You will get a tracking email once it ships.\n\nAny questions, just reply to this email.\n\nBirdBox Coaching`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a;max-width:560px">
<p>Hi ${esc(first)},</p><p>Thank you for booking ${esc(booking.course)}. Your free hoodie is ordered:</p>
<p style="border-left:3px solid #4FA8DE;padding-left:14px"><strong>${esc(what)}</strong></p>
<p>It will be sent to:<br>${addr.map(esc).join("<br>")}</p>
<p>It is printed to order, so please allow 2 to 3 weeks for it to arrive. You will get a tracking email once it ships.</p>
<p>Any questions, just reply to this email.</p><p>BirdBox Coaching</p></div>`,
    });
    await sendMail({
      to: OFFICE,
      subject: `Free hoodie claimed: ${booking.name || email}`,
      text: `${booking.name || ""} <${email}> claimed their free hoodie for ${booking.course}.\n\n${what}\nPrintful order ${order?.id || "?"}${order?.costs ? ` (cost ${order.costs.total} ${order.costs.currency || ""})` : ""}\n\nShip to:\n${addr.join("\n")}`,
    });

    return json({ ok: true, claim: { product_name: variant.product, colour: variant.colour, size: variant.size, status: "ordered" } });
  } catch (err) {
    console.error("learn-hoodie", err);
    return json({ error: "Something went wrong. Please try again, or write to info@birdboxcoaching.com." }, 500);
  }
};
