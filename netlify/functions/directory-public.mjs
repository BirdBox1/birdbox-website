// netlify/functions/directory-public.mjs
//
// GET                 -> { coaches: [...] }   everyone live in the directory
// GET ?slug=jane-doe  -> { coach: {...} }     one coach, for their own page
//
// Only what a visitor should see: no login emails, no notes, and only
// courses we can vouch for (a certificate, or verified by the office).
// See netlify/lib/directory.mjs for who counts as live.

import { db, json, PROFILE_FIELDS, qualificationsFor, statusOf, publicProfile, readAll } from "../lib/directory.mjs";

const CACHE = "public, max-age=60, s-maxage=300";
// Netlify's own CDN keeps the list for 5 minutes and serves the old copy
// while it fetches a new one, so visitors never wait for the database.
// "durable" shares one copy across all of Netlify's servers, so only the
// first visitor anywhere waits for it to be built.
const CDN_CACHE = "public, durable, s-maxage=300, stale-while-revalidate=86400";

export default async (req) => {
  if (req.method !== "GET") return json({ error: "Use GET" }, 405);
  const slug = (new URL(req.url).searchParams.get("slug") || "").trim().toLowerCase();

  try {
    // In pages: there are more than 1,000 coaches, and the database
    // returns at most 1,000 rows per request.
    const profiles = await readAll(() => {
      let query = db.from("directory_profiles").select(PROFILE_FIELDS)
        .eq("visible", true).is("hidden_at", null).order("id");
      if (slug) query = query.eq("slug", slug);
      return query;
    });
    const quals = await qualificationsFor(profiles);
    const live = profiles
      .filter((p) => statusOf(p, quals.get(p.id)) === "live")
      .map((p) => publicProfile(p, quals.get(p.id)));

    if (slug) {
      if (!live.length) return json({ error: "Not found" }, 404, "public, max-age=60");
      const res = json({ coach: live[0] }, 200, CACHE);
      res.headers.set("Netlify-CDN-Cache-Control", CDN_CACHE);
      return res;
    }
    // The list page does not show bios or links, so they are left out
    // here; a coach's own page asks for them with ?slug=.
    const slim = live.map(({ bio, instagram, website, facebook, twitter, linkedin, ...c }) => c);
    const res = json({ coaches: slim }, 200, CACHE);
    res.headers.set("Netlify-CDN-Cache-Control", CDN_CACHE);
    return res;
  } catch (err) {
    console.error("directory-public:", err.message || err);
    return json({ error: "The directory could not be loaded." }, 500);
  }
};
