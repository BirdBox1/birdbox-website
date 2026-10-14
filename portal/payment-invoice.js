/* portal/payment-invoice.js
 *
 * "Invoice" on a participant's card and in Find someone: an invoice
 * for a seminar they have already paid for by card, for someone who
 * only has the Stripe receipt (netlify/functions/payment-invoice.mjs).
 *
 * The window lists what they paid. A payment that already has a Stripe
 * invoice gets "Email this invoice". One without gets the name,
 * business, VAT number and address to put on it, then "Make invoice
 * and email it" — paid by the card payment they already made, so the
 * money is never counted twice.
 *
 * Exposes window.openPaymentInvoice(registrationId).
 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const db = createClient(
  "https://yvdmazpxtpuvidlcifnq.supabase.co",
  "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ"
);
const $ = (id) => document.getElementById(id);
let regId = null;

async function call(body) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) throw new Error("Your session has expired — sign in again.");
  const res = await fetch("/.netlify/functions/payment-invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* not json */ }
  if (!res.ok || data.error) throw new Error(data.error || "That did not work.");
  return data;
}

function build() {
  if ($("piwrap")) return;
  const style = document.createElement("style");
  style.textContent = `
    #piwrap .dialog { max-width: 40rem; }
    #piwrap input, #piwrap select { letter-spacing: normal; font-weight: 400; text-transform: none; width: 100%; box-sizing: border-box; }
    #piwrap .pi-grid { display: grid; gap: .7rem; grid-template-columns: 1fr; margin: .6rem 0 .8rem; }
    @media (min-width: 34rem) { #piwrap .pi-grid { grid-template-columns: 1fr 1fr; } }
    #piwrap .pi-grid .wide { grid-column: 1 / -1; }
    #piwrap label { display: block; font-size: .82rem; font-weight: 600; margin-bottom: .25rem; }
    #piwrap .hint { font-weight: 400; opacity: .7; }
    #piwrap .pi-pay { border-top: 1px solid var(--rule); padding: .8rem 0; }
    #piwrap .pi-pay .what { font-weight: 600; }
    #piwrap .pi-pay .sub { opacity: .8; font-size: .88rem; margin: .15rem 0 .5rem; }
    #piwrap .warn { color: var(--bad); font-size: .88rem; }
  `;
  document.head.append(style);
  const wrap = document.createElement("div");
  wrap.className = "overlay hidden";
  wrap.id = "piwrap";
  wrap.innerHTML = `
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="pi-h">
    <h3 id="pi-h">Invoice for their payment</h3>
    <p id="pi-who" class="whenline"></p>
    <div id="pi-body"><p class="whenline">Loading…</p></div>
    <p class="msg" id="pi-msg"></p>
    <div class="row"><button class="btn ghost" id="pi-close" type="button">Close</button></div>
  </div>`;
  document.body.append(wrap);
  $("pi-close").onclick = () => wrap.classList.add("hidden");
  wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.classList.add("hidden"); });
}

function msg(text, bad) {
  const m = $("pi-msg");
  m.className = "msg" + (text ? (bad ? " err" : " ok") : "");
  m.textContent = text;
}

