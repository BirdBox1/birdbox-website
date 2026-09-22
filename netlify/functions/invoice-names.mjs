// netlify/functions/invoice-names.mjs
//
// The public side of a paid invoice. When an invoice for a block of
// places is paid, the payer is emailed a link to /invoice-names/?t=…
// and names the people they paid for. Each person is registered as
// paid and sent their confirmation as they are submitted — nobody at
// BirdBox has to do anything.
//
// No login. The long random token in the link is the only key, and it
// only ever unlocks that one invoice.
//
//   GET  ?t=token          what the form needs to draw itself
//   POST { t, people: [] } add those people

import { createClient } from "@supabase/supabase-js";
import { addPlace } from "./invoice-admin.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async (request) => {
  try {
    if (request.method === "GET") {
      const t = new URL(request.url).searchParams.get("t") || "";
      const inv = await byToken(t);
      if (!inv) return json({ error: "This link is not valid. Please reply to your invoice email and we will help." }, 404);
      return json(await summary(inv));
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const inv = await byToken(body.t || "");
      if (!inv) return json({ error: "This link is not valid." }, 404);
      if (inv.status !== "paid") return json({ error: "This invoice has not been paid yet." }, 400);

      const people = Array.isArray(body.people) ? body.people.slice(0, 50) : [];
      if (!people.length) return json({ error: "Add at least one person." }, 400);

      // Everything is checked before anything is saved, so a typo in
      // the third person does not leave the first two half-done.
      for (const p of people) {
        const first = String(p.first_name || "").trim();
        const last = String(p.last_name || "").trim();
        const email = String(p.email || "").trim();
        const phone = String(p.phone || "").trim();
        if (!first || !last) return json({ error: "Every person needs a first and last name." }, 400);
        if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
          return json({ error: `The email for ${first} ${last} does not look right.` }, 400);
        }
        if (phone.replace(/\D/g, "").length < 6) {
          return json({ error: `A phone number is needed for ${first} ${last}.` }, 400);
        }
      }
      const langs = await onlineLanguages(inv.courses || {});
      if (langs.length) {
        for (const p of people) {
          if (!langs.some((l) => l.language === p.language)) {
            return json({ error: `Choose the online course language for ${String(p.first_name).trim()} ${String(p.last_name).trim()}.` }, 400);
          }
        }
      }

      const results = [];
      for (const p of people) {
        const r = await addPlace({
          invoiceId: inv.id,
          first: p.first_name, last: p.last_name, email: p.email, phone: p.phone,
          language: p.language,
        });
        results.push({
          name: `${String(p.first_name).trim()} ${String(p.last_name).trim()}`,
          ok: !r.error,
          error: r.error || null,
        });
        if (r.error && /already filled/.test(r.error)) break;
      }

      return json({ results, ...(await summary(inv)) });
    }

    return json({ error: "Use GET or POST" }, 405);
  } catch (err) {
    console.error("invoice-names failed:", err);
    return json({ error: "Something went wrong. Please try again, or reply to your invoice email." }, 500);
  }
};

async function byToken(t) {
  if (!TOKEN.test(String(t))) return null;
  const { data } = await supabase
    .from("invoices")
    .select("id, status, places, payer_name, business_name, stripe_invoice_number, course_id, courses ( title, brand, level, city, starts_at, timezone, grants_online_course )")
    .eq("names_token", t)
    .maybeSingle();
  return data || null;
}

async function summary(inv) {
  const { data: regs } = await supabase
    .from("registrations")
    .select("first_name, last_name")
    .eq("invoice_id", inv.id)
    .order("created_at", { ascending: true });

  const c = inv.courses || {};
  let when = "";
  try {
    when = new Date(c.starts_at).toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: c.timezone || "UTC",
    });
  } catch (_) {}

  return {
    languages: await onlineLanguages(c),
    paid: inv.status === "paid",
    payer: inv.business_name || inv.payer_name,
    invoice: inv.stripe_invoice_number || null,
    course: c.title || "",
    brand: String(c.brand || "").toLowerCase(),
    when,
    places: inv.places,
    named: (regs || []).map((r) => `${r.first_name} ${r.last_name}`),
  };
}

// The online course languages this course's people can choose from —
// the same list the website checkout offers. Empty when the course
// does not include an online course, and then no question is asked.
async function onlineLanguages(course) {
  if (!course || !course.grants_online_course) return [];
  const digits = String(course.level == null ? "" : course.level).replace(/\D/g, "");
  const { data } = await supabase
    .from("learnworlds_products")
    .select("language, label, level")
    .eq("brand", course.brand)
    .eq("active", true);
  return (data || [])
    .filter((r) => String(r.level || "").replace(/\D/g, "") === digits)
    .map((r) => ({ language: r.language, label: r.label || r.language }));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
