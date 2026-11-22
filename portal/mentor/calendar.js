// portal/mentor/calendar.js
//
// Calendar and booking, on real data (Nathan, 22 Nov 2026). Replaces the
// example calendar page from app.js. Talks only to
// /.netlify/functions/mentor-calendar (admins only for now).
// On localhost it uses a pretend store in memory so it can be tried
// without touching the database.

import * as S from "./slots.js";

const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const FIRST = 6 * 60, SLOTS = 32, SLOT = 30; // 06:00 to 22:00
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TZS = ["Europe/Dublin", "Europe/London", "Europe/Madrid", "Europe/Paris", "Europe/Berlin", "Europe/Rome", "Europe/Amsterdam", "Europe/Lisbon", "Europe/Warsaw", "Europe/Athens", "Africa/Johannesburg", "Asia/Dubai", "Asia/Singapore", "Asia/Taipei", "Australia/Sydney", "Pacific/Auckland", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "America/Mexico_City", "America/Cancun"];

// ---------- talking to the server ----------
async function api(method, body, query) {
  if (LOCAL) return mock(method, body, query);
  const { data: { session } } = await window.MENTOR_DB.auth.getSession();
  if (!session) throw new Error("Please sign in again.");
  const res = await fetch("/.netlify/functions/mentor-calendar" + (query ? "?" + new URLSearchParams(query) : ""), {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || "Something went wrong.");
  return out;
}

// pretend store for localhost
const M = { settings: {}, avail: [{ weekday: 0, start_min: 420, end_min: 540 }, { weekday: 1, start_min: 720, end_min: 780 }, { weekday: 3, start_min: 1080, end_min: 1200 }], off: [], books: [], seq: 1 };
async function mock(method, body = {}, q = {}) {
  await new Promise((r) => setTimeout(r, 120));
  const settings = { ...S.DEFAULT_SETTINGS, ...M.settings };
  if (method === "GET") {
    const today = S.utcToZoned(Date.now(), settings.tz).date;
    const from = q.from || S.mondayOf(today), days = +(q.days || 7);
    const a = S.zonedToUtc(from, 0, settings.tz), b = S.zonedToUtc(S.addDays(from, days), 0, settings.tz);
    const args = { settings, availability: M.avail, timeOff: M.off, bookings: M.books };
    return { me: { id: "me", name: "Nathan Bird (local test)", admin: true }, mentor: "me", from, days,
      mentors: [{ id: "me", name: "Nathan Bird (local test)", admin: true }, { id: "mi", name: "Michaela Dotterweich", admin: true }],
      settings, availability: M.avail, timeOff: M.off,
      bookings: M.books.filter((x) => Date.parse(x.starts_at) >= a && Date.parse(x.starts_at) < b),
      upcoming: M.books.filter((x) => x.status === "booked" && Date.parse(x.ends_at) > Date.now()).sort((x, y) => x.starts_at.localeCompare(y.starts_at)),
      mentees: [{ id: "m1", name: "Sam Rivera", email: "sam@example.com", brand: "tcc" }, { id: "m2", name: "Aoife Byrne", email: "aoife@example.com", brand: "tgc" }],
      slots: { weekly: S.openSlots({ ...args, kind: "weekly", days: 14 }).slice(0, 40), opening: S.openSlots({ ...args, kind: "opening", days: 14 }).slice(0, 40) } };
  }
  const x = body;
  if (x.action === "save_availability") { M.avail = x.blocks; return { ok: true }; }
  if (x.action === "save_settings") { Object.assign(M.settings, x.settings); return { ok: true }; }
  if (x.action === "add_time_off") { const id = M.seq++; M.off.push({ id, starts_on: x.starts_on, ends_on: x.ends_on || x.starts_on, reason: x.reason }); return { ok: true, id }; }
  if (x.action === "remove_time_off") { M.off = M.off.filter((o) => o.id !== x.id); return { ok: true }; }
  if (x.action === "book") {
    const len = x.kind === "opening" ? settings.opening_minutes : settings.weekly_minutes; const s = Date.parse(x.starts_at), e = s + len * 60000;
    if (S.clashes({ startsMs: s, endsMs: e, bookings: M.books, bufferMin: settings.buffer_minutes })) throw new Error("That clashes with another call (including the gap between calls).");
    const mm = { m1: ["Sam Rivera", "sam@example.com"], m2: ["Aoife Byrne", "aoife@example.com"] }[x.mentorship_id] || [x.mentee_name, x.mentee_email];
    M.books.push({ id: "b" + M.seq++, kind: x.kind, starts_at: new Date(s).toISOString(), ends_at: new Date(e).toISOString(), status: "booked", mentee_name: mm[0], mentee_email: mm[1], mentorship_id: x.mentorship_id || null, record: x.kind === "opening", transcribe: x.kind === "opening", note: x.note || null });
    return { ok: true };
  }
  if (x.action === "update_booking") {
    const b = M.books.find((y) => y.id === x.id); if (!b) throw new Error("Call not found");
    if (x.status) b.status = x.status; if (typeof x.record === "boolean") b.record = x.record; if (typeof x.transcribe === "boolean") b.transcribe = x.transcribe;
    if (x.starts_at) { const s = Date.parse(x.starts_at), len = Date.parse(b.ends_at) - Date.parse(b.starts_at); if (S.clashes({ startsMs: s, endsMs: s + len, bookings: M.books, bufferMin: settings.buffer_minutes, ignoreId: b.id })) throw new Error("That clashes with another call."); b.starts_at = new Date(s).toISOString(); b.ends_at = new Date(s + len).toISOString(); }
    return { ok: true };
  }
}

// ---------- state ----------
let C = { mentor: null, from: null, data: null, cells: new Set(), paint: null, anchor: null, saving: null };
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dateLabel = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); };
const whenLabel = (iso, tz) => { const z = S.utcToZoned(Date.parse(iso), tz); return `${DOW[z.weekday]} ${dateLabel(z.date)} · ${fmtMin(z.min)}`; };

