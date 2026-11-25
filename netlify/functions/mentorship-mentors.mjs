// netlify/functions/mentorship-mentors.mjs
//
// GET -> { mentors: [{ id, name, region, photo, founder }] }
//
// The mentor team for /mentorship/ and the pre-registration form: the
// coaches in portal/mentor/mentor-team.js (staff poll + Jessica, 25 Nov 2026),
// as long as they are still active staff. Region comes from their staff
// country. Public: name, region and their team-page photo only.

import { db, json } from "../lib/directory.mjs";
import { MENTOR_TEAM } from "../../portal/mentor/mentor-team.js";

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
    const { data, error } = await db.from("staff").select("id, country, active").in("id", MENTOR_TEAM.map((m) => m.id));
    if (error) throw error;
    const byId = Object.fromEntries((data || []).map((s) => [s.id, s]));
    const mentors = MENTOR_TEAM.filter((m) => byId[m.id]?.active)
      .map((m) => ({ id: m.id, name: m.name, founder: !!m.founder, region: REGION(byId[m.id].country), photo: `/birdbox-team/${m.photo}.jpeg` }));
    return json({ mentors }, 200, "public, max-age=600");
  } catch (err) {
    console.error("mentorship-mentors", err);
    return json({ mentors: MENTOR_TEAM.map((m) => ({ id: m.id, name: m.name, founder: !!m.founder, region: "", photo: `/birdbox-team/${m.photo}.jpeg` })) }, 200, "no-store");
  }
};
