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
 * Nothing here reaches into portal/index.html beyond one script tag.
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
  `;
  document.head.append(style);

  const wrap = document.createElement("div");
  wrap.className = "overlay hidden";
  wrap.id = "oiwrap";
  wrap.innerHTML = `
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="oi-h">
    <h3 id="oi-h">Online course invoice</h3>
    <p>Stripe emails them the invoice. As soon as it is paid the course is added to their account on birdboxcoaching.com/learn, and they are emailed a link to open it. No code needed.</p>

    <div class="oi-grid">
      <div><label for="oi-first">First name</label><input id="oi-first" type="text" autocomplete="off"></div>
      <div><label for="oi-last">Last name</label><input id="oi-last" type="text" autocomplete="off"></div>
      <div class="wide"><label for="oi-email">Email <span class="hint">— this becomes their login</span></label>
        <input id="oi-email" type="email" autocomplete="off" inputmode="email"></div>
      <div><label for="oi-country">Country</label><select id="oi-country"></select></div>
      <div><label for="oi-course">Online course</label><select id="oi-course"></select></div>
      <div><label for="oi-price">Price <span class="hint">excl. VAT</span></label>
        <input id="oi-price" type="number" min="0" step="0.01" inputmode="decimal"></div>
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
  for (const id of ["oi-country", "oi-price", "oi-currency", "oi-vat"]) {
    $(id).addEventListener("input", showTotal);
    $(id).addEventListener("change", showTotal);
  }
  $("oi-currency").addEventListener("change", () => {
    try { localStorage.setItem("oi-currency", $("oi-currency").value); } catch (e) {}
  });
  $("oi-price").addEventListener("change", () => {
    try { localStorage.setItem("oi-price", $("oi-price").value); } catch (e) {}
  });
}

async function openDialog() {
  buildDialog();
  $("oiwrap").classList.remove("hidden");
  msg("");

  try {
    if (localStorage.getItem("oi-currency")) $("oi-currency").value = localStorage.getItem("oi-currency");
    if (!$("oi-price").value && localStorage.getItem("oi-price")) $("oi-price").value = localStorage.getItem("oi-price");
  } catch (e) {}

  if (!opts) {
    try {
      opts = await call({ action: "options" });
      fillSelects();
    } catch (err) {
      msg("Could not load the courses: " + err.message, true);
    }
  }
  showTotal();
  loadList();
}

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
  if (!(price > 0)) { $("oi-total").textContent = ""; return; }

  const rate = choice === "AUTO" ? vatRateFor(country) : 0;
  const vat = Math.round(price * rate) / 100;
  const total = price + vat;
  const f = (n) => cur + " " + n.toFixed(2);

  $("oi-total").textContent =
    choice === "REVERSE" ? `They will be invoiced ${f(price)}, reverse charge (no VAT).`
    : rate > 0 ? `They will be invoiced ${f(total)} — ${f(price)} + ${rate}% VAT (${f(vat)}).`
    : choice === "AUTO" && !country ? `${f(price)} plus any VAT — choose their country.`
    : `They will be invoiced ${f(price)}, no VAT.`;
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
  };
  if (!body.first_name || !body.last_name) return msg("First and last name are both needed.", true);
  if (!body.email.includes("@")) return msg("A valid email is needed.", true);
  if (!body.country) return msg("Choose their country.", true);
  if (!body.product_id) return msg("Choose the online course.", true);
  if (!(parseFloat(body.price) > 0)) return msg("Enter the price.", true);

  const courseLabel = $("oi-course").selectedOptions[0].textContent;
  if (!window.confirm(`Send an invoice to ${body.first_name} ${body.last_name} (${body.email}) for ${courseLabel}?\n\n${$("oi-total").textContent}`)) return;

  $("oi-send").disabled = true;
  msg("Sending…");
  try {
    const r = await call(body);
    msg(`Sent — invoice ${r.number || ""} for ${r.currency} ${(r.total_cents / 100).toFixed(2)}. ` +
        "They will be enrolled automatically when it is paid.");
    for (const id of ["oi-first", "oi-last", "oi-email", "oi-vatno", "oi-business"]) $(id).value = "";
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
  what.textContent = [inv.product_label, money, inv.stripe_invoice_number, "sent " + when]
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
