// The programming sales pages (Nathan, 2 Nov 2026): the free trial, the
// monthly plans, the blocks and one-to-one, with prices in the visitor's
// own currency from programming-shop (the same list BirdBox Learn shows).
//
// Nothing is bought on this page. Join asks for the email, then the app's
// checkout opens Stripe: someone already on a plan for this course is sent
// to BirdBox Learn to change it instead. The trial goes to the app's
// trial-signup, which emails them how to open the app. One-to-one is by
// application (programming-apply.js).
//
// The page names its course on the Apply section, as programming-apply.js
// reads it: <section id="apply" data-brand="tgc">.

const SHOP = "/.netlify/functions/programming-shop";
const APP_CHECKOUT = "https://app.birdboxcoaching.com/.netlify/functions/checkout";
const APP_TRIAL = "https://app.birdboxcoaching.com/.netlify/functions/trial-signup";
const LEARN = "/learn/#programming";

const brand = (document.getElementById("apply")?.dataset.brand) || "tgc";
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, txt) => {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (txt != null) x.textContent = txt;
  return x;
};
const money = (cents, cur) => new Intl.NumberFormat("en-IE", {
  style: "currency", currency: String(cur || "eur").toUpperCase(),
  minimumFractionDigits: cents % 100 ? 2 : 0,
}).format((cents || 0) / 100);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function say(box, text, kind) {
  box.className = "ps-msg" + (kind ? " ps-msg--" + kind : "");
  box.textContent = text || "";
}

// "Prices in £ for the United Kingdom · Change country", as in BirdBox
// Learn: the country is guessed from where they browse; the currency
// follows the one they choose, and checkout charges that.
let chosen = "";
try { chosen = sessionStorage.getItem("bb-country") || ""; } catch {}
const COUNTRIES = ["IE", "GB", "US", "CA", "AU", "NZ", "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "CH", "NO",
  "IS", "LI", "AE", "SA", "QA", "IL", "ZA", "MX", "BR", "AR", "CL", "CO", "JP", "KR", "SG", "HK", "IN", "TH",
  "MY", "PH", "ID", "CN", "TW", "TR", "UA", "RS"];
const regionName = (c) => { try { return new Intl.DisplayNames(["en"], { type: "region" }).of(c); } catch { return c; } };
const CURRENCY_WORD = { eur: "euros (€)", gbp: "pounds (£)", usd: "US dollars ($)", aud: "Australian dollars", cad: "Canadian dollars" };
let shopCountry = "";

function curLine(shop) {
  const line = $("[data-curline]");
  if (!line) return;
  const names = COUNTRIES.map((c) => [c, regionName(c)]).sort((a, b) => a[1].localeCompare(b[1]));
  const here = shop.country && names.some(([c]) => c === shop.country) ? shop.country : "";
  line.innerHTML = '<span></span> · <button type="button">Change country</button>' +
    '<select hidden aria-label="Your country"><option value="">Another country (US dollars)</option>' +
    names.map(([c, n]) => `<option value="${c}"${c === here ? " selected" : ""}>${n}</option>`).join("") + "</select>";
  line.querySelector("span").textContent = "Prices in " + (CURRENCY_WORD[shop.currency] || shop.currency.toUpperCase()) +
    (here ? " for " + regionName(here) : "");
  const sel = line.querySelector("select");
  line.querySelector("button").onclick = () => { sel.hidden = false; sel.focus(); };
  sel.onchange = () => {
    chosen = sel.value || "ZZ";
    try { sessionStorage.setItem("bb-country", chosen); } catch {}
    load();
  };
}

// the country checkout should charge in: the one chosen, else the one we guessed
const country = () => chosen || shopCountry;

