// netlify/functions/staff-invite.mjs
//
// Adding somebody to the team, and taking them off it again.
//
// Creating a login needs the service role key, so it cannot happen in
// the browser. Doing it here also keeps the two records in step: the
// auth user and the staff row are created together, sharing an id. If
// they ever drift apart the person can sign in but the portal will not
// recognise them, which is a confusing thing to debug months later.
//
// Nobody is ever emailed a password. They get a one-time link and
// choose their own.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const OFFICE = "info@birdboxcoaching.com";
const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const SITE_URL = (process.env.SITE_URL || "https://warm-beijinho-9a5b1c.netlify.app")
  .replace(/\/+$/, "");

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth || !auth.user) return json({ error: "Not signed in" }, 401);

    const { data: me } = await supabase
      .from("staff")
      .select("id, full_name, role, active")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (!me || !me.active) return json({ error: "Not a member of staff" }, 403);
    if (me.role !== "admin") return json({ error: "Only an admin can do this" }, 403);

    const body = await request.json();

    switch (body.action) {
      case "invite":     return await invite(body, me);
      case "reinvite":   return await reinvite(body, me);
      case "deactivate": return await setActive(body, false, me);
      case "reactivate": return await setActive(body, true, me);
      case "delete":     return await remove(body, me);
      case "set_photo":  return await setPhoto(body, me);
      default:
        return json({ error: `Unknown action "${body.action}".` }, 400);
    }
  } catch (err) {
    console.error("staff-invite failed:", err);
    return json({ error: err.message || "That did not work." }, 500);
  }
};

// ---------------------------------------------------------------

async function invite({ email, fullName, role }, me) {
  const address = String(email || "").trim().toLowerCase();
  const name = String(fullName || "").trim();

  if (!address || !address.includes("@")) return json({ error: "A valid email is needed." }, 400);
  if (!name) return json({ error: "A name is needed." }, 400);
  // The four values staff_role actually accepts. Checked here rather
  // than trusted from the browser, and named explicitly so a wrong one
  // is refused with a readable message instead of a Postgres enum error.
  // Whether somebody leads or assists belongs to a course, not to the
  // person — the same coach does both. That lives in course_staff.
  const ROLES = ["admin", "coach", "support"];
  if (!ROLES.includes(role)) {
    return json({ error: `Choose a role. It must be one of: ${ROLES.join(", ")}.` }, 400);
  }

  // Somebody already on the team, perhaps deactivated rather than
  // removed. Reviving them keeps their history on past courses.
  const { data: existing } = await supabase
    .from("staff")
    .select("id, full_name, active")
    .ilike("email", address)
    .maybeSingle();

  if (existing) {
    return json({
      error: existing.active
        ? `${existing.full_name} is already on the team with that email.`
        : `${existing.full_name} is on the team but deactivated. Reactivate them instead of inviting again.`,
    }, 400);
  }

  // Created without a password. The invite link is how they get in.
  const { data: created, error: cErr } = await supabase.auth.admin.createUser({
    email: address,
    email_confirm: true,
    user_metadata: { full_name: name },
  });

  if (cErr) {
    return json({
      error: /already been registered/i.test(cErr.message)
        ? "There is already a login with that email, but no staff record. An admin needs to sort that out in Supabase."
        : "Could not create the login: " + cErr.message,
    }, 400);
  }

  const userId = created.user.id;

  const { error: sErr } = await supabase.from("staff").insert({
    id: userId,
    full_name: name,
    email: address,
    role,
    active: true,
  });

  // Without this the login would exist with nothing behind it, and the
  // person would be told they are not a member of staff.
  if (sErr) {
    await supabase.auth.admin.deleteUser(userId);
    return json({ error: "Could not create the staff record: " + sErr.message }, 500);
  }

  const link = await inviteLink(address);
  if (!link) {
    return json({
      warning: `${name} has been added, but the invite email could not be generated. ` +
               "Use Send the invite again from the portal.",
      staffId: userId,
    });
  }

  const sent = await sendInvite({ to: address, name, link, from: me.full_name, fresh: true });

  return json({
    staffId: userId,
    emailed: sent,
    warning: sent ? null : "Added, but the invite email did not send. Try Send the invite again.",
  });
}

