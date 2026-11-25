// netlify/functions/mentor-calendar.mjs
//
// Calendar and booking for the mentor portal (Nathan, 22 Nov 2026).
// The only way in to the mentor_* tables (they have no browser policies,
// see sql/mentor-booking.sql), so nothing here can slow or touch the
// seminar portal or programming tables.
//
// While the mentor portal is being built, only admins (Nathan and
// Michaela) and the build team (Barney) can use it: see portal/mentor/access.js.
// They can look after any mentor's calendar.
//
// GET  ?mentor=<staff id>&from=YYYY-MM-DD&days=7
//   -> { me, mentor, mentors, settings, availability, timeOff, bookings, mentees, slots }
// POST { action, mentor?, ... }
//   save_availability { blocks:[{weekday,start_min,end_min}] }
//   save_settings     { settings:{tz, weekly_minutes, opening_minutes, buffer_minutes, notice_hours, max_per_day} }
//   add_time_off      { starts_on, ends_on, reason? }      remove_time_off { id }
//   book              { kind, starts_at, mentorship_id? , mentee_name?, mentee_email?, note? }
//   update_booking    { id, status?, starts_at?, record?, transcribe?, cancel_reason? }

import { db, json, userFrom } from "../lib/directory.mjs";
import { canUseMentor } from "../../portal/mentor/access.js";
import { openSlots, clashes, DEFAULT_SETTINGS, zonedToUtc, mondayOf, addDays, utcToZoned } from "../../portal/mentor/slots.js";

async function whoIs(req) {
  const user = await userFrom(req);
  if (!user) return null;
  const { data: staff } = await db.from("staff").select("id, full_name, role, active").eq("id", user.id).maybeSingle();
  return staff && staff.active ? staff : null;
}

async function settingsFor(id) {
  const { data } = await db.from("mentor_settings").select("*").eq("staff_id", id).maybeSingle();
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}

const TZ_OK = (tz) => { try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; } };
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

