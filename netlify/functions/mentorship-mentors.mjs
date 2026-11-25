// netlify/functions/mentorship-mentors.mjs
//
// GET -> { mentors: [{ id, name, region, photo, founder }] }
//
// The mentors shown on /mentorship/ and in the pre-registration form
// (Nathan, 25 Nov 2026): every active member of staff can mentor except
// support staff (Sarah and Nico). Read from the staff list, so new staff
// appear by themselves. Public: only names, a region and a photo, which
// the team page already shows.

import { db, json } from "../lib/directory.mjs";

const NATHAN = "ac2157f5-5b2a-4a67-a243-e044ce808ca8";
const REGION = (c) => {
  if (!c) return "";
  if (["US", "CA", "MX", "BR", "AR", "CL", "CO", "PE", "UY"].includes(c)) return "Americas";
  if (["AU", "NZ", "JP", "SG", "HK", "TW", "KR", "CN", "PH", "TH", "MY", "ID", "IN"].includes(c)) return "Asia-Pacific";
  if (["ZA", "NG", "KE", "EG", "MA"].includes(c)) return "Africa";
  if (["AE", "SA", "QA", "IL", "TR", "KW", "BH", "OM"].includes(c)) return "Middle East";
  return "Europe";
};

export default async () => {
  try {
    const { data, error } = await db.from("staff")
      .select("id, full_name, role, country, photo_path").eq("active", true).neq("role", "support").order("full_name");
    if (error) throw error;
    const paths = data.map((s) => s.photo_path).filter(Boolean);
    const signed = paths.length ? (await db.storage.from("staff-photos").createSignedUrls(paths, 60 * 60 * 26)).data || [] : [];
    const url = Object.fromEntries(signed.filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
    // Nathan first, then everyone else by name
    const mentors = data.map((s) => ({ id: s.id, name: s.full_name, region: REGION(s.country), photo: url[s.photo_path] || null, founder: s.id === NATHAN }))
      .sort((a, b) => (b.founder - a.founder) || a.name.localeCompare(b.name));
    return json({ mentors }, 200, "public, max-age=3600");
  } catch (err) {
    console.error("mentorship-mentors", err);
    return json({ mentors: [] }, 200, "no-store");
  }
};