async function reinvite({ staffId }, me) {
  const { data: person } = await supabase
    .from("staff").select("id, full_name, email, active").eq("id", staffId).maybeSingle();

  if (!person) return json({ error: "That person is not on the team." }, 404);
  if (!person.active) return json({ error: "They are deactivated. Reactivate them first." }, 400);

  const link = await inviteLink(person.email);
  if (!link) return json({ error: "Could not generate an invite link." }, 500);

  const sent = await sendInvite({
    to: person.email, name: person.full_name, link, from: me.full_name, fresh: false,
  });

  if (!sent) return json({ error: "The email was rejected." }, 502);
  return json({ emailed: true });
}

// Deactivating leaves everything intact — past courses, notes and
// invoices all still name them. It only stops them signing in.
async function setActive({ staffId }, active, me) {
  if (staffId === me.id && !active) {
    return json({ error: "You cannot deactivate yourself." }, 400);
  }

  const { data: person } = await supabase
    .from("staff").select("id, full_name, active").eq("id", staffId).maybeSingle();

  if (!person) return json({ error: "That person is not on the team." }, 404);

  if (!active) {
    // Anything still ahead of them needs reassigning, so say so rather
    // than leaving a course quietly without a coach.
    const { data: upcoming } = await supabase
      .from("course_staff")
      .select("role, courses ( title, starts_at, archived, status )")
      .eq("staff_id", staffId);

    const live = (upcoming || [])
      .filter((r) => r.courses && !r.courses.archived &&
                     r.courses.status !== "cancelled" &&
                     new Date(r.courses.starts_at) > new Date())
      .map((r) => r.courses.title);

    const { error } = await supabase
      .from("staff").update({ active: false }).eq("id", staffId);
    if (error) return json({ error: error.message }, 500);

    return json({
      done: true,
      name: person.full_name,
      stillOn: live,
    });
  }

  const { error } = await supabase
    .from("staff").update({ active: true }).eq("id", staffId);
  if (error) return json({ error: error.message }, 500);

  return json({ done: true, name: person.full_name });
}

// Fully remove somebody — their staff record and their login — so the
// email is free to invite again, and a fired coach is properly gone.
//
// Most references clear themselves on delete (SET NULL / CASCADE). A few
// are NO ACTION and would block, so they are cleared first. The one thing
// we will NOT quietly erase is money: a coach with invoice records is kept
// (deactivate them instead), because that is financial history.
async function remove({ staffId }, me) {
  if (staffId === me.id) return json({ error: "You cannot delete yourself." }, 400);

  const { data: person } = await supabase
    .from("staff").select("id, full_name, email").eq("id", staffId).maybeSingle();
  if (!person) return json({ error: "That person is not on the team." }, 404);

  // Financial history is never silently deleted.
  const { data: inv } = await supabase
    .from("coach_invoices").select("id").eq("staff_id", staffId).limit(1);
  if (inv && inv.length) {
    return json({
      error: `${person.full_name} has invoice records, so they can't be deleted — that would erase financial history. Deactivate them instead.`,
    }, 400);
  }

  // Note any upcoming courses they were on, so the admin can reassign.
  const { data: upcoming } = await supabase
    .from("course_staff")
    .select("courses ( title, starts_at, archived, status )")
    .eq("staff_id", staffId);
  const stillOn = (upcoming || [])
    .filter((r) => r.courses && !r.courses.archived &&
                   r.courses.status !== "cancelled" &&
                   new Date(r.courses.starts_at) > new Date())
    .map((r) => r.courses.title);

  // Clear the NO ACTION references the database will not clear itself.
  await supabase.from("direct_messages").delete()
    .or(`sender_id.eq.${staffId},recipient_id.eq.${staffId}`);
  await supabase.from("course_messages").delete().eq("staff_id", staffId);
  await supabase.from("registrations").update({ added_by: null }).eq("added_by", staffId);
  await supabase.from("workshop_requests").update({ requested_by: null }).eq("requested_by", staffId);
  await supabase.from("workshop_requests").update({ reviewed_by: null }).eq("reviewed_by", staffId);
  await supabase.from("workshop_templates").update({ approved_by: null }).eq("approved_by", staffId);
  await supabase.from("workshop_templates").update({ created_by: null }).eq("created_by", staffId);

  // Remove the staff row — CASCADE clears course_staff, reflections,
  // staff_documents; SET NULL clears blog author, notes, certificates, etc.
  const { error: sErr } = await supabase.from("staff").delete().eq("id", staffId);
  if (sErr) {
    return json({ error: "Could not remove them: " + sErr.message }, 500);
  }

  // Clear the login so the email is free to invite again.
  let authWarning = null;
  try {
    await supabase.auth.admin.deleteUser(staffId);
  } catch (err) {
    console.error("Staff row deleted but auth user remained:", err.message);
    authWarning = "Their old login could not be cleared automatically — if re-inviting that email fails, delete the user under Supabase Authentication.";
  }

  return json({ deleted: true, name: person.full_name, stillOn, authWarning });
}

