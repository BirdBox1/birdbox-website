// netlify/functions/quiz-consent.mjs
//
// The second ask. Plenty of people scroll past the checkbox on the details
// screen — they are filling in a name and an email and pressing the button,
// not reading. So the result screen asks once more, this time naming the
// stage they just got, and only for people who did not already tick.
//
// It has to do two things, not one. Recording consent is not enough: the
// chain enrolment happens in quiz-submit at the moment of submission, and by
// then this person had said no. Without the enrolment below they would be
// marked as consented and receive nothing at all, which is worse than never
// having been asked.
//
// The id is the row's uuid, handed back to that one browser by quiz-submit
// and held in memory for the length of the visit. The only change possible is
// turning consent on and enrolling that same row's email, so the worst a
// guessed id could do is opt somebody in who did not ask — which is why it
// has to be a uuid and not anything sequential.
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
const CHAINS = ["explorer", "builder", "refiner", "leader"];

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const body = await req.json();
    const id = String(body.id || "").trim();
    if (!UUID.test(id)) return json({ error: "Unknown response" }, 400);

    // Set consent and read back what the enrolment needs, in one round trip.
    const { data: rows, error } = await supabase
      .from("quiz_responses")
      .update({
        marketing_consent: true,
        consent_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("email, first_name, archetype");

    if (error) {
      console.error("quiz-consent update failed", error);
      return json({ error: "Could not save that. Please try again." }, 500);
    }
    if (!rows || !rows.length) return json({ error: "Unknown response" }, 400);

    const row = rows[0];

    // Same rule as quiz-submit: one archetype chain per person, and the first
    // one wins. Somebody clicking this twice, or clicking it after having
    // ticked the box on a previous attempt, changes nothing.
    try {
      const { data: already } = await supabase
        .from("drip_enrollments")
        .select("id")
        .eq("email", row.email)
        .in("chain", CHAINS)
        .limit(1);

      if (!already || !already.length) {
        const start = new Date();
        start.setDate(start.getDate() + 7);

        const { error: enrErr } = await supabase.from("drip_enrollments").insert({
          email: row.email,
          first_name: row.first_name,
          chain: row.archetype,
          start_date: start.toISOString().slice(0, 10),
          status: "active",
          source: "quiz",
        });
        if (enrErr) console.error("drip_enrollments insert failed", enrErr);
      }
    } catch (e) {
      // Consent is already recorded at this point. A failed enrolment is
      // worth logging loudly but must not report failure to the person.
      console.error("Chain enrolment failed for", row.email, e);
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
