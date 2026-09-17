// netlify/functions/whatsapp-send.mjs
//
// Sends queued portal notifications to staff over WhatsApp.
//
// Everything in the portal writes a row into `notifications`. This reads the
// ones that have not gone out yet, sends each as the approved template, and
// stamps whatsapp_sent_at so it can never send twice. A failure writes the
// reason into whatsapp_error and leaves the row unsent, so it is visible
// rather than silently lost.
//
// Called on a schedule (pg_cron, every minute). Not triggered per-insert:
// saving coaches on a course writes several rows in one go, and a scheduled
// sweep batches those into one run instead of a burst of separate calls.
//
// Env (Netlify):
//   WHATSAPP_TOKEN             system user token, never expires
//   WHATSAPP_PHONE_ID          1389518474237492
//   WHATSAPP_TEMPLATE          optional, defaults to portal_notification
//   WHATSAPP_TEMPLATE_LANG     optional, defaults to en
//   WHATSAPP_CRON_SECRET       shared secret, must match the caller
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TEMPLATE = process.env.WHATSAPP_TEMPLATE || "portal_notification";
const LANG = process.env.WHATSAPP_TEMPLATE_LANG || "en";
const GRAPH = "https://graph.facebook.com/v21.0";

// Which kinds are worth interrupting somebody's phone for. Everything else
// still lands in the portal as a badge — a thirty-person seminar would
// otherwise fire thirty registration messages at every coach on it.
const SEND_KINDS = ["message", "allocation", "cancelled", "invoice_paid"];

// Netlify stops waiting at 26 seconds. Twenty messages at roughly a third of
// a second each leaves comfortable room; the rest go on the next run, a
// minute later.
const BATCH = 20;

// A notification that has sat unsent for more than a day is stale — a coach
// does not want to be told at midnight about a message from yesterday
// morning. It stays in the portal, it just stops queueing for WhatsApp.
const MAX_AGE_HOURS = 24;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async (request) => {
  // The caller proves itself with a shared secret. Without this anybody who
  // found the URL could flush the queue early.
  const secret = request.headers.get("x-cron-secret");
  if (!process.env.WHATSAPP_CRON_SECRET || secret !== process.env.WHATSAPP_CRON_SECRET) {
    return json({ error: "Not authorised" }, 401);
  }

  if (!TOKEN || !PHONE_ID) {
    return json({ error: "WHATSAPP_TOKEN or WHATSAPP_PHONE_ID is not set" }, 500);
  }

  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();

  // Only rows for staff who have actually opted in. whatsapp_enabled starts
  // false for everybody: Meta requires opt-in even for your own team, and a
  // coach who has not given a number cannot be messaged anyway.
  const { data: rows, error } = await db
    .from("notifications")
    .select("id, staff_id, kind, body, staff:staff_id ( full_name, whatsapp_number, whatsapp_enabled )")
    .is("whatsapp_sent_at", null)
    .is("whatsapp_error", null)
    .in("kind", SEND_KINDS)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) return json({ error: "Could not read notifications: " + error.message }, 500);

  const queued = rows || [];
  let sent = 0;
  let skipped = 0;
  const failures = [];

  for (const row of queued) {
    const staff = row.staff;

    // Not opted in, or no number on file. Marked rather than left pending,
    // so the same row is not reconsidered every minute for a day.
    if (!staff || !staff.whatsapp_enabled || !staff.whatsapp_number) {
      await db.from("notifications")
        .update({ whatsapp_error: "Not opted in or no number on file" })
        .eq("id", row.id);
      skipped++;
      continue;
    }

    const firstName = String(staff.full_name || "there").split(" ")[0];

    try {
      const res = await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: staff.whatsapp_number,
          type: "template",
          template: {
            name: TEMPLATE,
            language: { code: LANG },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: firstName },
                  { type: "text", text: row.body },
                ],
              },
            ],
          },
        }),
      });

      // Read as text first. A gateway error returns HTML, and res.json()
      // would throw on it — the same trap that made a working certificate
      // send look like a failure.
      const raw = await res.text();
      let out = null;
      try { out = JSON.parse(raw); } catch (e) { out = null; }

      if (!res.ok || !out || out.error) {
        const reason = out && out.error
          ? `${out.error.code}: ${out.error.message}`
          : `HTTP ${res.status}`;
        await db.from("notifications")
          .update({ whatsapp_error: reason.slice(0, 500) })
          .eq("id", row.id);
        failures.push({ id: row.id, reason });
        continue;
      }

      await db.from("notifications")
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq("id", row.id);
      sent++;
    } catch (err) {
      await db.from("notifications")
        .update({ whatsapp_error: String(err.message || err).slice(0, 500) })
        .eq("id", row.id);
      failures.push({ id: row.id, reason: String(err.message || err) });
    }

    // Paced rather than fired all at once. Well inside what WhatsApp allows,
    // and it keeps a run of twenty comfortably short.
    await sleep(300);
  }

  return json({
    ok: true,
    considered: queued.length,
    sent,
    skipped,
    failed: failures.length,
    failures,
    more: queued.length === BATCH,
  });
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