// Admin sets (or replaces) another staff member's profile photo. Done here
// because only the service role can write another person's staff row and
// upload to their slot in the staff-photos bucket. The photo is keyed by the
// person's id (<id>.jpg), exactly like a self-uploaded one, so the rest of
// the portal shows it with no further change.
async function setPhoto({ staffId, image }, me) {
  if (!staffId) return json({ error: "No staff member given." }, 400);
  if (!image || typeof image !== "string") return json({ error: "No image given." }, 400);

  const { data: person } = await supabase
    .from("staff").select("id, full_name").eq("id", staffId).maybeSingle();
  if (!person) return json({ error: "That person is not on the team." }, 404);

  // Accept a data URL (data:image/jpeg;base64,...) or a bare base64 string.
  const b64 = image.includes(",") ? image.slice(image.indexOf(",") + 1) : image;
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length) return json({ error: "That image could not be read." }, 400);
  if (bytes.length > 5_000_000) return json({ error: "That image is too large." }, 400);

  const path = `${staffId}.jpg`;
  const { error: upErr } = await supabase.storage
    .from("staff-photos")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (upErr) return json({ error: "Could not save the photo: " + upErr.message }, 500);

  const { error: dbErr } = await supabase
    .from("staff").update({ photo_path: path }).eq("id", staffId);
  if (dbErr) return json({ error: "Photo saved but not linked: " + dbErr.message }, 500);

  return json({ done: true, name: person.full_name, photo_path: path });
}

// ---------------------------------------------------------------

// Generated rather than sent by Supabase, so the email comes from the
// BirdBox domain and reads like the rest of what the team receives.
async function inviteLink(email) {
  try {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${SITE_URL}/portal/set-password/` },
    });
    if (error) { console.error("Could not generate link:", error.message); return null; }
    return data.properties.action_link;
  } catch (err) {
    console.error("Could not generate link:", err.message);
    return null;
  }
}

async function sendInvite({ to, name, link, from, fresh }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("No Resend key; invite not sent to", to); return false; }

  const first = (name || "there").split(" ")[0];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `BirdBox Coaching <${FROM}>`,
        to: [to],
        reply_to: OFFICE,
        subject: fresh ? "Your BirdBox coach portal login" : "Your BirdBox portal link",
        text:
`Hi ${first},

${fresh
  ? `${from} has set you up on the BirdBox coach portal. It is where you will find the courses you are coaching, the participants on them, and everything you need before and after a seminar.`
  : `Here is a fresh link to set your password for the BirdBox coach portal.`}

Set your password here:
${link}

That link works once, and expires in 24 hours. If it has run out by the time you get to it, reply and we will send another.

Once you are in you can add a photo and your phone number under My profile.

BirdBox Coaching
${SITE_URL}/portal/`,
      }),
    });
    if (!res.ok) {
      console.error("Resend rejected the invite to", to, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Could not send the invite to", to, err.message);
    return false;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