const money = (cents, cur) => `${cur} ${((cents || 0) / 100).toFixed(2)}`;
const day = (unix) => unix ? new Date(unix * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

async function open(registrationId) {
  build();
  regId = registrationId;
  $("piwrap").classList.remove("hidden");
  $("pi-who").textContent = "";
  $("pi-body").innerHTML = '<p class="whenline">Looking up their payment in Stripe…</p>';
  msg("");
  let d;
  try {
    d = await call({ action: "lookup", registration_id: registrationId });
  } catch (err) {
    $("pi-body").innerHTML = "";
    msg(err.message, true);
    return;
  }
  render(d);
}

function render(d) {
  $("pi-who").textContent = `${d.person} · ${d.email} · ${d.course}`;
  const body = $("pi-body");
  body.innerHTML = "";

  if (d.none) { body.append(el("p", "", d.none)); return; }
  if (d.group) {
    body.append(el("p", "", `Their place was paid on a group invoice${d.group.to ? " to " + d.group.to : ""}` +
      `${d.group.number ? " (" + d.group.number + ")" : ""}. That is the invoice for it — nothing new is needed.`));
    if (d.group.url) {
      const a = el("a", "btn ghost small", "Open that invoice");
      a.href = d.group.url; a.target = "_blank"; a.rel = "noopener";
      body.append(a);
    }
    return;
  }

  for (const it of d.items) {
    const row = el("div", "pi-pay");
    row.append(el("div", "what", `${it.label} — ${money(it.amount, it.currency)}`));
    row.append(el("div", "sub", "Paid " + day(it.date)));

    if (it.invoice) {
      row.querySelector(".sub").textContent += ` · invoice ${it.invoice.number || ""}${it.invoice.to ? " to " + it.invoice.to : ""}`;
      const acts = el("div", "row");
      acts.style.justifyContent = "flex-start";
      const send = el("button", "btn go small", "Email this invoice");
      send.type = "button";
      send.onclick = () => go(send, { action: "send", registration_id: regId, invoice_id: it.invoice.id });
      acts.append(send);
      if (it.invoice.pdf) {
        const a = el("a", "btn ghost small", "Download PDF");
        a.href = it.invoice.pdf; a.target = "_blank"; a.rel = "noopener";
        acts.append(a);
      }
      row.append(acts);
      row.append(el("p", "hint", "A paid invoice cannot be changed. This is the one Stripe issued for this payment."));
    } else if (it.can_create) {
      row.append(form(d));
    } else if (it.note) {
      row.append(el("p", "warn", it.note));
    }
    body.append(row);
  }
}

function form(d) {
  const b = d.bill || {};
  const box = el("div");
  box.innerHTML = `
    <p class="sub">No invoice yet. One will be made for exactly what they paid, marked paid by this card payment — nothing is charged again.</p>
    <div class="pi-grid">
      <div class="wide"><label for="pi-name">Name</label><input id="pi-name" type="text"></div>
      <div class="wide"><label for="pi-biz">Business name <span class="hint">— optional</span></label><input id="pi-biz" type="text"></div>
      <div class="wide"><label for="pi-vat">VAT / tax number <span class="hint">— optional</span></label><input id="pi-vat" type="text"></div>
      <div class="wide"><label for="pi-a1">Address</label><input id="pi-a1" type="text"></div>
      <div class="wide"><input id="pi-a2" type="text" aria-label="Address line 2"></div>
      <div><label for="pi-city">City</label><input id="pi-city" type="text"></div>
      <div><label for="pi-post">Postcode</label><input id="pi-post" type="text"></div>
      <div><label for="pi-country">Country code</label><input id="pi-country" type="text" maxlength="2" placeholder="e.g. DE"></div>
    </div>
    <div class="row" style="justify-content:flex-start"><button class="btn go" id="pi-make" type="button">Make invoice and email it</button></div>`;
  const set = (id, v) => { box.querySelector("#" + id).value = v || ""; };
  set("pi-name", b.name); set("pi-biz", b.business_name); set("pi-vat", b.vat_number);
  set("pi-a1", b.line1); set("pi-a2", b.line2); set("pi-city", b.city);
  set("pi-post", b.postcode); set("pi-country", b.country);
  box.querySelector("#pi-make").onclick = (e) => {
    const v = (id) => box.querySelector("#" + id).value.trim();
    const payload = {
      action: "create", registration_id: regId,
      name: v("pi-name"), business_name: v("pi-biz"), vat_number: v("pi-vat"),
      line1: v("pi-a1"), line2: v("pi-a2"), city: v("pi-city"), postcode: v("pi-post"),
      country: v("pi-country").toUpperCase(),
    };
    if (!payload.name) return msg("Enter the name for the invoice.", true);
    const to = payload.business_name || payload.name;
    if (!window.confirm(`Make an invoice to ${to} for this payment and email it to ${d.email}?\n\nIt is marked paid by their card payment. Nothing is charged.`)) return;
    go(e.target, payload);
  };
  return box;
}

async function go(btn, payload) {
  btn.disabled = true;
  msg(payload.action === "create" ? "Making the invoice…" : "Sending…");
  try {
    const r = await call(payload);
    msg(`${r.created ? "Invoice " + (r.number || "") + " made and e" : "E"}mailed to ${r.to}, with info@ copied.`);
    if (r.created) open(regId).then(() => msg(`Invoice ${r.number || ""} made and emailed to ${r.to}, with info@ copied.`));
  } catch (err) {
    msg(err.message, true);
  }
  btn.disabled = false;
}

window.openPaymentInvoice = open;
