// netlify/functions/quiz-consent.mjs
//
// The second ask. Plenty of people scroll past the checkbox on the details
// screen — they are filling in a name and an email and pressing the button,
// not reading. So the result screen asks once more, this time naming the
// stage they just got, and only for people who did not already tick.
//
// The id is the row's uuid, handed back to that one browser by quiz-submit
// and held in memory for the length of the visit. Nothing is read back out,
// and the only change possible is turning consent on — so the worst a guessed
// id could do is opt somebody in who did not ask, which is why it has to be a
// uuid and not anything sequential.
//
// Consent is only ever set here, never cleared. Unsubscribing is Brevo's job
// and has to keep working independently of this.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const body = await req.json();
    const id = String(body.id || "").trim();
    if (!UUID.test(id)) return json({ error: "Unknown response" }, 400);

    const { error } = await supabase
      .from("quiz_responses")
      .update({
        marketing_consent: true,
        consent_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("marketing_consent", false);

    if (error) {
      console.error("quiz-consent update failed", error);
      return json({ error: "Could not save that. Please try again." }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("quiz-consent failed", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
