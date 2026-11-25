// portal/mentor/pay.js
//
// Mentor pay, monthly (Nathan, 25 Nov 2026). Example data for now.
// - Mentees pay €150 for the intro call, then every 4 weeks: €280 with a
//   staff mentor, €340 with Nathan (€85 a week).
// - Staff mentors get 70% of what's left after VAT and Stripe fees on the
//   4-weekly payments, and 50% on the intro call.
// - Nathan's mentees: no split at all. It is all mentorship profit (he is
//   paid through salary/drawings).
// - Staff are paid monthly, so pay is shown per calendar month.
// - A mentor (or manager) sees only their own pay. Only admins see everyone.

const PAY = {
  VAT: 0.23,                       // Irish VAT, to confirm with Kristine
  intro: 150, staff4wk: 280, nathan4wk: 340,
  shareCycle: 0.70, shareIntro: 0.50,
};
const NOMONTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const TODAY_ISO = "2026-11-23";

// What's left after VAT and Stripe (1.5% + €0.25 a card payment, plus 0.7% Stripe Billing on subscriptions).
function netOf(gross, sub) { return gross / (1 + PAY.VAT) - (gross * 0.015 + 0.25 + (sub ? gross * 0.007 : 0)); }
const r2 = (n) => Math.round(n * 100) / 100;
const eur = (n) => "€" + r2(n).toFixed(2);
function isoFromJoined(j) {
  if (!j || /today|now/.test(j)) return TODAY_ISO;
  if (/yesterday/.test(j)) return "2026-11-22";
  const [d, mon] = j.split(" "); const mi = NOMONTH.indexOf(mon);
  return `2026-${String(mi + 1).padStart(2, "0")}-${String(+d).padStart(2, "0")}`;
}
const addD = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// Every payment so far, worked out from when each mentee joined.
function payments() {
  const out = [];
  for (const m of MENTEES) {
    if (!m.mentor || m.stage === "paid") continue;
    const start = isoFromJoined(m.joined), own = m.mentor === "nathan";
    out.push({ date: start, mentee: m, mentor: m.mentor, what: "Intro call", gross: PAY.intro, sub: false, share: own ? 0 : PAY.shareIntro });
    if (m.stage === "assigned" || m.stage === "booked") continue; // offer not taken up yet
    for (let d = addD(start, 7); d <= TODAY_ISO; d = addD(d, 28)) {
      if (m.pay === "failed" && addD(d, 28) > TODAY_ISO) { out.push({ date: d, mentee: m, mentor: m.mentor, what: "4 weeks · failed, Stripe retrying", gross: 0, sub: true, share: 0, failed: true }); break; }
      out.push({ date: d, mentee: m, mentor: m.mentor, what: "4 weeks", gross: own ? PAY.nathan4wk : PAY.staff4wk, sub: true, share: own ? 0 : PAY.shareCycle });
    }
  }
  return out.map((p) => { const net = p.gross ? netOf(p.gross, p.sub) : 0; const pay = r2(net * p.share); return { ...p, net: r2(net), pay, profit: r2(net - pay) }; })
    .sort((a, b) => b.date.localeCompare(a.date));
}
const monthOf = (iso) => iso.slice(0, 7);
const monthLabel = (ym) => `${NOMONTH[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
let payMonth = monthOf(TODAY_ISO);
function monthPicker(all) {
  const months = [...new Set([monthOf(TODAY_ISO), ...all.map((p) => monthOf(p.date))])].sort().reverse().slice(0, 6);
  return `<div class="seg">${months.map((m) => `<button class="${m === payMonth ? "on" : ""}" onclick="payMonth='${m}';route()">${monthLabel(m)}</button>`).join("")}</div>`;
}
// the month buttons set it from inline handlers
Object.defineProperty(window, "payMonth", { get: () => payMonth, set: (v) => { payMonth = v; } });

// ---------- a mentor's own pay ----------
ROUTES["my-pay"] = (el) => {
  const all = payments().filter((p) => p.mentor === ME);
  const rows = all.filter((p) => monthOf(p.date) === payMonth);
  const own = ME === "nathan";
  const total = rows.reduce((n, p) => n + p.pay, 0);
  el.innerHTML = `<div class="page">
    <div class="ph"><div><h1>My pay</h1><p>${own ? "Your mentees' payments go straight into mentorship profit. You're paid through salary and drawings, so there's no mentor share here." : "Paid with your monthly staff pay. 70% of what's left after VAT and fees on each 4-weekly payment, and 50% on intro calls."}</p></div>${monthPicker(all)}</div>
    ${own ? "" : `<div class="grid g3" style="margin-bottom:16px"><div class="card tile"><b>${eur(total)}</b><span>Your pay for ${monthLabel(payMonth)}</span></div><div class="card tile"><b>${new Set(rows.map((p) => p.mentee.id)).size}</b><span>Mentees who paid this month</span></div><div class="card tile"><b>${eur(all.filter((p) => monthOf(p.date) < payMonth).reduce((n, p) => n + p.pay, 0))}</b><span>Earlier months</span></div></div>`}
    <div class="card">${rows.length ? `<table><thead><tr><th>Date</th><th>Mentee</th><th>Payment</th><th>Paid</th><th>After VAT + fees</th><th>${own ? "Mentorship profit" : "Your share"}</th></tr></thead><tbody>
      ${rows.map((p) => `<tr><td>${p.date.slice(8)} ${monthLabel(monthOf(p.date)).slice(0, 3)}</td><td><b>${esc(p.mentee.name)}</b></td><td class="small">${esc(p.what)}</td><td>${p.failed ? "—" : eur(p.gross)}</td><td>${p.failed ? "—" : eur(p.net)}</td><td><b>${p.failed ? "—" : own ? eur(p.profit) : eur(p.pay) + ` <span class="small muted">(${Math.round(p.share * 100)}%)</span>`}</b></td></tr>`).join("")}
      <tr><td colspan="5" style="text-align:right"><b>${own ? "Mentorship profit" : "Total for " + monthLabel(payMonth)}</b></td><td><b>${eur(own ? rows.reduce((n, p) => n + p.profit, 0) : total)}</b></td></tr></tbody></table>` : `<div class="empty">No payments in ${monthLabel(payMonth)}.</div>`}</div>
    <p class="small muted">Example data. VAT at 23% (to confirm with the accountant). Stripe fees: 1.5% + €0.25 per payment, plus 0.7% on subscriptions.</p></div>`;
};

// ---------- admin: everyone, monthly ----------
ROUTES["a-payouts"] = (el) => {
  const all = payments(); const rows = all.filter((p) => monthOf(p.date) === payMonth);
  const by = {}; rows.forEach((p) => { const b = by[p.mentor] = by[p.mentor] || { gross: 0, net: 0, pay: 0, profit: 0, n: new Set() }; b.gross += p.gross; b.net += p.net; b.pay += p.pay; b.profit += p.profit; b.n.add(p.mentee.name.split(" ")[0]); });
  const T = rows.reduce((t, p) => ({ gross: t.gross + p.gross, net: t.net + p.net, pay: t.pay + p.pay, profit: t.profit + p.profit }), { gross: 0, net: 0, pay: 0, profit: 0 });
  el.innerHTML = `<div class="page">${adminHead("Payouts", "Monthly, as staff are paid monthly. Your mentees go straight into mentorship profit.", `<div class="row">${monthPicker(all)}<button class="btn" onclick="toast('CSV downloaded (test)')">⤓ CSV</button></div>`)}
    <div class="grid g3" style="margin-bottom:16px"><div class="card tile"><b>${eur(T.gross)}</b><span>Paid by mentees in ${monthLabel(payMonth)}</span></div><div class="card tile"><b>${eur(T.pay)}</b><span>Mentor pay to send</span></div><div class="card tile"><b>${eur(T.profit)}</b><span>Mentorship profit</span></div></div>
    <div class="card"><table><thead><tr><th>Mentor</th><th>Mentees who paid</th><th>Paid</th><th>After VAT + fees</th><th>Mentor pay</th><th>Mentorship profit</th></tr></thead><tbody>
    ${Object.entries(by).map(([k, b]) => `<tr><td><b>${esc(MENTORS[k].name)}</b></td><td class="small">${[...b.n].join(", ")}</td><td>${eur(b.gross)}</td><td>${eur(b.net)}</td><td>${k === "nathan" ? '<span class="muted">none: all profit</span>' : `<b>${eur(b.pay)}</b>`}</td><td>${eur(b.profit)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No payments in ${monthLabel(payMonth)}.</td></tr>`}
    <tr><td colspan="2"><b>Total</b></td><td><b>${eur(T.gross)}</b></td><td><b>${eur(T.net)}</b></td><td><b>${eur(T.pay)}</b></td><td><b>${eur(T.profit)}</b></td></tr></tbody></table></div>
    <p class="small muted">Example data. Intro call €150 split 50/50; 4-weekly €280 (staff) split 70/30; €340 with Nathan, no split. VAT 23% to confirm with the accountant.</p></div>`;
};