async function load(keepScroll) {
  const q = { from: C.from || "", days: 7 }; if (C.mentor) q.mentor = C.mentor;
  C.data = await api("GET", null, q);
  C.mentor = C.data.mentor; C.from = C.data.from;
  C.cells = S.blocksToCells(C.data.availability, FIRST, SLOT);
  draw(keepScroll);
}

// ---------- instant updates, saved in the background ----------
// The page changes the moment you act; the server catches up quietly.
function recompute() {
  const d = C.data;
  d.availability = S.cellsToBlocks(C.cells, FIRST, SLOT);
  const seen = new Set(), books = [...d.bookings, ...d.upcoming].filter((b) => !seen.has(b.id) && seen.add(b.id));
  const args = { settings: d.settings, availability: d.availability, timeOff: d.timeOff, bookings: books };
  d.slots = { weekly: S.openSlots({ ...args, kind: "weekly", days: 14 }).slice(0, 40), opening: S.openSlots({ ...args, kind: "opening", days: 14 }).slice(0, 40) };
}
function status(t) { const st = document.getElementById("cal-save"); if (st) { st.textContent = t; st.style.opacity = 1; if (/✓/.test(t)) setTimeout(() => { if (st.textContent === t) st.style.opacity = .5; }, 1500); } }
let saving = false, again = false;
async function saveAvail() {
  if (saving) { again = true; return; }
  saving = true; status("Saving…");
  try { await api("POST", { action: "save_availability", mentor: C.data.mentor, blocks: S.cellsToBlocks(C.cells, FIRST, SLOT) }); status("Saved ✓"); }
  catch (e) { toast("Not saved: " + e.message); await load(true); }
  finally { saving = false; if (again) { again = false; saveAvail(); } }
}

// ---------- page ----------
ROUTES.calendar = async (el) => {
  el.innerHTML = `<div class="page"><div class="ph"><div><h1>Calendar &amp; availability</h1><p>Loading…</p></div></div></div>`;
  try { await load(); } catch (e) { el.innerHTML = `<div class="page"><div class="card empty">${esc(e.message)}</div></div>`; }
};