// Opens Stripe for a plan or a block; the email is asked for first, so
// one person never ends up with two plans for the same course
async function checkout(what, email, btn, msg) {
  if (!isEmail(email)) { say(msg, "Please add your email address.", "err"); return; }
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Opening checkout…"; say(msg, "");
  try {
    const r = await fetch(APP_CHECKOUT, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...what, email, country: country(), cancel_url: location.href.split("#")[0] }),
    });
    const d = await r.json().catch(() => ({}));
    if (d.url) { location.href = d.url; return; }
    if (d.already) {
      msg.className = "ps-msg ps-msg--ok";
      msg.innerHTML = "You're already on " + brand.toUpperCase() + " programming with this email. " +
        `<a href="${LEARN}">Change your plan in BirdBox Learn</a>: you pay the difference now and the new price from your next payment.`;
    } else throw new Error(d.error || "The checkout could not open. Please try again.");
  } catch (e) { say(msg, e.message, "err"); }
  btn.disabled = false; btn.textContent = label;
}

// a Join button that opens an email box under it, then goes to checkout
function joinBox(card, label, what, fill) {
  const b = el("button", "l1-tier__btn" + (fill ? " l1-tier__btn--fill" : ""), label); b.type = "button";
  const ask = el("form", "ps-ask"); ask.hidden = true; ask.noValidate = true;
  const id = "e" + Math.random().toString(36).slice(2, 8);
  ask.innerHTML = `<label for="${id}">Your email</label><input id="${id}" type="email" autocomplete="email" maxlength="254">` +
    '<button class="l1-tier__btn l1-tier__btn--fill" type="submit">Continue to payment &rarr;</button>' +
    '<p class="ps-msg" role="status"></p>';
  const msg = ask.querySelector(".ps-msg");
  b.onclick = () => { b.hidden = true; ask.hidden = false; ask.querySelector("input").focus(); };
  ask.onsubmit = (e) => {
    e.preventDefault();
    checkout(typeof what === "function" ? what() : what, ask.querySelector("input").value.trim(),
      ask.querySelector("button"), msg);
  };
  card.append(b, ask);
}

function tierCard(t, { pop, note, apply }) {
  const c = el("div", "l1-tier" + (apply ? " l1-tier--bespoke" : ""));
  c.appendChild(el("p", "l1-tier__name", "Tier " + t.tier));
  if (pop) c.appendChild(el("span", "ps-pop", pop));
  c.appendChild(el("h3", "l1-tier__what", t.name));
  c.appendChild(el("div", "l1-tier__price", t.amount != null ? money(t.amount, t.currency) : ""));
  c.appendChild(el("div", "l1-tier__per", "per month, VAT included"));
  const ul = el("ul", "l1-tier__list");
  for (const i of t.includes || []) ul.appendChild(el("li", null, i));
  c.appendChild(ul);
  if (note) c.appendChild(el("p", "ps-note", note));
  if (SEE[t.tier] && document.querySelector(SEE[t.tier][1])) {
    const a = el("a", "ps-see", SEE[t.tier][0]); a.href = SEE[t.tier][1];
    c.appendChild(a);
  }
  if (apply) {
    const b = el("button", "l1-tier__btn", "Apply →"); b.type = "button";
    // programming-apply.js has already run, so pick the tier here
    b.onclick = () => {
      const s = document.getElementById("ap-tier");
      s.value = "tier-" + t.tier; s.dispatchEvent(new Event("change"));
      document.getElementById("apply").scrollIntoView({ behavior: "smooth" });
      document.getElementById("ap-name").focus({ preventScroll: true });
    };
    c.appendChild(b);
  } else joinBox(c, "Join →", { tier: t.tier }, !!pop);
  return c;
}

const NAMES = { 1: "Blog", 2: "Blog + Community", 3: "Blog + 1:1 Feedback" };
const NOTES = {
  2: "Post your videos in the premium community and join the weekly group call.",
  3: "Your coach is confirmed within 24 hours of joining.",
};
// Tier 3 links down to what feedback looks like
const SEE = { 3: ["See what coach feedback looks like ↓", "#feedback"] };

