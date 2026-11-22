// portal/mentor/slots.js
//
// Booking maths, shared by the mentor portal (browser) and the server
// function netlify/functions/mentor-calendar.mjs, so both always agree on
// which times are open. No dependencies, no DOM.

// ---------- time zones ----------

// Minutes the zone is ahead of UTC at a given moment.
export function tzOffsetMin(tz, ms) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

// A wall-clock time in a zone ("2026-11-24", 450 = 07:30) → UTC milliseconds.
export function zonedToUtc(dateStr, minutes, tz) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let off = tzOffsetMin(tz, guess);
  let ms = guess - off * 60000;
  const off2 = tzOffsetMin(tz, ms); // clocks changing that day
  if (off2 !== off) ms = guess - off2 * 60000;
  return ms;
}

// UTC milliseconds → { date: "YYYY-MM-DD", min: minutes since midnight, weekday: 0=Mon } in a zone.
export function utcToZoned(ms, tz) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const wd = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[p.weekday];
  return { date, min: (+p.hour % 24) * 60 + +p.minute, weekday: wd };
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function weekdayOf(dateStr) { // 0 = Monday
  const [y, m, d] = dateStr.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
export function mondayOf(dateStr) { return addDays(dateStr, -weekdayOf(dateStr)); }

export const DEFAULT_SETTINGS = { tz: "Europe/Dublin", weekly_minutes: 30, opening_minutes: 60, buffer_minutes: 10, notice_hours: 12, max_per_day: 4 };

// ---------- open slots ----------

// Every time a mentee could book, from now (plus notice) for `days` days.
// availability: [{weekday, start_min, end_min}] in the mentor's zone
// timeOff:      [{starts_on, ends_on}]
// bookings:     [{starts_at, ends_at, status}] (only "booked" ones block)
// kind:         "weekly" | "opening" (decides the length)
// step:         how often a start time is offered, in minutes
export function openSlots({ settings, availability, timeOff = [], bookings = [], kind = "weekly", days = 21, now = Date.now(), step = 30 }) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const len = kind === "opening" ? s.opening_minutes : s.weekly_minutes;
  const earliest = now + s.notice_hours * 3600000;
  const live = bookings.filter((b) => b.status === "booked").map((b) => [Date.parse(b.starts_at), Date.parse(b.ends_at)]);
  const buf = s.buffer_minutes * 60000;
  const today = utcToZoned(now, s.tz).date;
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    if (timeOff.some((o) => date >= o.starts_on && date <= o.ends_on)) continue;
    const wd = weekdayOf(date);
    const dayStart = zonedToUtc(date, 0, s.tz), dayEnd = zonedToUtc(addDays(date, 1), 0, s.tz);
    let count = live.filter(([a]) => a >= dayStart && a < dayEnd).length;
    if (count >= s.max_per_day) continue;
    const blocks = availability.filter((a) => a.weekday === wd).sort((a, b) => a.start_min - b.start_min);
    for (const b of blocks) {
      for (let m = b.start_min; m + len <= b.end_min; m += step) {
        const a = zonedToUtc(date, m, s.tz), e = a + len * 60000;
        if (a < earliest) continue;
        if (live.some(([x, y]) => a < y + buf && e > x - buf)) continue;
        out.push({ starts_at: new Date(a).toISOString(), ends_at: new Date(e).toISOString(), date, min: m });
        if (out.filter((o) => o.date === date).length + count >= s.max_per_day * 4) break; // keep the list sensible
      }
    }
  }
  return out;
}

// Does a new call clash with live bookings (allowing the buffer)?
export function clashes({ startsMs, endsMs, bookings, bufferMin = 0, ignoreId = null }) {
  const buf = bufferMin * 60000;
  return bookings.some((b) => b.status === "booked" && b.id !== ignoreId &&
    startsMs < Date.parse(b.ends_at) + buf && endsMs > Date.parse(b.starts_at) - buf);
}

// Turn painted 30-minute cells (Set of "weekday-slotIndex", slot 0 = first slot) into blocks.
export function cellsToBlocks(cells, firstMin = 360, slotMin = 30) {
  const byDay = {};
  for (const k of cells) { const [d, i] = k.split("-").map(Number); (byDay[d] = byDay[d] || []).push(i); }
  const out = [];
  for (const [d, list] of Object.entries(byDay)) {
    list.sort((a, b) => a - b);
    let start = list[0], prev = list[0];
    for (let j = 1; j <= list.length; j++) {
      if (list[j] === prev + 1) { prev = list[j]; continue; }
      out.push({ weekday: +d, start_min: firstMin + start * slotMin, end_min: firstMin + (prev + 1) * slotMin });
      start = prev = list[j];
    }
  }
  return out;
}
export function blocksToCells(blocks, firstMin = 360, slotMin = 30) {
  const s = new Set();
  for (const b of blocks) for (let m = Math.max(b.start_min, firstMin); m < b.end_min; m += slotMin) s.add(`${b.weekday}-${(m - firstMin) / slotMin}`);
  return s;
}