export default async (req) => {
  const me = await whoIs(req);
  if (!me) return json({ error: "Please sign in again." }, 401);
  if (!canUseMentor(me)) return json({ error: "The mentor portal isn't open yet." }, 403);
  // Only admins can look after someone else's calendar; everyone else only their own.
  const isAdmin = me.role === "admin";

  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const mentor = isAdmin ? (url.searchParams.get("mentor") || me.id) : me.id;
      const settings = await settingsFor(mentor);
      const today = utcToZoned(Date.now(), settings.tz).date;
      const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : mondayOf(today);
      const days = int(url.searchParams.get("days") || 7, 1, 42);
      const fromMs = zonedToUtc(from, 0, settings.tz), toMs = zonedToUtc(addDays(from, days), 0, settings.tz);
      // bookings for the visible range, plus the next three weeks for working out open times
      const horizon = Math.max(toMs, Date.now() + 22 * 86400000);
      const [mentors, avail, off, books, mentees] = await Promise.all([
        db.from("staff").select("id, full_name, role").eq("active", true).order("full_name"),
        db.from("mentor_availability").select("weekday, start_min, end_min").eq("staff_id", mentor),
        db.from("mentor_time_off").select("id, starts_on, ends_on, reason").eq("staff_id", mentor).gte("ends_on", addDays(from, -1)).order("starts_on"),
        db.from("mentor_bookings").select("id, mentorship_id, mentee_name, mentee_email, kind, starts_at, ends_at, status, record, transcribe, room_url, note")
          .eq("mentor_id", mentor).gte("starts_at", new Date(Math.min(fromMs, Date.now())).toISOString()).lt("starts_at", new Date(horizon).toISOString()).order("starts_at"),
        db.from("learn_mentorships").select("id, first_name, last_name, email, brand, track, mentor_id, status").neq("status", "finished").order("created_at", { ascending: false }),
      ]);
      for (const r of [mentors, avail, off, books, mentees]) if (r.error) throw r.error;
      const bookings = books.data || [];
      const slotArgs = { settings, availability: avail.data || [], timeOff: off.data || [], bookings };
      return json({
        me: { id: me.id, name: me.full_name, admin: isAdmin },
        mentor, from, days,
        mentors: isAdmin ? (mentors.data || []).map((s) => ({ id: s.id, name: s.full_name, admin: s.role === "admin" })) : [{ id: me.id, name: me.full_name, admin: false }],
        settings, availability: avail.data || [], timeOff: off.data || [],
        bookings: bookings.filter((b) => Date.parse(b.starts_at) >= fromMs && Date.parse(b.starts_at) < toMs),
        upcoming: bookings.filter((b) => b.status === "booked" && Date.parse(b.ends_at) > Date.now()).slice(0, 20),
        mentees: (mentees.data || []).filter((m) => isAdmin || m.mentor_id === me.id).map((m) => ({ id: m.id, name: [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email, email: m.email, brand: m.brand, mentor_id: m.mentor_id })),
        slots: { weekly: openSlots({ ...slotArgs, kind: "weekly", days: 14 }).slice(0, 40), opening: openSlots({ ...slotArgs, kind: "opening", days: 14 }).slice(0, 40) },
      });
    }

    if (req.method !== "POST") return json({ error: "Use GET or POST" }, 405);
    const body = await req.json().catch(() => ({}));
    const mentor = body.mentor || me.id;
    if (mentor !== me.id && !isAdmin) return json({ error: "You can only change your own calendar." }, 403);
    if (mentor !== me.id) { // only look the mentor up when acting for someone else
      const { data: mentorRow } = await db.from("staff").select("id").eq("id", mentor).maybeSingle();
      if (!mentorRow) return json({ error: "Unknown mentor" }, 400);
    }

    if (body.action === "save_availability") {
      const blocks = (Array.isArray(body.blocks) ? body.blocks : []).slice(0, 200)
        .map((b) => ({ staff_id: mentor, weekday: int(b.weekday, 0, 6), start_min: int(b.start_min, 0, 1439), end_min: int(b.end_min, 1, 1440) }))
        .filter((b) => b.end_min > b.start_min);
      const del = await db.from("mentor_availability").delete().eq("staff_id", mentor);
      if (del.error) throw del.error;
      if (blocks.length) { const ins = await db.from("mentor_availability").insert(blocks); if (ins.error) throw ins.error; }
      return json({ ok: true, saved: blocks.length });
    }

    if (body.action === "save_settings") {
      const s = body.settings || {};
      const row = { staff_id: mentor, updated_at: new Date().toISOString() };
      if (s.tz != null) { if (!TZ_OK(s.tz)) return json({ error: "Unknown time zone" }, 400); row.tz = s.tz; }
      if (s.weekly_minutes != null) row.weekly_minutes = int(s.weekly_minutes, 15, 120);
      if (s.opening_minutes != null) row.opening_minutes = int(s.opening_minutes, 15, 180);
      if (s.buffer_minutes != null) row.buffer_minutes = int(s.buffer_minutes, 0, 60);
      if (s.notice_hours != null) row.notice_hours = int(s.notice_hours, 0, 168);
      if (s.max_per_day != null) row.max_per_day = int(s.max_per_day, 1, 12);
      const r = await db.from("mentor_settings").upsert(row, { onConflict: "staff_id" });
      if (r.error) throw r.error;
      return json({ ok: true });
    }

    if (body.action === "add_time_off") {
      const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
      if (!ok(body.starts_on) || !ok(body.ends_on || body.starts_on)) return json({ error: "Which dates?" }, 400);
      const r = await db.from("mentor_time_off").insert({ staff_id: mentor, starts_on: body.starts_on, ends_on: body.ends_on || body.starts_on, reason: String(body.reason || "").slice(0, 200) || null }).select("id").single();
      if (r.error) throw r.error;
      return json({ ok: true, id: r.data.id });
    }
    if (body.action === "remove_time_off") {
      const r = await db.from("mentor_time_off").delete().eq("id", body.id).eq("staff_id", mentor);
      if (r.error) throw r.error;
      return json({ ok: true });
    }

    if (body.action === "book") {
      const settings = await settingsFor(mentor);
      const kind = body.kind === "opening" ? "opening" : "weekly";
      const startsMs = Date.parse(body.starts_at);
      if (!startsMs) return json({ error: "Pick a time" }, 400);
      const endsMs = startsMs + (kind === "opening" ? settings.opening_minutes : settings.weekly_minutes) * 60000;
      const { data: near } = await db.from("mentor_bookings").select("id, starts_at, ends_at, status").eq("mentor_id", mentor).eq("status", "booked")
        .gte("starts_at", new Date(startsMs - 4 * 3600000).toISOString()).lte("starts_at", new Date(endsMs + 4 * 3600000).toISOString());
      if (clashes({ startsMs, endsMs, bookings: near || [], bufferMin: settings.buffer_minutes })) return json({ error: "That clashes with another call (including the gap between calls)." }, 409);
      let name = String(body.mentee_name || "").trim().slice(0, 120), email = String(body.mentee_email || "").trim().toLowerCase().slice(0, 200);
      if (body.mentorship_id) {
        const { data: m } = await db.from("learn_mentorships").select("first_name, last_name, email").eq("id", body.mentorship_id).maybeSingle();
        if (!m) return json({ error: "Unknown mentee" }, 400);
        name = [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email; email = m.email;
      }
      if (!name) return json({ error: "Who is the call with?" }, 400);
      const r = await db.from("mentor_bookings").insert({
        mentor_id: mentor, mentorship_id: body.mentorship_id || null, mentee_name: name, mentee_email: email || null, kind,
        starts_at: new Date(startsMs).toISOString(), ends_at: new Date(endsMs).toISOString(),
        record: kind === "opening", transcribe: kind === "opening", note: String(body.note || "").slice(0, 500) || null, booked_by: me.id,
      }).select("id").single();
      if (r.error) { if (r.error.code === "23505") return json({ error: "There's already a call at that time." }, 409); throw r.error; }
      return json({ ok: true, id: r.data.id });
    }

    if (body.action === "update_booking") {
      const { data: b } = await db.from("mentor_bookings").select("*").eq("id", body.id).eq("mentor_id", mentor).maybeSingle();
      if (!b) return json({ error: "Call not found" }, 404);
      const patch = {};
      if (body.status && ["booked", "cancelled", "done", "missed"].includes(body.status)) {
        patch.status = body.status;
        if (body.status === "cancelled") { patch.cancelled_at = new Date().toISOString(); patch.cancel_reason = String(body.cancel_reason || "").slice(0, 300) || null; }
      }
      if (typeof body.record === "boolean") patch.record = body.record;
      if (typeof body.transcribe === "boolean") patch.transcribe = body.transcribe;
      if (body.starts_at) {
        const settings = await settingsFor(mentor);
        const startsMs = Date.parse(body.starts_at); if (!startsMs) return json({ error: "Pick a time" }, 400);
        const endsMs = startsMs + (Date.parse(b.ends_at) - Date.parse(b.starts_at));
        const { data: near } = await db.from("mentor_bookings").select("id, starts_at, ends_at, status").eq("mentor_id", mentor).eq("status", "booked")
          .gte("starts_at", new Date(startsMs - 4 * 3600000).toISOString()).lte("starts_at", new Date(endsMs + 4 * 3600000).toISOString());
        if (clashes({ startsMs, endsMs, bookings: near || [], bufferMin: settings.buffer_minutes, ignoreId: b.id })) return json({ error: "That clashes with another call." }, 409);
        patch.starts_at = new Date(startsMs).toISOString(); patch.ends_at = new Date(endsMs).toISOString();
      }
      const r = await db.from("mentor_bookings").update(patch).eq("id", b.id);
      if (r.error) throw r.error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("mentor-calendar", err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
