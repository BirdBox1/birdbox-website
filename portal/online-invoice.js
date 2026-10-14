/* portal/online-invoice.js
 *
 * "Online course invoice" button, next to New course (admin only).
 *
 * For someone who could not pay on the LearnWorlds page. Fill in who
 * they are, which online course and the price; Stripe emails them the
 * invoice. When it is paid, netlify/functions/online-invoice.mjs
 * (called by the Stripe webhook) creates their academy account, adds
 * the course to it, and emails them how to log in. No coupon code.
 *
 * Underneath the form is the list of recent online invoices, so you
 * can see who has paid, who is enrolled, and act on the rest:
 * Resend, Mark paid (bank transfer), Retry enrolment, Void.
 *
 * The course dropdown is read live from LearnWorlds each time the
 * portal loads, so new courses and languages appear by themselves.
 *
 * From a participant's card, "Online course 50%" calls
 * window.openOnlineInvoiceFor(registrationId): the same form, filled
 * in from their registration — made out to whoever their seminar was
 * invoiced to, the matching online course at full price, 50% off —
 * and the invoice is linked back to the registration.
 *
 * Nothing here reaches into portal/index.html beyond one script tag
 * and that one function.
 * The button copies the Invoices button's visibility, which the portal
 * already shows to admins only.
 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://yvdmazpxtpuvidlcifnq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ";
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);

// Countries offered for the customer. Anything in vat_rates is added
// automatically; these are the others you sell to most.
const EXTRA_COUNTRIES = {
  US: "United States", CA: "Canada", AU: "Australia", NZ: "New Zealand",
  ZA: "South Africa", JP: "Japan", CH: "Switzerland", NO: "Norway",
  AE: "United Arab Emirates", SA: "Saudi Arabia", SG: "Singapore",
  HK: "Hong Kong", MX: "Mexico", BR: "Brazil", AR: "Argentina",
  CL: "Chile", CO: "Colombia", IS: "Iceland", IL: "Israel", IN: "India",
  KR: "South Korea", TH: "Thailand", PH: "Philippines", QA: "Qatar",
  KW: "Kuwait", BH: "Bahrain", OM: "Oman", TR: "Turkey", EG: "Egypt",
  KE: "Kenya", NG: "Nigeria", GB: "United Kingdom",
};

let opts = null;
let regId = null;   // set when opened from a participant's card
let regPrices = {}; // that course's online prices, by currency

/* ---------------- calling the function ---------------- */

async function call(body) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) throw new Error("Your session has expired — sign in again.");
  const res = await fetch("/.netlify/functions/online-invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* not json */ }
  if (!res.ok || data.error) throw new Error(data.error || "That did not work.");
  return data;
}

/* ---------------- the button ---------------- */

function addButton() {
  const newBtn = $("newcourse");
  const invBtn = $("invoicesbtn");
  if (!newBtn || !invBtn || $("oibtn")) return false;

  const b = document.createElement("button");
  b.id = "oibtn";
  b.type = "button";
  b.className = "btn ghost hidden";
  b.textContent = "Online course invoice";
  b.onclick = openDialog;
  newBtn.insertAdjacentElement("beforebegin", b);

  const sync = () => b.classList.toggle("hidden", invBtn.classList.contains("hidden"));
  new MutationObserver(sync).observe(invBtn, { attributes: true, attributeFilter: ["class"] });
  sync();
  return true;
}

/* ---------------- the dialog ---------------- */

