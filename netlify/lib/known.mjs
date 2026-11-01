// netlify/lib/known.mjs
//
// Is this someone BirdBox knows (Nathan, 1 Nov 2026)? Someone who has
// bought from BirdBox, been given programming, works for BirdBox, or has
// a Trainer Directory listing the office made or approved. Used by the
// login link (learn-access) and by BirdBox Learn (learn-account): anyone
// else can still log in, but only to claim a Trainer Directory listing,
// which stays hidden until the office has checked their course.

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Has this email bought from BirdBox, been given programming, or a staff
// or office-made listing? Any one is enough.
export async function knownToBirdBox(email) {
  const like = email.replace(/[%_\\]/g, "\\$&");
  const has = async (q) => { const { count } = await q; return (count || 0) > 0; };
  const head = { count: "exact", head: true };
  const checks = [
    () => has(db.from("staff").select("id", head).ilike("email", like)),
    () => has(db.from("registrations").select("id", head).ilike("email", like)),
    () => has(db.from("learn_enrolments").select("course_id", head).ilike("email", like)),
    // a listing the office made, or one of their own the office approved
    () => has(db.from("directory_profiles").select("id", head).ilike("email", like).neq("source", "self")),
    () => has(db.from("directory_profiles").select("id", head).ilike("email", like).not("approved_at", "is", null)),
    async () => {
      const train = db.schema("train");
      const { data: a } = await train.from("athletes").select("id").ilike("email", like).limit(5);
      const ids = (a || []).map((x) => x.id);
      if (!ids.length) return false;
      return (await has(train.from("enrolments").select("id", head).in("athlete_id", ids)))
          || (await has(train.from("purchases").select("id", head).in("athlete_id", ids)));
    },
    // anything paid on BirdBox's Stripe account: T-shirts, gift cards too
    async () => {
      if (!process.env.STRIPE_SECRET_KEY) return false;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const found = await stripe.customers.search({ query: `email:'${email.replace(/'/g, "\\'")}'`, limit: 10 });
      for (const c of found.data || []) {
        const ch = await stripe.charges.list({ customer: c.id, limit: 10 });
        if ((ch.data || []).some((x) => x.paid && x.status === "succeeded")) return true;
      }
      return false;
    },
  ];
  for (const check of checks) {
    try { if (await check()) return true; } catch (e) { console.error("learn-access check:", e.message); }
  }
  return false;
}

