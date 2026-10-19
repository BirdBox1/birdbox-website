/* portal/balance-invoice.js
 *
 * "Invoice balance" on a participant's card: one Stripe invoice for
 * what they still owe on the seminar, emailed to them, due on the day
 * chosen (netlify/functions/balance-invoice.mjs). They show as owing
 * until it is paid; the webhook marks them paid in full when it is.
 *
 * Exposes window.openBalanceInvoice(reg, course, onDone).
 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const db = createClient(
  "https://yvdmazpxtpuvidlcifnq.supabase.co",
  "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ"
);
const $ = (id) => document.getElementById(id);
let ctx = null;

function build() {
  if ($("biwrap")) return;
  const style = document.createElement("style");
  style.textContent = `
    #biwrap .dialog { max-width: 36rem; }
    #biwrap input { letter-spacing: normal; font-weight: 400; text-transform: none; width: 100%; box-sizing: border-box; }
    #biwrap .bi-grid { display: grid; gap: .7rem; grid-template-columns: 1fr; margin: .6rem 0 .8rem; }
    @media (min-width: 30rem) { #biwrap .bi-grid { grid-template-columns: 1fr 1fr; } }
    #biwrap .bi-grid .wide { grid-column: 1 / -1; }
    #biwrap label { display: block; font-size: .82rem; font-weight: 600; margin-bottom: .25rem; }
    #biwrap .hint { font-weight: 400; opacity: .7; }
  `;
  document.head.append(style);
  const wrap = document.createElement("div");
  wrap.className = "overlay hidden";
  wrap.id = "biwrap";
  wrap.innerHTML = `
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="bi-h">
    <h3 id="bi-h">Invoice the balance</h3>
    <p class="whenline" id="bi-who"></p>
    <div class="bi-grid">
      <div><label for="bi-amount">Amount owed <span class="hint">incl. VAT</span></label>
        <input id="bi-amount" type="number" min="0" step="0.01" inputmode="decimal"></div>
      <div><label for="bi-due">Due</label><input id="bi-due" type="date"></div>
      <div class="wide"><label for="bi-desc">On the invoice</label><input id="bi-desc" type="text"></div>
      <div><label for="bi-name">Name</label><input id="bi-name" type="text"></div>
      <div><label for="bi-email">Email</label><input id="bi-email" type="email"></div>
      <div class="wide"><label for="bi-a1">Address <span class="hint">— optional</span></label><input id="bi-a1" type="text"></div>
      <div><label for="bi-city">City</label><input id="bi-city" type="text"></div>
      <div><label for="bi-post">Postcode</label><input id="bi-post" type="text"></div>
      <div><label for="bi-country">Country code</label><input id="bi-country" type="text" maxlength="2" placeholder="e.g. ES"></div>
    </div>
    <p class="whenline">Stripe emails the invoice with a link to pay by card. They show as owing until it is paid, then as paid in full automatically.</p>
    <p class="msg" id="bi-msg"></p>
    <div class="row">
      <button class="btn ghost" id="bi-close" type="button">Cancel</button>
      <button class="btn go" id="bi-send" type="button">Send invoice</button>
    </div>
  </div>`;
  document.body.append(wrap);
  const close = () => { wrap.classList.add("hidden"); ctx = null; };
  $("bi-close").onclick = close;
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  $("bi-send").onclick = send;
}

function msg(text, bad) {
  const m = $("bi-msg");
  m.className = "msg" + (text ? (bad ? " err" : " ok") : "");
  m.textContent = text;
}

function open(reg, course, onDone) {
  build();
  ctx = { reg, course, onDone };
  $("bi-who").textContent = `${reg.first_name} ${reg.last_name} · ${course.title}`;
  $("bi-amount").value = "";
  $("bi-due").value = new Date().toISOString().slice(0, 10);
  $("bi-desc").value = `Remaining balance — ${course.title}`;
  $("bi-name").value = `${reg.first_name || ""} ${reg.last_name || ""}`.trim();
  $("bi-email").value = reg.email || "";
  for (const id of ["bi-a1", "bi-city", "bi-post"]) $(id).value = "";
  $("bi-country").value = reg.country || course.country || "";
  msg("");
  $("biwrap").classList.remove("hidden");
  $("bi-amount").focus();
}

async function send() {
  if (!ctx) return;
  const v = (id) => $(id).value.trim();
  const body = {
    registration_id: ctx.reg.id,
    amount: v("bi-amount"), due_date: v("bi-due"), description: v("bi-desc"),
    name: v("bi-name"), email: v("bi-email"),
    line1: v("bi-a1"), city: v("bi-city"), postcode: v("bi-post"), country: v("bi-country").toUpperCase(),
  };
  if (!(parseFloat(body.amount) > 0)) return msg("Enter the amount they owe.", true);
  if (!body.email.includes("@")) return msg("A valid email is needed.", true);
  const cur = ctx.course.currency || ctx.reg.currency || "EUR";
  if (!window.confirm(`Email ${body.name} (${body.email}) an invoice for ${cur} ${parseFloat(body.amount).toFixed(2)}, due ${body.due_date}?\n\n"${body.description}"`)) return;

  $("bi-send").disabled = true;
  msg("Sending…");
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) throw new Error("Your session has expired — sign in again.");
    const res = await fetch("/.netlify/functions/balance-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify(body),
    });
    let out = {};
    try { out = await res.json(); } catch (e) { /* not json */ }
    if (!res.ok || out.error) throw new Error(out.error || "That did not work.");
    msg(`Sent — invoice ${out.number || ""} for ${out.currency} ${(out.total / 100).toFixed(2)} to ${out.to}.`);
    const done = ctx.onDone;
    setTimeout(() => { $("biwrap").classList.add("hidden"); ctx = null; if (done) done(); }, 1800);
  } catch (err) {
    msg(err.message, true);
  }
  $("bi-send").disabled = false;
}

window.openBalanceInvoice = open;