function blockCard(k) {
  const weeks = k.weeks || 1;
  const c = el("div", "ps-block");
  if (k.cover_url) { const cv = el("div", "ps-block__cover"); cv.style.backgroundImage = `url("${encodeURI(k.cover_url)}")`; c.appendChild(cv); }
  const b = el("div", "ps-block__body");
  b.appendChild(el("p", "ps-block__meta", [weeks + " weeks", k.level].filter(Boolean).join(" · ")));
  b.appendChild(el("h3", "ps-block__name", k.name));
  if (k.author) b.appendChild(el("p", "ps-block__by", "Written by " + k.author));
  if (k.description) b.appendChild(el("p", "ps-block__text", k.description));
  const s = k.sales || {};
  const dl = el("dl");
  for (const [key, label] of [["intentions", "Key intentions"], ["focus", "Focus"], ["features", "What's in it"],
    ["who", "Who it is for"], ["equipment", "Equipment needed"], ["other", "Anything else"]]) {
    if (s[key]) dl.append(el("dt", null, label), el("dd", null, String(s[key])));
  }
  if (dl.children.length) b.appendChild(dl);

  const price = el("div", "ps-block__price");
  const big = el("span", "ps-block__big"), per = el("span", "ps-block__per");
  price.append(big, per);
  b.appendChild(price);

  const fbLine = el("label", "ps-check");
  fbLine.innerHTML = '<input type="checkbox"> <span></span>';
  fbLine.querySelector("span").textContent = "Add coach feedback on your videos, +" + money(k.feedback_week, k.currency) + " a week";
  const fb = fbLine.querySelector("input");
  const pay = el("div"); pay.hidden = true;
  const nm = "pay-" + k.id;
  pay.innerHTML = `<label class="ps-check"><input type="radio" name="${nm}" value="full" checked> Pay in full</label>` +
    `<label class="ps-check"><input type="radio" name="${nm}" value="four_weekly"> Pay every 4 weeks</label>` +
    '<p class="ps-note">With feedback, your coach is confirmed within 48 hours.</p>';
  const plan = () => (fb.checked && pay.querySelector('[value="four_weekly"]').checked ? "four_weekly" : "full");
  const show = () => {
    const wk = k.week + (fb.checked ? k.feedback_week : 0);
    const four = plan() === "four_weekly";
    big.textContent = money(four ? wk * Math.min(4, weeks) : wk * weeks, k.currency);
    per.textContent = (four ? "now, then every 4 weeks" : "paid once") + " · " + money(wk, k.currency) + " a week, VAT included";
    pay.hidden = !fb.checked;
  };
  fbLine.onchange = show; pay.onchange = show; show();
  b.append(fbLine, pay);

  const acts = el("div");
  joinBox(acts, "Buy →", () => ({ block: k.id, feedback: fb.checked, plan: plan() }), true);
  b.appendChild(acts);

  // Give as a gift (as in BirdBox Learn): paid in full; we email them on
  // the day chosen and they choose when to start
  const gb = el("button", "l1-tier__btn", "Give as a gift →"); gb.type = "button"; gb.style.marginTop = "8px";
  const g = el("form", "ps-ask"); g.hidden = true; g.noValidate = true;
  const today = new Date().toISOString().slice(0, 10);
  const last = new Date(Date.now() + 92 * 86400000).toISOString().slice(0, 10);
  g.innerHTML = '<label>Their first name<input name="to_name" maxlength="80"></label>' +
    '<label>Their email<input name="to_email" type="email" maxlength="254"></label>' +
    '<label>Your message (optional)<textarea name="message" maxlength="500" rows="3"></textarea></label>' +
    `<label>Send it on<input name="send_on" type="date" min="${today}" max="${last}" value="${today}"></label>` +
    '<label>Your first name<input name="from_name" maxlength="80" autocomplete="given-name"></label>' +
    '<label>Your email, for the receipt<input name="email" type="email" maxlength="254" autocomplete="email"></label>' +
    '<label class="ps-check"><input type="checkbox" name="feedback"> Include coach feedback on their videos</label>' +
    '<button class="l1-tier__btn l1-tier__btn--fill" type="submit">Pay for the gift &rarr;</button>' +
    '<p class="ps-msg" role="status"></p>' +
    '<p class="ps-note" style="margin:10px 0 0">Paid in full. We email them on the day you choose, with your message, and they choose when to start. You get the receipt.</p>';
  gb.onclick = () => { g.hidden = !g.hidden; if (!g.hidden) g.elements.to_name.focus(); };
  g.onsubmit = (e) => {
    e.preventDefault();
    const v = (n) => g.elements[n].value.trim();
    const msg = g.querySelector(".ps-msg");
    if (!v("to_name")) { say(msg, "Add the first name of the person it is for.", "err"); return; }
    if (!isEmail(v("to_email"))) { say(msg, "Add the email address of the person it is for.", "err"); return; }
    checkout({ block: k.id, feedback: g.elements.feedback.checked, plan: "full",
      gift: { to_name: v("to_name"), to_email: v("to_email"), message: v("message"), send_on: v("send_on"), from_name: v("from_name") } },
      v("email"), g.querySelector('button[type="submit"]'), msg);
  };
  b.append(gb, g);
  c.appendChild(b);
  return c;
}