function draw(keepScroll) {
  const el = document.getElementById("main"); const d = C.data, s = d.settings, tz = s.tz;
  const scroll = keepScroll ? el.querySelector(".calscroll")?.scrollTop : null;
  const today = S.utcToZoned(Date.now(), tz).date;
  const dates = [...Array(7)].map((_, i) => S.addDays(d.from, i));
  const off = (date) => d.timeOff.find((o) => date >= o.starts_on && date <= o.ends_on);
  const books = d.bookings.filter((b) => b.status !== "cancelled").map((b) => ({ ...b, z: S.utcToZoned(Date.parse(b.starts_at), tz), len: (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000 }));
  const hours = C.cells.size * SLOT / 60;
  let grid = `<div class="hd"></div>` + dates.map((dt, i) => { const o = off(dt); return `<div class="hd ${dt === today ? "today" : ""}" data-day="${dt}" title="${o ? "Day off. Click to make it bookable again" : "Click to take this day off"}" style="cursor:pointer">${DOW[i]}<small>${dateLabel(dt)}${o ? " · off" : ""}</small></div>`; }).join("");
  for (let r = 0; r < SLOTS; r++) {
    const t = FIRST + r * SLOT;
    grid += `<div class="t">${t % 60 === 0 ? fmtMin(t) : ""}</div>`;
    for (let c = 0; c < 7; c++) {
      const k = `${c}-${r}`, on = C.cells.has(k), o = off(dates[c]);
      const evs = books.filter((b) => b.z.date === dates[c] && b.z.min >= t && b.z.min < t + SLOT);
      grid += `<div class="c ${t % 60 === 0 ? "hr" : ""} ${on && !o ? "av" : ""} ${on && !o && !C.cells.has(`${c}-${r - 1}`) ? "top" : ""} ${o ? "blk" : ""}" data-k="${k}">${evs.map((b) => `<div class="ev ${b.kind === "opening" ? "open" : "wk"}" data-b="${b.id}" style="top:${(b.z.min - t) / SLOT * 18 + 1}px;height:${b.len / SLOT * 18 - 2}px;${b.status === "done" ? "opacity:.55" : ""}${b.status === "missed" ? ";background:#b3261e" : ""}">${fmtMin(b.z.min)} ${esc(b.mentee_name || "")}${b.status !== "booked" ? " · " + b.status : ""}</div>`).join("")}</div>`;
    }
  }
  const sel = (key, opts, unit) => `<select class="in" style="width:120px" data-set="${key}">${opts.map((v) => `<option value="${v}" ${+s[key] === v ? "selected" : ""}>${v} ${unit}</option>`).join("")}</select>`;
  el.innerHTML = `<div class="page">
    <div class="ph"><div><h1>Calendar &amp; availability <span class="chip good" style="vertical-align:4px">Saved for real</span></h1><p>Drag across the grid to open times for booking; drag over open times to close them. Click a day to take it off. Times shown in ${esc(tz)}.</p></div>
      <div class="row wrap">${d.mentors.length > 1 ? `<select class="in" style="width:auto" id="cal-mentor">${d.mentors.map((m) => `<option value="${m.id}" ${m.id === d.mentor ? "selected" : ""}>${esc(m.name)}${m.id === d.me.id ? " (me)" : ""}</option>`).join("")}</select>` : ""}
        <div class="seg"><button id="cal-prev">‹</button><button class="${d.from === S.mondayOf(today) ? "on" : ""}" id="cal-now">This week</button><button id="cal-next">›</button></div>
        <button class="btn pri" id="cal-book">＋ Book a call</button></div></div>
    <div class="cal-wrap">
      <div class="card"><div class="pad row between wrap" style="padding:10px 14px;border-bottom:1px solid var(--rule)"><div class="legend"><span><i style="background:#e7f1fb;border:1px solid #9cc4ec"></i>Open to book</span><span><i style="background:var(--accent)"></i>Weekly call</span><span><i style="background:var(--good)"></i>Opening call</span><span><i style="background:#ebe8e2"></i>Day off</span></div><span class="small muted"><span id="cal-status">${hours} h open a week · ${books.filter((b) => b.status === "booked").length} booked this week</span> <b id="cal-save" style="color:var(--good);margin-left:6px;transition:opacity .4s"></b></span></div>
        <div class="calscroll"><div class="cal" id="cal">${grid}</div></div></div>
      <div class="stack" style="gap:16px">
        <div class="card pad"><h2 class="sec">Upcoming calls</h2>${d.upcoming.length ? `<div class="stack" style="gap:6px">${d.upcoming.slice(0, 8).map((b) => `<div class="row between" style="cursor:pointer" data-b="${b.id}"><div><b style="font-size:13px">${esc(b.mentee_name)}</b><div class="small muted">${whenLabel(b.starts_at, tz)} · ${b.kind === "opening" ? "opening, 60 min" : "weekly"}</div></div><span class="muted">›</span></div>`).join("")}</div>` : `<p class="small muted" style="margin:0">No calls booked yet.</p>`}</div>
        <div class="card pad"><h2 class="sec">Booking rules</h2><div class="stack" style="gap:10px">
          <label class="row between"><span>Weekly call</span>${sel("weekly_minutes", [30, 45, 60], "min")}</label>
          <label class="row between"><span>Opening call</span>${sel("opening_minutes", [45, 60, 75, 90], "min")}</label>
          <label class="row between"><span>Gap between calls</span>${sel("buffer_minutes", [0, 5, 10, 15, 30], "min")}</label>
          <label class="row between"><span>Least notice</span>${sel("notice_hours", [2, 6, 12, 24, 48], "hours")}</label>
          <label class="row between"><span>Most calls a day</span>${sel("max_per_day", [2, 3, 4, 5, 6, 8], "")}</label>
          <label class="row between"><span>Time zone</span><select class="in" style="width:170px" data-set="tz">${(TZS.includes(tz) ? TZS : [tz, ...TZS]).map((z) => `<option ${z === tz ? "selected" : ""}>${z}</option>`).join("")}</select></label>
          <span class="small muted">Mentees always see times in their own time zone.</span></div></div>
        <div class="card pad"><h2 class="sec">What a mentee sees</h2>
          <div class="seg" style="margin-bottom:8px"><button class="${C.kind !== "opening" ? "on" : ""}" data-kind="weekly">Weekly (${s.weekly_minutes} min)</button><button class="${C.kind === "opening" ? "on" : ""}" data-kind="opening">Opening (${s.opening_minutes} min)</button></div>
          <div class="bookprev">${(d.slots[C.kind === "opening" ? "opening" : "weekly"] || []).slice(0, 12).map((x) => `<button data-slot="${x.starts_at}">${whenLabel(x.starts_at, tz).replace(/ · /, " ")}</button>`).join("") || `<span class="small muted">No open times in the next two weeks. Paint some on the grid.</span>`}</div>
          <p class="small muted" style="margin:8px 0 0">Click one to book it for a mentee.</p></div>
      </div></div></div>`;
  if (scroll != null) el.querySelector(".calscroll").scrollTop = scroll; else { const sc = el.querySelector(".calscroll"); if (sc) sc.scrollTop = 18 * 2; }
  wire();
}

function wire() {
  const el = document.getElementById("main"), d = C.data, cal = document.getElementById("cal");
  document.getElementById("cal-prev").onclick = () => { C.from = S.addDays(C.from, -7); load(); };
  document.getElementById("cal-next").onclick = () => { C.from = S.addDays(C.from, 7); load(); };
  document.getElementById("cal-now").onclick = () => { C.from = null; load(); };
  const ms = document.getElementById("cal-mentor"); if (ms) ms.onchange = () => { C.mentor = ms.value; C.from = null; load(); };
  document.getElementById("cal-book").onclick = () => bookDialog();
  el.querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => { C.kind = b.dataset.kind; draw(true); });
  el.querySelectorAll("[data-slot]").forEach((b) => b.onclick = () => bookDialog({ starts_at: b.dataset.slot, kind: C.kind === "opening" ? "opening" : "weekly" }));
  el.querySelectorAll("[data-b]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); callDialog(b.dataset.b); });
  el.querySelectorAll("[data-set]").forEach((x) => x.onchange = async () => {
    const key = x.dataset.set, val = key === "tz" ? x.value : +x.value;
    d.settings[key] = val; recompute(); draw(true); status("Saving…");
    try { await api("POST", { action: "save_settings", mentor: d.mentor, settings: { [key]: val } }); status("Saved ✓"); if (key === "tz") await load(true); }
    catch (e) { toast("Not saved: " + e.message); await load(true); }
  });
  el.querySelectorAll("[data-day]").forEach((h) => h.onclick = async () => {
    const date = h.dataset.day, o = d.timeOff.find((t) => date >= t.starts_on && date <= t.ends_on);
    let temp = null;
    if (o) d.timeOff = d.timeOff.filter((t) => t !== o); else { temp = { id: null, starts_on: date, ends_on: date }; d.timeOff.push(temp); }
    recompute(); draw(true); status("Saving…");
    try {
      if (o) await api("POST", { action: "remove_time_off", mentor: d.mentor, id: o.id });
      else { const r = await api("POST", { action: "add_time_off", mentor: d.mentor, starts_on: date, ends_on: date }); temp.id = r.id; }
      status(o ? "Day bookable again ✓" : "Day off saved ✓");
    } catch (e) { toast("Not saved: " + e.message); await load(true); }
  });
  // painting: drag fills the whole rectangle, saved when you let go
  const fill = (k) => { const [d0, s0] = C.anchor.split("-").map(Number), [d1, s1] = k.split("-").map(Number);
    for (let a = Math.min(d0, d1); a <= Math.max(d0, d1); a++) for (let b = Math.min(s0, s1); b <= Math.max(s0, s1); b++) { const kk = `${a}-${b}`; if (C.paint === "add") C.cells.add(kk); else C.cells.delete(kk); const c = cal.querySelector(`[data-k="${kk}"]`); if (c) c.classList.toggle("av", C.paint === "add"); } };
  cal.addEventListener("mousedown", (e) => { const c = e.target.closest(".c"); if (!c || e.target.closest(".ev")) return; C.anchor = c.dataset.k; C.paint = C.cells.has(C.anchor) ? "del" : "add"; fill(C.anchor); e.preventDefault(); });
  cal.addEventListener("mousemove", (e) => { if (!C.paint) return; const c = e.target.closest(".c"); if (c && c.dataset.k) fill(c.dataset.k); });
}
window.addEventListener("mouseup", () => {
  if (!C.paint) return; C.paint = null;
  recompute(); draw(true); saveAvail();
});

// ---------- dialogs ----------
function dialog(html) {
  const d = document.createElement("div"); d.className = "pal-bg"; d.style.alignItems = "flex-start";
  d.innerHTML = `<div class="pal" style="padding:18px;display:flex;flex-direction:column;gap:12px">${html}</div>`;
  d.onclick = (e) => { if (e.target === d) d.remove(); };
  document.body.append(d); return d;
}
function bookDialog(pre = {}) {
  const d = C.data, tz = d.settings.tz; let kind = pre.kind || "weekly";
  const dlg = dialog("");
  const drawD = () => {
    const slots = d.slots[kind] || [];
    dlg.firstChild.innerHTML = `<div class="row between"><b style="font-size:16px">Book a call</b><button class="btn ghost sm" data-x>✕</button></div>
      <label class="stack" style="gap:4px"><span class="small muted">Mentee</span><select class="in" id="bk-who">${d.mentees.map((m) => `<option value="${m.id}">${esc(m.name)}${m.brand ? " · " + m.brand.toUpperCase() : ""}</option>`).join("")}<option value="">Someone else (type a name)</option></select></label>
      <input class="in hidden" id="bk-name" placeholder="Name"><input class="in hidden" id="bk-email" placeholder="Email (optional)">
      <div class="seg"><button class="${kind === "weekly" ? "on" : ""}" data-k="weekly">Weekly · ${d.settings.weekly_minutes} min</button><button class="${kind === "opening" ? "on" : ""}" data-k="opening">Opening · ${d.settings.opening_minutes} min</button></div>
      <label class="stack" style="gap:4px"><span class="small muted">Time (${esc(tz)})</span><select class="in" id="bk-when">${slots.map((x) => `<option value="${x.starts_at}" ${x.starts_at === pre.starts_at ? "selected" : ""}>${whenLabel(x.starts_at, tz)}</option>`).join("")}<option value="custom">Another time…</option></select></label>
      <div class="row hidden" id="bk-custom"><input class="in" type="date" id="bk-date"><input class="in" type="time" id="bk-time" step="900"></div>
      <input class="in" id="bk-note" placeholder="Note (optional)">
      <div class="row" style="justify-content:flex-end"><button class="btn" data-x>Cancel</button><button class="btn pri" id="bk-go">Book it</button></div>`;
    dlg.querySelectorAll("[data-x]").forEach((b) => b.onclick = () => dlg.remove());
    dlg.querySelectorAll("[data-k]").forEach((b) => b.onclick = () => { kind = b.dataset.k; pre.starts_at = null; drawD(); });
    const who = dlg.querySelector("#bk-who"); const other = () => { const o = who.value === ""; dlg.querySelector("#bk-name").classList.toggle("hidden", !o); dlg.querySelector("#bk-email").classList.toggle("hidden", !o); }; who.onchange = other; other();
    const when = dlg.querySelector("#bk-when"); const cust = () => dlg.querySelector("#bk-custom").classList.toggle("hidden", when.value !== "custom"); when.onchange = cust; if (!slots.length) when.value = "custom"; cust();
    dlg.querySelector("#bk-go").onclick = async () => {
      let starts = when.value;
      if (starts === "custom") { const dt = dlg.querySelector("#bk-date").value, tm = dlg.querySelector("#bk-time").value; if (!dt || !tm) { toast("Pick a date and time"); return; } const [h, mi] = tm.split(":").map(Number); starts = new Date(S.zonedToUtc(dt, h * 60 + mi, tz)).toISOString(); }
      const body = { action: "book", mentor: d.mentor, kind, starts_at: starts, note: dlg.querySelector("#bk-note").value };
      if (who.value) body.mentorship_id = who.value; else { body.mentee_name = dlg.querySelector("#bk-name").value; body.mentee_email = dlg.querySelector("#bk-email").value; }
      try { await api("POST", body); dlg.remove(); toast("Booked"); const z = S.utcToZoned(Date.parse(starts), tz); C.from = S.mondayOf(z.date); await load(); } catch (e) { toast(e.message); }
    };
  };
  drawD();
}
function callDialog(id) {
  const d = C.data, tz = d.settings.tz;
  const b = d.bookings.find((x) => x.id === id) || d.upcoming.find((x) => x.id === id); if (!b) return;
  const dlg = dialog(`<div class="row between"><b style="font-size:16px">${esc(b.mentee_name)}</b><button class="btn ghost sm" data-x>✕</button></div>
    <div class="small muted">${b.kind === "opening" ? "Opening call" : "Weekly call"} · ${whenLabel(b.starts_at, tz)} (${esc(tz)}) · ${b.status}</div>${b.note ? `<div class="small">“${esc(b.note)}”</div>` : ""}
    <label class="row" style="gap:8px"><input type="checkbox" id="cl-rec" ${b.record ? "checked" : ""}> Record this call</label>
    <label class="row" style="gap:8px"><input type="checkbox" id="cl-tr" ${b.transcribe ? "checked" : ""}> Transcribe it too</label>
    <div class="row wrap"><button class="btn sm" id="cl-move">Move…</button><button class="btn sm" id="cl-done">Mark done</button><button class="btn sm" id="cl-miss">Missed</button><button class="btn sm" id="cl-cancel" style="color:var(--bad)">Cancel call</button></div>
    <div class="hidden stack" id="cl-movebox" style="gap:6px"><select class="in" id="cl-when">${(d.slots[b.kind] || []).map((x) => `<option value="${x.starts_at}">${whenLabel(x.starts_at, tz)}</option>`).join("")}</select><button class="btn pri sm" id="cl-movego">Move to this time</button></div>`);
  const up = async (patch, msg) => { try { await api("POST", { action: "update_booking", mentor: d.mentor, id: b.id, ...patch }); dlg.remove(); toast(msg); await load(true); } catch (e) { toast(e.message); } };
  dlg.querySelector("[data-x]").onclick = () => dlg.remove();
  dlg.querySelector("#cl-rec").onchange = (e) => api("POST", { action: "update_booking", mentor: d.mentor, id: b.id, record: e.target.checked }).then(() => toast("Saved"));
  dlg.querySelector("#cl-tr").onchange = (e) => api("POST", { action: "update_booking", mentor: d.mentor, id: b.id, transcribe: e.target.checked }).then(() => toast("Saved"));
  dlg.querySelector("#cl-done").onclick = () => up({ status: "done" }, "Marked done");
  dlg.querySelector("#cl-miss").onclick = () => up({ status: "missed" }, "Marked missed");
  dlg.querySelector("#cl-cancel").onclick = () => { const r = prompt("Reason for cancelling (optional)"); if (r === null) return; up({ status: "cancelled", cancel_reason: r }, "Call cancelled"); };
  dlg.querySelector("#cl-move").onclick = () => dlg.querySelector("#cl-movebox").classList.toggle("hidden");
  dlg.querySelector("#cl-movego").onclick = () => up({ starts_at: dlg.querySelector("#cl-when").value }, "Call moved");
}