function buildDialog() {
  if ($("oiwrap")) return;

  const style = document.createElement("style");
  style.textContent = `
    #oiwrap .dialog { max-width: 44rem; }
    #oiwrap .dialog input, #oiwrap .dialog select {
      letter-spacing: normal; font-weight: 400; text-transform: none;
      width: 100%; box-sizing: border-box;
    }
    #oiwrap .oi-grid { display: grid; gap: .8rem; grid-template-columns: 1fr; margin-bottom: .8rem; }
    @media (min-width: 34rem) { #oiwrap .oi-grid { grid-template-columns: 1fr 1fr; } }
    #oiwrap .oi-grid .wide { grid-column: 1 / -1; }
    #oiwrap label { display: block; font-size: .82rem; font-weight: 600; margin-bottom: .25rem; }
    #oiwrap .hint { font-weight: 400; opacity: .7; }
    #oiwrap .oi-total { font-size: .9rem; margin: .2rem 0 .6rem; }
    #oiwrap h4 { margin: 1.6rem 0 .5rem; font-size: .95rem; }
    #oiwrap .oi-list { border-top: 1px solid var(--rule); }
    #oiwrap .oi-row { padding: .7rem 0; border-bottom: 1px solid var(--rule); font-size: .86rem; }
    #oiwrap .oi-row .who { font-weight: 600; }
    #oiwrap .oi-row .what { opacity: .8; margin: .15rem 0 .35rem; }
    #oiwrap .oi-row .acts { display: flex; gap: .4rem; flex-wrap: wrap; align-items: center; }
    #oiwrap .oi-row .err { color: var(--bad); font-size: .8rem; margin-top: .3rem; }
    #oiwrap .oi-from { border-left: 3px solid var(--rule); padding: .4rem .7rem; font-size: .88rem; margin-bottom: .8rem; }
    #oiwrap .oi-from .warn { color: var(--bad); margin-top: .3rem; }
  `;
  document.head.append(style);

  const wrap = document.createElement("div");
  wrap.className = "overlay hidden";
  wrap.id = "oiwrap";
  wrap.innerHTML = `
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="oi-h">
    <h3 id="oi-h">Online course invoice</h3>
    <p>Stripe emails them the invoice. As soon as it is paid the course is added to their account on birdboxcoaching.com/learn, and they are emailed a link to open it. No code needed.</p>

    <div class="oi-from hidden" id="oi-from"></div>

    <div class="oi-grid">
      <div><label for="oi-first">First name</label><input id="oi-first" type="text" autocomplete="off"></div>
      <div><label for="oi-last">Last name</label><input id="oi-last" type="text" autocomplete="off"></div>
      <div class="wide"><label for="oi-email">Email <span class="hint">— this becomes their login</span></label>
        <input id="oi-email" type="email" autocomplete="off" inputmode="email"></div>
      <div><label for="oi-country">Country</label><select id="oi-country"></select></div>
      <div><label for="oi-course">Online course</label><select id="oi-course"></select></div>
      <div><label for="oi-price">Price <span class="hint">excl. VAT</span></label>
        <input id="oi-price" type="number" min="0" step="0.01" inputmode="decimal"></div>
      <div><label for="oi-disc">Discount % <span class="hint">— 50 for a seminar attendee</span></label>
        <input id="oi-disc" type="number" min="0" max="99" step="1" inputmode="numeric" placeholder="0"></div>
      <div><label for="oi-currency">Currency</label>
        <select id="oi-currency">
          <option>EUR</option><option>GBP</option><option>USD</option><option>AUD</option><option>CAD</option>
        </select></div>
      <div><label for="oi-vat">VAT</label>
        <select id="oi-vat">
          <option value="AUTO">Customer's country rate</option>
          <option value="NONE">No VAT</option>
          <option value="REVERSE">Reverse charge (EU business)</option>
        </select></div>
      <div><label for="oi-vatno">VAT number <span class="hint">— businesses only</span></label>
        <input id="oi-vatno" type="text" autocomplete="off"></div>
      <div class="wide"><label for="oi-business">Business name <span class="hint">— optional, goes on the invoice</span></label>
        <input id="oi-business" type="text" autocomplete="off"></div>
      <div class="wide"><label for="oi-billname">Invoice made out to <span class="hint">— blank = their own name</span></label>
        <input id="oi-billname" type="text" autocomplete="off"></div>
      <div class="wide"><label for="oi-a1">Address <span class="hint">— optional</span></label>
        <input id="oi-a1" type="text" autocomplete="off"></div>
      <div class="wide"><input id="oi-a2" type="text" autocomplete="off" aria-label="Address line 2"></div>
      <div><label for="oi-city">City</label><input id="oi-city" type="text" autocomplete="off"></div>
      <div><label for="oi-post">Postcode</label><input id="oi-post" type="text" autocomplete="off"></div>
    </div>
    <p class="oi-total" id="oi-total"></p>
    <p class="msg" id="oi-msg"></p>

    <h4>Recent online course invoices</h4>
    <div class="oi-list" id="oi-list"><p class="whenline">Loading…</p></div>

    <div class="row">
      <button class="btn ghost" id="oi-close" type="button">Close</button>
      <button class="btn go" id="oi-send" type="button">Send invoice</button>
    </div>
  </div>`;
  document.body.append(wrap);

  $("oi-close").onclick = () => wrap.classList.add("hidden");
  wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.classList.add("hidden"); });
  $("oi-send").onclick = send;
  for (const id of ["oi-country", "oi-price", "oi-currency", "oi-vat", "oi-disc"]) {
    $(id).addEventListener("input", showTotal);
    $(id).addEventListener("change", showTotal);
  }
  $("oi-currency").addEventListener("change", () => {
    // From a card, the price follows the currency.
    const c = $("oi-currency").value;
    if (regId && regPrices[c]) { $("oi-price").value = (regPrices[c] / 100).toFixed(2); showTotal(); return; }
    if (regId) return;
    try { localStorage.setItem("oi-currency", c); } catch (e) {}
  });
  $("oi-price").addEventListener("change", () => {
    if (regId) return;
    try { localStorage.setItem("oi-price", $("oi-price").value); } catch (e) {}
  });
}

