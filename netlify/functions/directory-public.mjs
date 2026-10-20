// netlify/functions/directory-public.mjs
//
// GET                 -> { coaches: [...] }   everyone live in the directory
// GET ?slug=jane-doe  -> { coach: {...} }     one coach, for their own page
//
// Only what a visitor should see: no login emails, no notes, and only
// courses we can vouch for (a certificate, or verified by the office).
// See netlify/lib/directory.mjs for who counts as live.

import { db, json, PROFILE_FIELDS, qualificationsFor, statusOf, publicProfile } from "../lib/directory.mjs";

const CACHE = "public, max-age=60, s-maxage=300";

export default async (req) => {
  if (req.method !== "GET") return json({ error: "Use GET" }, 405);
  const slug = (new URL(req.url).searchParams.get("slug") || "").trim().toLowerCase();

  try {
    let query = db.from("directory_profiles").select(PROFILE_FIELDS)
      .eq("visible", true).is("hidden_at", null);
    if (slug) query = query.eq("slug", slug);
    const { data, error } = await query.limit(5000);
    if (error) throw error;

    const profiles = data || [];
    const quals = await qualificationsFor(profiles);
    const live = profiles
      .filter((p) => statusOf(p, quals.get(p.id)) === "live")
      .map((p) => publicProfile(p, quals.get(p.id)));

    if (slug) {
      if (!live.length) return json({ error: "Not found" }, 404, "public, max-age=60");
      return json({ coach: live[0] }, 200, CACHE);
    }
    live.sort((a, b) => a.name.localeCompare(b.name));
    return json({ coaches: live }, 200, CACHE);
  } catch (err) {
    console.error("directory-public:", err.message || err);
    return json({ error: "The directory could not be loaded." }, 500);
  }
};
