// What a learner has already done with BirdBox (Nathan, 20 Nov 2026), so
// the seminar confirmation can say "you already have a login from your
// TGC online course" rather than treating everyone as new.
//
// Looks at: online courses (BirdBox Learn and LearnWorlds), programming in
// the app, and other live seminars and workshops (our own bookings, the
// old SimpleCert certificates and the RegFox attendee lists). Matched on
// the booking email only.

import { db } from "./directory.mjs";

const NAME = { tgc: "TGC", tcc: "TCC", tec: "TEC", twc: "TWC" };
const level = (l) => { const d = String(l || "").replace(/\D/g, ""); return d ? " Level " + d : ""; };

export async function learnerHistory(email, { exceptCourseId } = {}) {
  const e = String(email || "").trim().toLowerCase();
  const like = e.replace(/[%_\\]/g, "\\$&");
  const out = { online: [], programming: false, seminars: [], any: false };
  if (!e) return out;

  const safe = (p) => p.then((r) => r.data || []).catch(() => []);

  const [enrolments, regs, pastCerts, pastAtt, athletes] = await Promise.all([
    safe(db.from("learn_enrolments").select("learn_courses(brand, level, title)").ilike("email", like)),
    safe(db.from("registrations").select("course_id, status, courses!registrations_course_id_fkey(brand, level, type, city, starts_at)").ilike("email", like).neq("status", "cancelled")),
    safe(db.from("past_certificates").select("brand, level, awarded_on").ilike("email", like)),
    safe(db.from("past_attendees").select("brand, level, event_date, place, status").ilike("email", like)),
    safe(db.schema("train").from("athletes").select("id").ilike("email", like).limit(5)),
  ]);

  // online courses
  const online = new Set();
  for (const r of enrolments) {
    const c = r.learn_courses; if (!c) continue;
    online.add(`${NAME[c.brand] || "BirdBox"}${level(c.level)} online course`);
  }
  out.online = [...online];

  // programming in the app
  const ids = athletes.map((a) => a.id);
  if (ids.length) {
    const has = async (t) => {
      const { count } = await db.schema("train").from(t).select("id", { count: "exact", head: true }).in("athlete_id", ids);
      return (count || 0) > 0;
    };
    try { out.programming = (await has("enrolments")) || (await has("purchases")); } catch { /* leave false */ }
  }

  // other seminars and workshops, newest first, one line each
  const seen = new Set(), seminars = [];
  const add = (brand, lvl, workshop, city, when) => {
    const label = `${NAME[brand] || "BirdBox"}${workshop ? " workshop" : level(lvl) + " seminar"}`;
    const year = when ? String(when).slice(0, 4) : "";
    const key = label + year;
    if (seen.has(key)) return;
    seen.add(key);
    seminars.push({ label, city: city || null, year, when: String(when || "") });
  };
  for (const r of regs) {
    if (r.course_id === exceptCourseId || !r.courses) continue;
    add(r.courses.brand, r.courses.level, r.courses.type === "workshop", r.courses.city, r.courses.starts_at);
  }
  for (const c of pastCerts) add(c.brand, c.level === "advanced" ? "" : c.level, false, null, c.awarded_on);
  for (const a of pastAtt) if (a.status === "Completed") add(a.brand, a.level, false, a.place, a.event_date);
  out.seminars = seminars.sort((a, b) => b.when.localeCompare(a.when));

  out.any = out.online.length > 0 || out.programming || out.seminars.length > 0;
  return out;
}

// "your TGC Level 1 online course, your BirdBox programming and your TCC
// Level 1 seminar (Madrid, 2024)": at most three things, newest seminar first.
export function historyLine(h) {
  const parts = [];
  for (const o of h.online.slice(0, 2)) parts.push("your " + o);
  if (h.programming) parts.push("your BirdBox programming");
  const s = h.seminars[0];
  if (s) parts.push("your " + s.label + (s.city || s.year ? " (" + [s.city, s.year].filter(Boolean).join(", ") + ")" : ""));
  const list = parts.slice(0, 3);
  if (list.length <= 1) return list.join("");
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}
