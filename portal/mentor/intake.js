// portal/mentor/intake.js
//
// New mentees, start to finish (Nathan, 22 Nov 2026), on EXAMPLE data so
// the flow can be tested before anything is real:
//   1. They pay (sign-up and payment go live last) → they land with admin.
//   2. Admin assigns a coach → welcome email to the mentee, heads-up to the coach.
//   3. The mentee books their 60-minute opening call from the coach's open times.
//   4. The coach sees it on Today, in their mentee list and the profile.
// Nothing here is saved or sent.

import * as S from "./slots.js";

// The example world is "Monday 23 Nov, 07:00 in Dublin".
const NOW = Date.parse("2026-11-23T07:00:00Z");
const WEEK0 = "2026-11-23";
// Example open times per coach (in Europe/Dublin), used only for the test flow.
const EX_AVAIL = {
  nathan:   [[0,420,540],[1,720,780],[2,1080,1200],[3,420,540],[4,720,840]],
  michaela: [[0,540,660],[1,1020,1140],[3,540,660],[4,1020,1140]],
  barney:   [[1,1080,1200],[3,1080,1200],[5,600,720]],
  dane:     [[0,720,840],[2,720,840],[4,600,720]],
  luis:     [[1,480,600],[2,1080,1200],[4,480,600]],
  marcus:   [[0,1080,1200],[2,600,720],[5,540,660]],
  mel:      [[1,420,540],[3,1080,1200],[4,420,540]],
};
const availFor = (k) => (EX_AVAIL[k] || []).map(([weekday, start_min, end_min]) => ({ weekday, start_min, end_min }));
const STAGES = [["paid","Paid · needs a coach"],["assigned","Coach assigned · waiting to book"],["booked","Opening call booked"],["done","Opening call done"]];
const first = (m) => m.name.split(" ")[0];
const dayIndex = (date) => Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(WEEK0 + "T00:00:00Z")) / 86400000);
const busyFor = (k) => BOOKINGS.filter((b) => b.mentor === k).map((b) => { const date = b.date || S.addDays(WEEK0, b.day); const a = S.zonedToUtc(date, b.start, "Europe/Dublin"); return { status: "booked", starts_at: new Date(a).toISOString(), ends_at: new Date(a + b.len * 60000).toISOString() }; });
const slotsFor = (k) => S.openSlots({ settings: { tz: "Europe/Dublin" }, availability: availFor(k), bookings: busyFor(k), kind: "opening", days: 14, now: NOW, step: 30 });
const zoneLabel = (iso, tz) => { const z = S.utcToZoned(Date.parse(iso), tz); const [y,mo,d] = z.date.split("-").map(Number); return { day: new Date(Date.UTC(y,mo-1,d)).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"}).replace(",",""), time: `${String(Math.floor(z.min/60)).padStart(2,"0")}:${String(z.min%60).padStart(2,"0")}`, date: z.date }; };

// ---------- 1. admin intake board ----------
function suggest(m) {
  return Object.entries(MENTORS).filter(([k,v]) => v.courses.includes(m.brand))
    .map(([k,v]) => ({ k, free: v.cap - MENTEES.filter((x) => x.mentor === k && x.stage !== "paid").length, slots: slotsFor(k).length }))
    .filter((x) => x.free > 0).sort((a,b) => b.free - a.free || b.slots - a.slots)[0];
}
ROUTES["a-allocate"] = (el) => {
  const pipe = MENTEES.filter((m) => m.stage);
  const card = (m) => { const s = suggest(m); const mentor = m.mentor ? MENTORS[m.mentor] : null; const b = BOOKINGS.find((x) => x.mentee === m.id && x.kind === "open");
    return `<div class="card pad stack" style="gap:8px">
      <div class="row between"><div class="row">${av(m,32)}<div><b>${esc(m.name)}</b> <span class="tag ${m.brand}">${m.brand.toUpperCase()}</span><div class="small muted">${esc(m.gym)} · paid ${esc(m.paidOn||"")} · €${m.amount||""}</div></div></div></div>
      ${m.stage === "paid" ? `
        <div>${m.level1 ? `<span class="chip good">✓ ${esc(m.level1)}</span>` : `<span class="chip warn">Level 1 to check</span> <span class="small muted">${esc(m.level1Note||"")}</span>`}</div>
        ${m.signup ? `<div class="small" style="background:var(--rule2);border-radius:6px;padding:8px 10px"><b>Why mentorship:</b> “${esc(m.signup.why)}”<br><b>Best times:</b> ${esc(m.signup.times)} · ${esc(m.tz||"")}<br><b>Experience:</b> ${esc(m.signup.experience)}</div>` : ""}
        <div class="row"><select class="in" id="al-${m.id}">${Object.entries(MENTORS).filter(([k,v]) => v.courses.includes(m.brand)).map(([k,v]) => { const f = v.cap - MENTEES.filter((x) => x.mentor === k && x.stage !== "paid").length; return `<option value="${k}" ${s && s.k === k ? "selected" : ""} ${f <= 0 ? "disabled" : ""}>${v.name} · ${f} free · ${slotsFor(k).length} open slots${s && s.k === k ? " (suggested)" : ""}</option>`; }).join("")}</select><button class="btn adm" data-assign="${m.id}">Assign ›</button></div>`
      : m.stage === "assigned" ? `<div class="small">With <b>${esc(mentor.name)}</b>. Welcome email sent; waiting for ${esc(first(m))} to book.</div>
        <div class="row wrap"><button class="btn sm" data-asmentee="${m.id}">Open as ${esc(first(m))} (book the call) ›</button><button class="btn sm ghost" data-nudge="${m.id}">Send a reminder</button></div>`
      : m.stage === "booked" ? `<div class="small">With <b>${esc(mentor.name)}</b>. Opening call <b>${b ? callLabel(b) : ""}</b> (60 min, recorded and transcribed).</div><button class="btn sm ghost" data-done="${m.id}">Mark opening call done</button>`
      : `<div class="small">With <b>${esc(mentor.name)}</b>. Opening call done. Next: development plan.</div><button class="btn sm" onclick="go('mentee/${m.id}/plan')">Open plan ›</button>`}
    </div>`; };
  el.innerHTML = `<div class="page">${adminHead("New mentees","Everyone who pays lands here. Assign a coach, then they book their opening call.",`<button class="btn" id="sim">＋ Simulate a paid sign-up</button>`)}
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr));align-items:start">${STAGES.map(([k,label]) => { const list = pipe.filter((m) => m.stage === k); return `<div class="stack" style="gap:10px"><h2 class="sec" style="margin:0">${label} <span class="chip ${k==="paid"&&list.length?"warn":""}">${list.length}</span></h2>${list.map(card).join("") || `<div class="card empty small">Nobody here</div>`}</div>`; }).join("")}</div>
    <p class="small muted" style="margin-top:18px">Test version: example people only. Nothing is saved or sent. Sign-up and payment go live last.</p></div>`;
  el.querySelectorAll("[data-assign]").forEach((b) => b.onclick = () => assignDialog(b.dataset.assign));
  el.querySelectorAll("[data-asmentee]").forEach((b) => b.onclick = () => go("join/" + b.dataset.asmentee));
  el.querySelectorAll("[data-nudge]").forEach((b) => b.onclick = () => toast("Reminder emailed (test): “Book your opening call”"));
  el.querySelectorAll("[data-done]").forEach((b) => b.onclick = () => { const m = menteeById(b.dataset.done); m.stage = "done"; m.events.push(["today","Opening call done","good"]); route(); toast("Marked done. Next: the development plan."); });
  document.getElementById("sim").onclick = simulate;
};

// ---------- 2. assign, with the two emails shown first ----------
function assignDialog(id) {
  const m = menteeById(id), k = document.getElementById("al-" + id).value, mentor = MENTORS[k];
  const link = `${location.origin}/learn/#mentorship`;
  const d = document.createElement("div"); d.className = "pal-bg"; d.style.alignItems = "flex-start";
  d.innerHTML = `<div class="pal" style="width:min(760px,94vw);padding:18px;display:flex;flex-direction:column;gap:12px;max-height:86vh;overflow-y:auto">
    <div class="row between"><b style="font-size:17px">Assign ${esc(m.name)} to ${esc(mentor.name)}</b><button class="btn ghost sm" data-x>✕</button></div>
    <p class="small muted" style="margin:0">These two emails go out when you press Assign.</p>
    <div class="grid g2" style="gap:12px">
      <div class="card"><div class="pad" style="padding:10px 14px;border-bottom:1px solid var(--rule)"><div class="small muted">To ${esc(m.email||"")}</div><b>Welcome to mentorship: meet ${esc(mentor.short)}</b></div>
        <div class="pad small" style="line-height:1.6">Hi ${esc(first(m))},<br><br>Welcome to ${m.brand.toUpperCase()} Mentorship Essentials. Your mentor is <b>${esc(mentor.name)}</b>.<br><br>Your first step is a 60-minute opening call, so ${esc(mentor.short)} can get to know you and where you want to go. We record it so you get a written development plan afterwards.<br><br><span style="display:inline-block;background:var(--accent);color:#fff;border-radius:6px;padding:8px 14px;font-weight:600">Book your opening call</span><br><br>Times show in your own time zone (${esc(m.tz||"")}).<br><br>BirdBox Coaching</div></div>
      <div class="card"><div class="pad" style="padding:10px 14px;border-bottom:1px solid var(--rule)"><div class="small muted">To ${esc(mentor.name)}</div><b>New mentee: ${esc(m.name)} (${m.brand.toUpperCase()})</b></div>
        <div class="pad small" style="line-height:1.6">Hi ${esc(mentor.short)},<br><br><b>${esc(m.name)}</b> from ${esc(m.gym)} is now with you.<br><br><b>Why mentorship:</b> “${esc(m.signup?.why||"")}”<br><b>Best times:</b> ${esc(m.signup?.times||"")} (${esc(m.tz||"")})<br><b>Level 1:</b> ${esc(m.level1||m.level1Note||"")}<br><br>They've been asked to book their opening call from your open times. You'll be told when they do.</div></div>
    </div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-x>Cancel</button><button class="btn adm" id="as-go">Assign and send</button></div></div>`;
  document.body.append(d);
  d.querySelectorAll("[data-x]").forEach((b) => b.onclick = () => d.remove());
  d.onclick = (e) => { if (e.target === d) d.remove(); };
  d.querySelector("#as-go").onclick = () => { m.mentor = k; m.stage = "assigned"; m.events.push(["today", `Assigned to ${mentor.name} · welcome email sent`, "acc"]); d.remove(); route(); toast(`${first(m)} is with ${mentor.short}. Both emailed (test). Next: ${first(m)} books the opening call.`); };
}

// ---------- 3. the mentee books the opening call (Learn, mentee's view) ----------
ROUTES.join = (el, id) => {
  const m = menteeById(id); if (!m || !m.mentor) { go("a-allocate"); return; }
  const mentor = MENTORS[m.mentor], tz = m.tz || "Europe/Dublin";
  const slots = slotsFor(m.mentor).map((s) => ({ ...s, z: zoneLabel(s.starts_at, tz) }));
  const days = [...new Set(slots.map((s) => s.z.date))];
  let pick = ROUTES.join.day && days.includes(ROUTES.join.day) ? ROUTES.join.day : days[0];
  const b = BOOKINGS.find((x) => x.mentee === m.id && x.kind === "open");
  const shell = (inner) => `<div style="background:#ffd84d;color:#16181b;font-size:12px;padding:6px 14px;display:flex;gap:10px;flex-wrap:wrap"><b>Mentee's view (test)</b> · what ${esc(first(m))} sees in BirdBox Learn after the welcome email <button style="margin-left:auto;font-size:12px" onclick="go('a-allocate')">‹ Back to New mentees</button></div>
    <div style="background:#141110;color:#ece8e4;min-height:calc(100% - 30px);padding:28px 20px 60px"><div style="max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:18px">${inner}</div></div>`;
  const mentorCard = `<div style="display:flex;gap:14px;align-items:center;background:#1d1918;border:1px solid #332d2b;border-radius:10px;padding:14px">${av({id:m.mentor,name:mentor.name},54)}<div><div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#9a928c">Your mentor</div><b style="font-size:18px">${esc(mentor.name)}</b><div style="color:#9a928c;font-size:13px">BirdBox ${m.brand.toUpperCase()} staff coach</div></div></div>`;
  if (b) {
    el.innerHTML = shell(`<div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9a928c">${m.brand.toUpperCase()} Mentorship Essentials</div><h1 style="margin:0;font-size:26px;text-transform:uppercase">You're booked in</h1>${mentorCard}
      <div style="background:#1b2433;border:1px solid #2f7fd0;border-radius:10px;padding:16px"><b style="font-size:17px">Opening call · ${callLabel(b)} (Dublin time)</b><div style="color:#cfe2f7;margin-top:6px">60 minutes on video, here in your Mentorship tab. We record it and send you a written development plan afterwards.</div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="lbtnx" onclick="toast('Adds the call to your calendar (test)')">＋ Add to my calendar</button><button class="lbtnx gh" onclick="toast('Shows other open times (test)')">Change time</button></div></div>
      <p style="color:#9a928c;font-size:13px">Before the call, have a think about: where you are as a coach now, what you'd like to be able to do in 6 months, and what gets in the way.</p>`);
    return;
  }
  el.innerHTML = shell(`<div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9a928c">${m.brand.toUpperCase()} Mentorship Essentials · step 1 of 1</div>
    <h1 style="margin:0;font-size:26px;text-transform:uppercase">Book your opening call</h1>
    <p style="margin:0;color:#d6d0ca">Welcome ${esc(first(m))}. Your first step is a 60-minute call with your mentor to understand where you are and where you want to go.</p>
    ${mentorCard}
    <div style="background:#1d1918;border:1px solid #332d2b;border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><b>Pick a day</b><span style="color:#9a928c;font-size:12px">Times in your time zone: ${esc(tz)}</span></div>
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px">${days.map((d) => { const s = slots.find((x) => x.z.date === d); return `<button data-day="${d}" style="flex:none;min-width:74px;padding:8px 6px;border-radius:8px;border:1px solid ${d===pick?"#2f7fd0":"#332d2b"};background:${d===pick?"#16202d":"#141110"};color:#ece8e4;font-size:13px;line-height:1.3"><b>${s.z.day.split(" ")[0]}</b><br>${s.z.day.split(" ").slice(1).join(" ")}</button>`; }).join("") || `<span style="color:#9a928c">No open times in the next two weeks. We'll let your mentor know.</span>`}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${slots.filter((s) => s.z.date === pick).map((s) => `<button data-slot="${s.starts_at}" style="padding:9px 14px;border-radius:6px;border:1px solid #332d2b;background:#141110;color:#ece8e4;font-size:14px">${s.z.time}</button>`).join("")}</div>
      <div id="confirm"></div>
    </div>`);
  el.querySelectorAll("[data-day]").forEach((x) => x.onclick = () => { ROUTES.join.day = x.dataset.day; route(); });
  el.querySelectorAll("[data-slot]").forEach((x) => x.onclick = () => {
    el.querySelectorAll("[data-slot]").forEach((y) => { y.style.borderColor = y === x ? "#2f7fd0" : "#332d2b"; y.style.background = y === x ? "#16202d" : "#141110"; });
    const z = zoneLabel(x.dataset.slot, tz);
    el.querySelector("#confirm").innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid #332d2b;padding-top:12px"><span><b>${z.day} at ${z.time}</b> <span style="color:#9a928c">· 60 min with ${esc(mentor.short)}</span></span><button id="bookit" style="background:#2f7fd0;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-weight:600">Book this time</button></div>`;
    el.querySelector("#bookit").onclick = () => {
      const dz = S.utcToZoned(Date.parse(x.dataset.slot), "Europe/Dublin"), di = dayIndex(dz.date);
      BOOKINGS.push({ mentor: m.mentor, mentee: m.id, day: di, date: di > 6 ? dz.date : undefined, start: dz.min, len: 60, kind: "open" });
      m.stage = "booked"; m.events.push(["today", `Booked opening call: ${z.day} ${z.time} (${tz})`, "good"]);
      toast(`Booked. ${first(m)} and ${mentor.short} both get a calendar invite (test).`); route();
    };
  });
};

// ---------- 4. the coach sees it on Today ----------
window.TODO_HOOKS = window.TODO_HOOKS || [];
window.TODO_HOOKS.push((todo, ms) => {
  ms.filter((m) => m.stage === "assigned").forEach((m) => todo.unshift({ ic: "★", bg: "#efeafc", fg: "#6a3fd6", t: `New mentee: ${first(m)}`, s: `Assigned to you · waiting for them to book the opening call`, go: `mentee/${m.id}`, m }));
  ms.filter((m) => m.stage === "booked").forEach((m) => { const b = BOOKINGS.find((x) => x.mentee === m.id && x.kind === "open"); todo.unshift({ ic: "★", bg: "var(--good-soft)", fg: "var(--good)", t: `Opening call with ${first(m)}`, s: `${b ? callLabel(b) : ""} · read their sign-up answers before the call`, go: `mentee/${m.id}`, m }); });
});

// ---------- testing: a new paid sign-up ----------
const FAKE = [
  ["Rachel Kim","tcc","Harbor CrossFit, Boston","America/New_York","I've just become head coach and want to lead my team better.","Weekday lunchtimes","4 years coaching, TCC L1"],
  ["Jonas Berg","tgc","Nordic Strength, Oslo","Europe/Oslo","Coaching handstands and muscle-ups to masters athletes.","Weekend mornings","6 years coaching, TGC L1"],
  ["Lena Fischer","tcc","Box Süd, Munich","Europe/Berlin","I want to give feedback that actually changes how people move.","Evenings","2 years coaching, TCC L1"],
  ["Daniel Okoro","tcc","Lagos Fit Lab, Lagos","Africa/Lagos","Building a coaching team for my new gym.","Early mornings","8 years coaching, TCC L1 + L2"],
];
let fakeN = 0;
function simulate() {
  const f = FAKE[fakeN++ % FAKE.length]; const id = "sim" + Date.now().toString(36);
  MENTEES.push({ id, name: f[0], brand: f[1], mentor: null, cycle: 1, week: 1, joined: "just now", pay: "paid", gym: f[2], tz: f[3],
    goal: "", plan: "", planSent: false, unread: 0, path: [], notes: "", events: [["just now", `Paid €${f[1]==="tcc"?280:240} · ${f[1].toUpperCase()} Essentials`, "good"]],
    level1: `${f[1].toUpperCase()} Level 1 · found`, stage: "paid", paidOn: "just now", amount: f[1]==="tcc"?280:240, email: f[0].toLowerCase().replace(/\W+/g,".")+"@example.com",
    signup: { why: f[4], times: f[5], experience: f[6] } });
  route(); toast(`${f[0]} has just paid (test). They're waiting for a coach.`);
}
