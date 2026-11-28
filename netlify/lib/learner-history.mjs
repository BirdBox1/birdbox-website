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
  const out = { online: [], onlineKeys: [], programming: false, seminars: [], any: false };
  if (!e) return out;

  const safe = (p) => p.then((r) => r.data || []).catch(() => []);

  const [enrolments, regs, pastCerts, pastAtt, athletes] = await Promise.all([
    safe(db.from("learn_enrolments").select("learn_courses(brand, level, title)").ilike("email", like)),
    safe(db.from("registrations").select("course_id, status, courses!registrations_course_id_fkey(brand, level, type, city, starts_at)").ilike("email", like).neq("status", "cancelled")),
    safe(db.from("past_certificates").select("brand, level, kind, awarded_on").ilike("email", like).is("revoked_at", null)),
    safe(db.from("past_attendees").select("brand, level, event_date, place, status").ilike("email", like).is("revoked_at", null)),
    safe(db.schema("train").from("athletes").select("id").ilike("email", like).limit(5)),
  ]);

  // online courses
  const online = new Set();
  for (const r of enrolments) {
    const c = r.learn_courses; if (!c) continue;
    online.add(`${NAME[c.brand] || "BirdBox"}${level(c.level)} online course`);
    out.onlineKeys.push(c.brand + level(c.level));
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
    seminars.push({ label, key: workshop ? null : brand + level(lvl), city: city || null, year, when: String(when || "") });
  };
  for (const r of regs) {
    if (r.course_id === exceptCourseId || !r.courses) continue;
    if (String(r.courses.starts_at || "") > new Date().toISOString()) continue;   // only ones already done
    add(r.courses.brand, r.courses.level, r.courses.type === "workshop", r.courses.city, r.courses.starts_at);
  }
  for (const c of pastCerts) {
    // an old SimpleCert certificate for an online course is an online course, not a seminar
    if (c.kind === "online") {
      const label = `${NAME[c.brand] || "BirdBox"}${level(c.level)} online course`;
      if (!out.online.includes(label)) out.online.push(label);
      out.onlineKeys.push(c.brand + level(c.level));
      continue;
    }
    add(c.brand, c.level === "advanced" ? "" : c.level, false, null, c.awarded_on);
  }
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

// The first line under "Your BirdBox Learn account" for someone we know
// (Nathan, 20 Nov 2026). It recognises the same course done before:
//   a past seminar of this course -> great to see you retaking it
//   this course online            -> great to see you taking it live
//   anything else                 -> we know you from ...
export function welcomeBack(h, course) {
  const key = String(course.brand || "").toLowerCase() + level(course.level);
  const name = (NAME[course.brand] || "BirdBox") + level(course.level);
  // the first time they took it (seminars are newest first)
  const same = h.seminars.filter((s) => s.key === key).pop();
  if (same) {
    return "Welcome back, it is great to see you have decided to retake " + name +
      (same.city || same.year ? " (you first took it" + (same.city ? " in " + same.city : "") + (same.year ? (same.city ? ", " : " in ") + same.year : "") + ")" : "") + ".";
  }
  if (h.onlineKeys.includes(key)) {
    return "Welcome back, it is great to see you taking " + name + " live after the online course.";
  }
  const others = { ...h, online: h.online.filter((o) => !o.startsWith(name + " ")) };
  const line = historyLine(others);
  return line ? "Welcome back, we know you from " + line + "." : "Welcome back.";
}