const PERSON_FIELDS = ["oi-first", "oi-last", "oi-email", "oi-vatno", "oi-business",
  "oi-billname", "oi-a1", "oi-a2", "oi-city", "oi-post", "oi-disc"];

async function openDialog() {
  buildDialog();
  $("oiwrap").classList.remove("hidden");
  msg("");

  // Opened from the top button after a card: start clean, so nothing
  // of that person is sent by accident.
  if (regId) {
    regId = null;
    regPrices = {};
    for (const id of PERSON_FIELDS) $(id).value = "";
    $("oi-country").value = "";
    $("oi-course").value = "";
    $("oi-price").value = "";
    $("oi-from").classList.add("hidden");
  }

  try {
    if (localStorage.getItem("oi-currency")) $("oi-currency").value = localStorage.getItem("oi-currency");
    if (!$("oi-price").value && localStorage.getItem("oi-price")) $("oi-price").value = localStorage.getItem("oi-price");
  } catch (e) {}

  await ensureOptions();
  showTotal();
  loadList();
}

async function ensureOptions() {
  if (opts) return true;
  try {
    opts = await call({ action: "options" });
    fillSelects();
    return true;
  } catch (err) {
    msg("Could not load the courses: " + err.message, true);
    return false;
  }
}

// From a participant's card.
async function openFor(registrationId) {
  buildDialog();
  $("oiwrap").classList.remove("hidden");
  msg("Filling in from their registration…");
  regId = registrationId;
  for (const id of PERSON_FIELDS) $(id).value = "";
  $("oi-from").classList.add("hidden");
  loadList();

  if (!(await ensureOptions())) return;

  let p;
  try {
    p = await call({ action: "prefill", registration_id: registrationId });
  } catch (err) {
    msg(err.message, true);
    return;
  }
  regPrices = p.prices || {};

  $("oi-first").value = p.first_name;
  $("oi-last").value = p.last_name;
  $("oi-email").value = p.email;
  const bill = p.bill || {};
  const person = `${p.first_name} ${p.last_name}`.trim();
  $("oi-billname").value = bill.name && bill.name.toLowerCase() !== person.toLowerCase() ? bill.name : "";
  $("oi-business").value = bill.business || "";
  $("oi-a1").value = bill.line1 || "";
  $("oi-a2").value = bill.line2 || "";
  $("oi-city").value = bill.city || "";
  $("oi-post").value = bill.postcode || "";
  $("oi-vatno").value = bill.vat_number || "";
  $("oi-vat").value = "AUTO";

  const country = $("oi-country");
  if (bill.country && !country.querySelector(`option[value="${bill.country}"]`)) {
    const o = document.createElement("option");
    o.value = o.textContent = bill.country;
    country.append(o);
  }
  country.value = bill.country || "";
  $("oi-course").value = p.product_id || "";
  if (![...$("oi-currency").options].some((o) => o.value === p.currency)) {
    $("oi-currency").append(new Option(p.currency, p.currency));
  }
  $("oi-currency").value = p.currency;
  $("oi-price").value = p.price != null ? p.price.toFixed(2) : "";
  $("oi-disc").value = p.discount_percent;

  const from = $("oi-from");
  from.innerHTML = "";
  const line = document.createElement("div");
  line.textContent = `From ${person}'s registration on ${p.seminar}. ` +
    (bill.from ? `Billing details copied from ${bill.from} — check them before sending.` : "No earlier invoice, so it is made out to them.");
  from.append(line);
  const vatLine = document.createElement("div");
  vatLine.className = bill.country ? "" : "warn";
  vatLine.textContent = bill.country
    ? `VAT is charged for ${$("oi-country").selectedOptions[0]?.textContent || bill.country}, the country on their billing address. Change it if they live somewhere else.`
    : "Ask which country they live in — VAT is charged at that country's rate, not the seminar's.";
  from.append(vatLine);
  if (!p.product_id) {
    const w = document.createElement("div");
    w.className = "warn";
    w.textContent = "No matching online course found — choose one.";
    from.append(w);
  }
  if (p.price == null) {
    const w = document.createElement("div");
    w.className = "warn";
    w.textContent = "This seminar has no online course price — enter the full price.";
    from.append(w);
  }
  for (const e of p.earlier || []) {
    const w = document.createElement("div");
    w.className = "warn";
    const when = new Date(e.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    w.textContent = `Already invoiced ${when}: ${e.product_label} · ${e.currency} ${((e.total_cents || 0) / 100).toFixed(2)} · ${e.status === "paid" ? "PAID" : "awaiting payment"}${e.stripe_invoice_number ? " · " + e.stripe_invoice_number : ""}`;
    from.append(w);
  }
  from.classList.remove("hidden");
  msg("");
  showTotal();
}

window.openOnlineInvoiceFor = openFor;

function fillSelects() {
  const course = $("oi-course");
  course.innerHTML = '<option value="">Choose…</option>';
  for (const c of opts.courses) {
    const o = document.createElement("option");
    o.value = c.product_id;
    // Our own course list (learn_courses).
    const note = c.access && !["paid", "free"].includes(c.access) ? ` (${c.access.replace(/_/g, " ")})` : "";
    o.textContent = c.label + note;
    course.append(o);
  }

  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const nameOf = (code) => {
    if (EXTRA_COUNTRIES[code]) return EXTRA_COUNTRIES[code];
    try { return names.of(code === "EL" ? "GR" : code) || code; } catch (e) { return code; }
  };
  const codes = new Set(Object.keys(EXTRA_COUNTRIES));
  for (const v of opts.vat) codes.add(v.code);
  const list = [...codes].map((c) => ({ code: c, name: nameOf(c) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const country = $("oi-country");
  country.innerHTML = '<option value="">Choose…</option>';
  for (const c of list) {
    const o = document.createElement("option");
    o.value = c.code;
    o.textContent = c.name;
    country.append(o);
  }
}

function vatRateFor(code) {
  if (!opts) return 0;
  const hit = opts.vat.find((v) => v.code === code);
  return hit ? hit.rate : 0;
}

function showTotal() {
  const price = parseFloat($("oi-price").value);
  const cur = $("oi-currency").value;
  const country = $("oi-country").value;
  const choice = $("oi-vat").value;
  const disc = parseFloat($("oi-disc").value) || 0;
  if (!(price > 0)) { $("oi-total").textContent = ""; return; }

  const f = (n) => cur + " " + n.toFixed(2);
  const net = Math.round(price * (100 - disc)) / 100;
  const off = disc > 0 ? ` (${f(price)} less ${disc}%)` : "";
  const rate = choice === "AUTO" ? vatRateFor(country) : 0;
  const vat = Math.round(net * rate) / 100;
  const total = net + vat;

  $("oi-total").textContent =
    choice === "REVERSE" ? `They will be invoiced ${f(net)}${off}, reverse charge (no VAT).`
    : rate > 0 ? `They will be invoiced ${f(total)} — ${f(net)}${off} + ${rate}% VAT (${f(vat)}).`
    : choice === "AUTO" && !country ? `${f(net)}${off} plus any VAT — choose their country.`
    : `They will be invoiced ${f(net)}${off}, no VAT.`;
}

function msg(text, bad) {
  const m = $("oi-msg");
  m.className = "msg" + (text ? (bad ? " err" : " ok") : "");
  m.textContent = text;
}

async function send() {
  const body = {
    action: "create_and_send",
    first_name: $("oi-first").value.trim(),
    last_name: $("oi-last").value.trim(),
    email: $("oi-email").value.trim(),
    country: $("oi-country").value,
    product_id: $("oi-course").value,
    price: $("oi-price").value,
    currency: $("oi-currency").value,
    vat: $("oi-vat").value,
    vat_number: $("oi-vatno").value.trim(),
    business_name: $("oi-business").value.trim(),
    bill_name: $("oi-billname").value.trim(),
    address_line1: $("oi-a1").value.trim(),
    address_line2: $("oi-a2").value.trim(),
    city: $("oi-city").value.trim(),
    postcode: $("oi-post").value.trim(),
    discount_percent: $("oi-disc").value || 0,
    registration_id: regId,
  };
  if (!body.first_name || !body.last_name) return msg("First and last name are both needed.", true);
  if (!body.email.includes("@")) return msg("A valid email is needed.", true);
  if (!body.country) return msg("Choose their country.", true);
  if (!body.product_id) return msg("Choose the online course.", true);
  if (!(parseFloat(body.price) > 0)) return msg("Enter the price.", true);
  const d = parseFloat(body.discount_percent) || 0;
  if (d < 0 || d >= 100) return msg("The discount must be between 0 and 99%.", true);

  const courseLabel = $("oi-course").selectedOptions[0].textContent;
  const madeOut = body.business_name || body.bill_name;
  if (!window.confirm(`Send an invoice to ${body.first_name} ${body.last_name} (${body.email}) for ${courseLabel}?` +
      (madeOut ? `\n\nMade out to: ${madeOut}` : "") +
      `\n\n${$("oi-total").textContent}`)) return;

  $("oi-send").disabled = true;
  msg("Sending…");
  try {
    const r = await call(body);
    msg(`Sent — invoice ${r.number || ""} for ${r.currency} ${(r.total_cents / 100).toFixed(2)}. ` +
        "They will be enrolled automatically when it is paid.");
    for (const id of PERSON_FIELDS) $(id).value = "";
    $("oi-from").classList.add("hidden");
    regId = null;
    regPrices = {};
    loadList();
  } catch (err) {
    msg(err.message, true);
  }
  $("oi-send").disabled = false;
}

/* ---------------- the list ---------------- */

async function loadList() {
  const box = $("oi-list");
  try {
    const { invoices } = await call({ action: "list" });
    box.innerHTML = "";
    if (!invoices.length) {
      box.innerHTML = '<p class="whenline">None yet.</p>';
      return;
    }
    for (const inv of invoices) box.append(rowFor(inv));
  } catch (err) {
    box.innerHTML = "";
    const p = document.createElement("p");
    p.className = "msg err";
    p.textContent = "Could not load the list: " + err.message;
    box.append(p);
  }
}

function pill(text, kind) {
  const s = document.createElement("span");
  s.className = "pill " + (kind || "");
  s.textContent = text;
  return s;
}

function act(label, cls, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn tiny " + cls;
  b.textContent = label;
  b.onclick = async () => {
    b.disabled = true;
    try { await fn(); } catch (err) { window.alert(err.message); }
    b.disabled = false;
    loadList();
  };
  return b;
}

function rowFor(inv) {
  const row = document.createElement("div");
  row.className = "oi-row";

  const who = document.createElement("div");
  who.className = "who";
  who.textContent = `${inv.first_name} ${inv.last_name} · ${inv.email}`;

  const what = document.createElement("div");
  what.className = "what";
  const money = inv.total_cents == null ? "" : `${inv.currency} ${(inv.total_cents / 100).toFixed(2)}`;
  const when = new Date(inv.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const disc = Number(inv.discount_percent) > 0 ? `${Number(inv.discount_percent)}% off` : "";
  what.textContent = [inv.product_label, money, disc, inv.stripe_invoice_number, "sent " + when]
    .filter(Boolean).join(" · ");

  const acts = document.createElement("div");
  acts.className = "acts";

  if (inv.status === "sent") {
    const overdue = inv.due_date && inv.due_date < new Date().toISOString().slice(0, 10);
    acts.append(pill(overdue ? "overdue" : "awaiting payment", overdue ? "bad" : "warn"));
    if (inv.hosted_invoice_url) {
      acts.append(act("Copy pay link", "ghost", async () => {
        await navigator.clipboard.writeText(inv.hosted_invoice_url);
        window.alert("Pay link copied.");
      }));
    }
    acts.append(act("Resend", "ghost", async () => {
      await call({ action: "resend", id: inv.id });
      window.alert("Invoice emailed again.");
    }));
    acts.append(act("Mark paid (bank transfer)", "ghost", async () => {
      if (!window.confirm(`Mark this invoice paid outside Stripe?\n\n${inv.first_name} will be enrolled and emailed straight away.`)) return;
      await call({ action: "mark_paid", id: inv.id });
      window.alert("Marked paid. The enrolment runs in the next few seconds — reopen this list to see it.");
    }));
    acts.append(act("Void", "ghost danger", async () => {
      if (!window.confirm("Void this invoice? It cannot then be paid.")) return;
      await call({ action: "void", id: inv.id });
    }));
  } else if (inv.status === "paid") {
    acts.append(pill("paid", "on"));
    if (inv.learnworlds_status === "enrolled") {
      acts.append(pill(inv.user_was_created ? "enrolled · new account" : "enrolled · existing account", "on"));
    } else if (inv.learnworlds_status === "failed") {
      acts.append(pill("enrolment failed", "bad"));
      acts.append(act("Retry enrolment", "go", async () => {
        await call({ action: "retry", id: inv.id });
        window.alert("Enrolled.");
      }));
    } else {
      acts.append(pill("enrolling…", "warn"));
    }
  } else if (inv.status === "void") {
    acts.append(pill("void", ""));
  } else {
    acts.append(pill(inv.status, ""));
  }

  row.append(who, what, acts);

  if (inv.learnworlds_status === "failed" && inv.learnworlds_error) {
    const e = document.createElement("div");
    e.className = "err";
    e.textContent = inv.learnworlds_error;
    row.append(e);
  }
  return row;
}

/* ---------------- start ---------------- */

function boot() {
  if (addButton()) return;
  // The top bar may not be drawn yet.
  let tries = 0;
  const t = setInterval(() => {
    if (addButton() || ++tries > 40) clearInterval(t);
  }, 250);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