async function load() {
  const plans = $("[data-plans]"), one = $("[data-one]"), blocks = $("[data-blocks]");
  let shop;
  try {
    const r = await fetch(SHOP + (chosen ? "?country=" + encodeURIComponent(chosen) : ""));
    shop = await r.json();
    if (!r.ok || !shop.courses) throw new Error();
  } catch {
    plans.innerHTML = "";
    plans.appendChild(el("p", "ps-msg ps-msg--err", "The prices could not load. Please refresh the page, or write to info@birdboxcoaching.com."));
    return;
  }
  shopCountry = shop.country || "";
  curLine(shop);
  const co = shop.courses.find((c) => c.brand === brand) || { plans: [], one_to_one: [], blocks: [] };

  plans.innerHTML = "";
  for (const t of co.plans) {
    plans.appendChild(tierCard({ ...t, name: NAMES[t.tier] || t.name },
      { pop: t.tier === 2 ? "Recommended" : null, note: NOTES[t.tier] }));
  }
  if (!co.plans.length) plans.appendChild(el("p", "ps-empty", "Monthly plans are coming soon."));
  const low = co.plans.filter((t) => t.amount != null).sort((a, b) => a.amount - b.amount)[0];
  const from = $("[data-from]");
  if (from && low) from.textContent = "From " + money(low.amount, low.currency);

  one.innerHTML = "";
  for (const t of co.one_to_one) one.appendChild(tierCard(t, { apply: true }));
  $("#one-to-one").hidden = $("#apply").hidden = !co.one_to_one.length;

  // the Blocks section shows once a block is Live on Block programming
  blocks.innerHTML = "";
  for (const k of co.blocks) blocks.appendChild(blockCard(k));
  $("#blocks").hidden = !co.blocks.length;
}

// The feedback film (Nathan, 2 Nov 2026): shown once the page names one
// on #feedback (data-video, data-poster)
const fb = document.getElementById("feedback");
if (fb && fb.dataset.video) {
  const film = fb.querySelector(".ps-film"), v = film.querySelector("video");
  v.src = fb.dataset.video;
  if (fb.dataset.poster) v.poster = fb.dataset.poster;
  film.hidden = false;
}

// the free trial: first name and email; the reply is the same whoever
// they are, and the app's email tells them what happens next
const trial = document.getElementById("trial-form");
if (trial) trial.onsubmit = async (e) => {
  e.preventDefault();
  const msg = trial.querySelector(".ps-msg"), btn = trial.querySelector("button");
  const email = document.getElementById("tr-email").value.trim();
  const first = document.getElementById("tr-name").value.replace(/\s+/g, " ").trim();
  if (!first) { say(msg, "Please add your first name.", "err"); return; }
  if (!isEmail(email)) { say(msg, "Please add your email address.", "err"); return; }
  btn.disabled = true; say(msg, "Starting…");
  try {
    const r = await fetch(APP_TRIAL, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, first_name: first, country: country() }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || "The trial could not start. Please try again.");
    say(msg, "Done. Check your email: it tells you how to open your two weeks in the BirdBox Coaching app.", "ok");
    trial.reset();
  } catch (err) { say(msg, err.message, "err"); btn.disabled = false; }
};

load();
