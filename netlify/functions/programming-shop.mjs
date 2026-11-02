// netlify/functions/programming-shop.mjs
//
// What is on sale, for the public programming sales pages (Nathan, 2 Nov
// 2026): the blog plans, one-to-one and the blocks put Live, with prices
// in the visitor's currency, the same as BirdBox Learn shows and the app's
// checkout charges. No login; nothing about any person.
//
//   GET ?country=GB   -> { currency, country, courses }
//
// The country is the one the visitor chose ("Change country"); without
// it, where they are browsing from.

import { json } from "../lib/directory.mjs";
import { shopFor } from "../lib/programming-shop.mjs";

export default async (req, context) => {
  if (req.method !== "GET") return json({ error: "Use GET" }, 405);
  try {
    const chosen = String(new URL(req.url).searchParams.get("country") || "").toUpperCase();
    const { currency, country, courses } = await shopFor(context, null, chosen);
    return json({ currency, country, courses }, 200, "public, max-age=300");
  } catch (e) {
    console.error("programming-shop:", e.message);
    return json({ error: "Prices could not load." }, 500);
  }
};
