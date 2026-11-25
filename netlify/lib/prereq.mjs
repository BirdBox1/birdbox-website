// TGC Level 2 needs TGC Level 1 first (Nathan, 20 Nov 2026).
//
// The booking page asks for their email and checks our records. Found:
// a green tick and that email is locked in at checkout. Not found: they
// say where and when they did Level 1 and can still book; the booking is
// flagged "Level 1 to check" in the portal. Nobody is turned away, because
// only 41% of past Level 2 bookers have a Level 1 we can find under the
// same email (other emails, before 2019, courses with no list).
//
// Counts: a TGC Level 1 seminar (our certificates or attendance, the old
// SimpleCert certificates incl. the old Advanced course, the RegFox lists)
// or the TGC Level 1 online course finished (BirdBox Learn or LearnWorlds).

import crypto from "node:crypto";
import { db } from "./directory.mjs";

// brand -> levels that need Level 1 of the same brand
const NEEDS_LEVEL_1 = { tgc: ["2"] };

const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "");

export function needsLevel1(course) {
  if (!course || course.type === "workshop") return false;
  return (NEEDS_LEVEL_1[String(course.brand || "").toLowerCase()] || []).includes(digits(course.level));
}

// What we have for this email: { found, label } with label like
// "TGC Level 1 seminar, 2025" or "TGC Level 1 online course".
export async function level1Record(email, brand) {
  const e = String(email || "").trim().toLowerCase();
  const like = e.replace(/[%_\\]/g, "\\$&");
  const b = String(brand || "").toLowerCase();
  const NAME = { tgc: "TGC", tcc: "TCC" }[b] || b.toUpperCase();
  if (!e || !e.includes("@")) return { found: false };
  const isL1 = (lvl) => digits(lvl) === "1";
  const year = (d) => (d ? String(d).slice(0, 4) : "");

  const [regs, past, att, enrol, lcerts] = await Promise.all([
    db.from("registrations").select("attended, courses!registrations_course_id_fkey(brand, level, type, city, starts_at)")
      .ilike("email", like).neq("status", "cancelled").then((r) => r.data || []),
    db.from("past_certificates").select("level, awarded_on").ilike("email", like).eq("brand", b).is("revoked_at", null).then((r) => r.data || []),
    db.from("past_attendees").select("level, event_date, place, status").ilike("email", like).eq("brand", b).is("revoked_at", null).then((r) => r.data || []),
    db.from("learn_enrolments").select("lw_completed_at, course_id, learn_courses(brand, level)").ilike("email", like).then((r) => r.data || []),
    db.from("learn_certificates").select("course_id, learn_courses(brand, level)").ilike("email", like).then((r) => r.data || []),
  ]);

  // a seminar they attended
  const seminar = regs.find((r) => r.attended && r.courses && r.courses.brand === b && r.courses.type === "live_seminar" && isL1(r.courses.level)
    && String(r.courses.starts_at || "") <= new Date().toISOString());
  if (seminar) return { found: true, label: `${NAME} Level 1 seminar` + (seminar.courses.city ? `, ${seminar.courses.city}` : "") + `, ${year(seminar.courses.starts_at)}` };

  const pc = past.find((p) => isL1(p.level) || p.level === "advanced");
  if (pc) return { found: true, label: `${NAME} ${pc.level === "advanced" ? "Advanced course" : "Level 1 seminar"}, ${year(pc.awarded_on)}` };

  const pa = att.find((p) => p.status === "Completed" && isL1(p.level));
  if (pa) return { found: true, label: `${NAME} Level 1 seminar` + (pa.place ? `, ${pa.place}` : "") + `, ${year(pa.event_date)}` };

  // the online course, finished
  const onlineL1 = (c) => c && c.brand === b && isL1(c.level);
  if (lcerts.some((c) => onlineL1(c.learn_courses)) || enrol.some((x) => x.lw_completed_at && onlineL1(x.learn_courses))) {
    return { found: true, label: `${NAME} Level 1 online course` };
  }
  // finished on the new BirdBox Learn (no certificate row yet)
  const ids = enrol.filter((x) => onlineL1(x.learn_courses)).map((x) => x.course_id);
  if (ids.length) {
    const { data: tries } = await db.from("learn_attempts").select("success_status, completion_status")
      .ilike("email", like).in("course_id", ids);
    if ((tries || []).some((t) => t.success_status === "passed" || (t.success_status !== "failed" && t.completion_status === "completed"))) {
      return { found: true, label: `${NAME} Level 1 online course` };
    }
  }
  return { found: false };
}

// A signed note that this email was checked for this course, so checkout
// can lock the email in. Lasts 2 hours.
const SECRET = () => process.env.LEARN_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const sign = (s) => crypto.createHmac("sha256", SECRET()).update(s).digest("base64url");

export function prereqToken({ email, slug, found }) {
  const body = Buffer.from(JSON.stringify({ e: email, s: slug, f: !!found, x: Date.now() + 2 * 3600000 })).toString("base64url");
  return body + "." + sign(body);
}

export function readPrereqToken(token, slug) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const want = sign(body);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString());
    if (t.s !== slug || t.x < Date.now()) return null;
    return { email: t.e, found: t.f };
  } catch { return null; }
}
