// netlify/edge-functions/coach-card.js
//
// GET /share/coach/<slug>.png -> a 1200 x 630 link-preview picture for
// one coach's page in the Trainer Directory: their photo in a BirdBox
// Trainer Directory card (BirdBox blue, square corners, name in
// capitals, their verified courses as plain tags).
//
// share-meta.js points a coach page's og:image here, so whoever shares
// their page on WhatsApp, iMessage or Facebook gets their own card. It
// is drawn on request from the live listing and then cached, so a new
// or changed listing needs nothing done by hand; the ?p= on the address
// changes with the photo, so a new photo gets a new picture.
//
// No photo, or a photo format the drawing library cannot read, falls
// back to the general Trainer Directory picture.

import { ImageResponse } from "https://deno.land/x/og_edge@0.0.6/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const FALLBACK = "/share/coach.jpg";
const BLUE = "#4FA8DE", BLUE_TEXT = "#6FB9E8";

export default async (request) => {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/share\/coach\/([a-z0-9-]+)\.png$/);
  if (!m) return Response.redirect(new URL(FALLBACK, url), 302);
  const slug = m[1];

  try {
    const r = await fetch(`${url.origin}/.netlify/functions/directory-public?slug=${slug}`);
    const coach = r.ok ? (await r.json()).coach : null;
    if (!coach || !coach.photo) return Response.redirect(new URL(FALLBACK, url), 302);

    const photo = await dataUri(coach.photo);
    if (!photo) return Response.redirect(new URL(FALLBACK, url), 302);
    const bird = await dataUri(`${url.origin}/brand/birdBox-silver.png`);

    const fonts = await Promise.all([
      ["latin", 400], ["latin", 800], ["latin-ext", 400], ["latin-ext", 800],
    ].map(async ([set, weight]) => ({
      name: "Inter", weight, style: "normal",
      data: await (await fetch(`${url.origin}/share-source/fonts/inter-${set}-${weight}.woff`)).arrayBuffer(),
    })));

    const level = (c) => `${String(c.brand || "").toUpperCase()}${c.level ? " LEVEL " + String(c.level).replace(/\D/g, "") : ""}`;
    const chips = [...new Set((coach.courses || []).filter((c) => c.brand).map(level))];
    const where = [coach.city, countryName(coach.country)].filter(Boolean).join(", ");

    const img = new ImageResponse(card({
      name: coach.name || "BirdBox coach",
      line1: coach.headline || coach.gym || "",
      line2: [coach.headline && coach.gym ? coach.gym : null, where].filter(Boolean).join(" · "),
      chips, photo, bird,
    }), { width: 1200, height: 630, fonts });

    const headers = new Headers(img.headers);
    headers.set("Cache-Control", "public, max-age=86400");
    headers.set("Netlify-CDN-Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    return new Response(img.body, { status: 200, headers });
  } catch (err) {
    console.error("coach-card failed", slug, err && err.message);
    return Response.redirect(new URL(FALLBACK, url), 302);
  }
};

// Only JPEG and PNG: the drawing library cannot read WebP or HEIC.
async function dataUri(src) {
  const r = await fetch(src);
  if (!r.ok) return null;
  const type = (r.headers.get("content-type") || "").split(";")[0].trim();
  if (!/^image\/(jpeg|jpg|png)$/.test(type)) return null;
  return `data:${type};base64,${encodeBase64(new Uint8Array(await r.arrayBuffer()))}`;
}

function countryName(code) {
  if (!code || String(code).length !== 2) return code || "";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(String(code).toUpperCase()) || code; } catch { return code; }
}

// The layout, as plain elements (the same as the mock-up Nathan approved).
function card({ name, line1, line2, chips, photo, bird }) {
  const h = (type, style, children, extra) => ({ type, props: { style, children, ...(extra || {}) } });
  return h("div", { width: 1200, height: 630, display: "flex", background: "#14100F", position: "relative", fontFamily: "Inter" }, [
    h("div", { position: "absolute", left: 0, top: 0, bottom: 0, width: 12, background: BLUE }),
    h("div", { display: "flex", alignItems: "center", paddingLeft: 86, paddingRight: 80, width: "100%" }, [
      h("img", { width: 400, height: 400, objectFit: "cover", border: "1px solid #342F31" }, undefined, { src: photo, width: 400, height: 400 }),
      h("div", { display: "flex", flexDirection: "column", marginLeft: 64, flex: 1, height: 470, justifyContent: "space-between" }, [
        h("div", { display: "flex", alignItems: "center" }, [
          h("img", { height: 64 }, undefined, { src: bird, height: 64, width: 57 }),
          h("div", { color: BLUE_TEXT, fontSize: 19, letterSpacing: 3, marginLeft: 18, fontWeight: 800 }, "BIRDBOX TRAINER DIRECTORY"),
        ]),
        h("div", { display: "flex", flexDirection: "column" }, [
          h("div", { color: "#F4F1EE", fontSize: name.length > 20 ? 52 : 62, fontWeight: 800, lineHeight: 1.02, letterSpacing: -0.8 }, name.toUpperCase()),
          line1 ? h("div", { color: BLUE_TEXT, fontSize: 25, marginTop: 18, lineHeight: 1.3, fontWeight: 400 }, line1) : null,
          line2 ? h("div", { color: "#ADA6A8", fontSize: 21, marginTop: 8 }, line2) : null,
          chips.length
            ? h("div", { display: "flex", flexWrap: "wrap", marginTop: 26 }, chips.slice(0, 4).map((label) =>
                h("div", { display: "flex", color: "#ADA6A8", border: "1px solid #4a4345", padding: "7px 13px", fontSize: 16, fontWeight: 800, letterSpacing: 1.6, marginRight: 10, marginBottom: 10 }, label)))
            : null,
        ].filter(Boolean)),
        h("div", { color: "#8A8385", fontSize: 19, letterSpacing: 1 }, "birdboxcoaching.com/trainer-directory"),
      ]),
    ]),
  ]);
}

export const config = { path: "/share/coach/*", cache: "manual" };
