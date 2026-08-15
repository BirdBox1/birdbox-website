// netlify/functions/geocode.mjs
//
// Turns an address into coordinates for the seminar planner.
//
//   GET /.netlify/functions/geocode?q=Calle+Mayor+1,+Madrid
//
// This sits between the browser and OpenStreetMap because their terms
// ask for an identifiable caller, and a browser cannot set a
// User-Agent. Calling it from the page directly gets refused.

const CONTACT = process.env.GEOCODE_CONTACT || "info@birdboxcoaching.com";

export default async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (q.length < 4) {
    return json({ error: "Type a longer address." }, 400);
  }

  try {
    const target =
      "https://nominatim.openstreetmap.org/search" +
      "?format=jsonv2&limit=3&addressdetails=1&q=" + encodeURIComponent(q);

    const res = await fetch(target, {
      headers: {
        "User-Agent": `BirdBoxCoaching/1.0 (${CONTACT})`,
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      return json({ error: "The lookup service refused the request." }, 502);
    }

    const hits = await res.json();
    if (!Array.isArray(hits) || !hits.length) {
      return json({ results: [] });
    }

    // Only what the form needs, so nothing else has to be trusted.
    const results = hits.map((h) => {
      const a = h.address || {};
      return {
        label: h.display_name || "",
        latitude: Number(h.lat),
        longitude: Number(h.lon),
        city: a.city || a.town || a.village || a.municipality ||
              a.county || "",
        country: (a.country_code || "").toUpperCase(),
        country_name: a.country || "",
      };
    });

    return json({ results });
  } catch (err) {
    console.error("geocode failed:", err);
    return json({ error: "Could not reach the lookup service." }, 502);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
