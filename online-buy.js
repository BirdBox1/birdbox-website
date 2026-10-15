/* online-buy.js
 *
 * The buy box on the online course pages. Put this where it should
 * appear:
 *
 *   <div id="buy" class="ob" data-brand="tcc" data-level="1"></div>
 *   <script src="/online-buy.js"></script>
 *
 * It asks netlify/functions/online-checkout for the prices (in the
 * visitor's currency, which they can change) and the languages on
 * sale, then sends them to Stripe Checkout. Colours come from the
 * page's own --tcc / --accentText / --line / --panel variables, so it
 * matches whichever brand page it sits on.
 */
(function () {
  var box = document.getElementById("buy");
  if (!box) return;

  // Every "Start Learning Now" button glides down to the buy box.
  try { document.documentElement.style.scrollBehavior = "smooth"; } catch (e) {}

  var brand = box.getAttribute("data-brand");
  var level = box.getAttribute("data-level");
  var API = "/.netlify/functions/online-checkout";
  var SYMBOL = { EUR: "€", GBP: "£", USD: "US$", AUD: "A$", CAD: "C$" };
  var state = { offer: null, currency: null, language: null, option: "full", months: null, country: "" };

  // Each language named, and described, in its own words.
  var LANG_NAME = { en: "English", es: "Español", fr: "Français", it: "Italiano", de: "Deutsch", pt: "Português" };
  var LANG_NOTE = {
    en: "The whole course in English",
    es: "Todo el curso en español",
    fr: "Tout le cours en français",
    it: "Tutto il corso in italiano",
    de: "Der ganze Kurs auf Deutsch",
    pt: "Todo o curso em português",
  };
  // The rest of the box in the chosen course language. A language
  // without its own words here falls back to English.
  var WORDS = {
    en: {
      lang: "Choose your course language", course: "Your course", cur: "Choose your currency",
      where: "Where are you based?", choose: "Choose\u2026", how: "Choose how to pay",
      full: "Pay in full", fullNote: "One card payment. Instant access.",
      plan: "Monthly payments", n: "Number of payments", of: " payments of ", month: "/ month ",
      planNote: function (m) { return "Card. Instant access on the first payment; the plan ends by itself after " + m + " payments."; },
      vatMaybe: "+ VAT where applicable", vat: function (r) { return "+ " + r + "% VAT"; }, noVat: "no VAT",
      go: "Continue to secure checkout \u2192", opening: "Opening checkout\u2026",
      vatInfo: "VAT applies to buyers in the EU and UK, at the rate for the country you are based in. ",
      paidSite: "As soon as you have paid, we email you how to log in on this website and the course is already in your account.",
      paidLw: "As soon as you have paid, your BirdBox Academy login is emailed to you and the course is already in your account.",
      already: "Already enrolled? ", mine: "Go to My courses \u2192", lwLogin: "Log in to BirdBox Academy \u2192",
      needCountry: "Choose where you are based first.",
      retry: " Please try again, or email info@birdboxcoaching.com.",
    },
    es: {
      lang: "Elige el idioma del curso", course: "Tu curso", cur: "Elige tu moneda",
      where: "\u00bfD\u00f3nde resides?", choose: "Elige\u2026", how: "Elige c\u00f3mo pagar",
      full: "Pago \u00fanico", fullNote: "Un solo pago con tarjeta. Acceso inmediato.",
      plan: "Pagos mensuales", n: "N\u00famero de pagos", of: " pagos de ", month: "/ mes ",
      planNote: function (m) { return "Tarjeta. Acceso inmediato con el primer pago; el plan termina solo despu\u00e9s de " + m + " pagos."; },
      vatMaybe: "+ IVA si corresponde", vat: function (r) { return "+ " + r + "% IVA"; }, noVat: "sin IVA",
      go: "Continuar al pago seguro \u2192", opening: "Abriendo el pago\u2026",
      vatInfo: "Se aplica IVA a compradores de la UE y el Reino Unido, seg\u00fan el pa\u00eds donde residas. ",
      paidSite: "En cuanto pagues, te enviamos por email c\u00f3mo entrar en esta web y el curso ya estar\u00e1 en tu cuenta.",
      paidLw: "En cuanto pagues, te enviamos por email tu acceso a BirdBox Academy y el curso ya estar\u00e1 en tu cuenta.",
      already: "\u00bfYa est\u00e1s inscrito? ", mine: "Ir a Mis cursos \u2192", lwLogin: "Entrar en BirdBox Academy \u2192",
      needCountry: "Primero elige d\u00f3nde resides.",
      retry: " Vuelve a intentarlo o escribe a info@birdboxcoaching.com.",
    },
  };
  function W() { return WORDS[state.language] || WORDS.en; }

  // The language picked to start with: ?lang=es in the link, else the
  // visitor's browser language when the course is sold in it.
  function startLanguage(list) {
    var codes = list.map(function (l) { return l.language; });
    var want = null;
    try { want = new URLSearchParams(location.search).get("lang"); } catch (e) {}
    if (want && codes.indexOf(want) > -1) return want;
    var nav = String((navigator.languages && navigator.languages[0]) || navigator.language || "").slice(0, 2).toLowerCase();
    if (codes.indexOf(nav) > -1) return nav;
    return codes[0] || null;
  }

  // Every country, named in English, for the "Where are you based?" list.
  var CODES = ("AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FR GA GB GD GE GH GI GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KM KN KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NZ OM PA PE PG PH PK PL PR PS PT PY QA RE RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS SV SY SZ TD TG TH TJ TL TM TN TO TR TT TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW").split(" ");
  // Named in the chosen course language, so a Spanish buyer reads España.
  var countryLists = {};
  function countries() {
    var lang = WORDS[state.language] ? state.language : "en";
    if (countryLists[lang]) return countryLists[lang];
    var names = null;
    try { names = new Intl.DisplayNames([lang], { type: "region" }); } catch (e) { names = null; }
    function countryName(c) {
      if (c === "XK") return "Kosovo";
      try { return (names && names.of(c)) || c; } catch (e) { return c; }
    }
    return (countryLists[lang] = CODES.map(function (c) { return { code: c, name: countryName(c) }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, lang); }));
  }

  function vatFor(code) {
    var list = (state.offer && state.offer.vat) || [];
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i].rate;
    return 0;
  }

  var css = document.createElement("style");
  css.textContent = [
    ".ob{border:1px solid #4A4446;border-top:4px solid var(--tcc);background:#2B2628;padding:28px 26px;scroll-margin-top:20px;box-shadow:0 18px 50px rgba(0,0,0,.45)}",
    ".ob-row{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;margin-bottom:22px}",
    ".ob-step{font-size:15px;font-weight:800;color:var(--ink);margin:0 0 12px;letter-spacing:.02em}",
    ".ob-field label{display:block;font-size:15px;font-weight:700;color:var(--ink);margin-bottom:8px}",
    ".ob-field label b{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--tcc);color:#0C1116;font-size:13px;margin-right:8px;vertical-align:1px}",
    ".ob-opt .ob-field label{font-size:14px}",
    ".ob-field select{background:#1E1A1B;color:var(--ink);border:1px solid #6A6466;padding:12px 14px;font-size:18px;min-width:210px;border-radius:4px}",
    ".ob-only{font-size:18px;font-weight:700;padding:12px 0}",
    ".ob-opts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px}",
    "@media(max-width:620px){.ob-opts{grid-template-columns:1fr}}",
    ".ob-opt select{min-width:0;width:100%}",
    ".ob-opt{display:block;border:1px solid #5A5456;background:#38322F;transition:border-color .15s,background .15s;padding:16px 18px;cursor:pointer;text-align:left;color:var(--ink);font:inherit}",
    ".ob-opt:hover{border-color:#8A8385}",
    ".ob-opt[aria-pressed=true]{border-color:var(--tcc);box-shadow:inset 0 0 0 1px var(--tcc);background:#403834}",
    ".ob-opt[aria-pressed=true] .ob-opt__k::before{content:\"\\2713  \"}",
    ".ob-opt__note,.ob-small{color:#B7B1B3!important}",
    ".ob-langs .ob-opt__k{font-size:20px;letter-spacing:.04em;text-transform:none;color:var(--ink)}",
    ".ob-opt__lang{font-size:15px;color:#B7B1B3;margin-top:2px}",
    ".ob-opt__k{font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--accentText);margin-bottom:6px}",
    ".ob-opt__amt{font-size:30px;font-weight:800}",
    ".ob-opt__amt small{font-size:13px;font-weight:600;color:var(--muted)}",
    ".ob-opt__note{font-size:15px;color:var(--muted);margin-top:4px;line-height:1.45}",
    ".ob-go{cursor:pointer;font-family:inherit}",
    ".ob-go[disabled]{opacity:.6;cursor:wait}",
    ".ob-small{font-size:14px;line-height:1.6;color:var(--muted);margin:14px 0 0}",
    ".ob-err{color:#F0797D;font-size:14px;margin:12px 0 0}",
    "@media(min-width:1001px){.ob-tiles{grid-template-columns:repeat(4,1fr)!important}}",
  ].join("\n");
  document.head.appendChild(css);

  function money(cents, cur) {
    var n = cents / 100;
    var txt = n % 1 === 0 ? n.toLocaleString("en-GB") : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (SYMBOL[cur] || cur + " ") + txt;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render() {
    var o = state.offer;
    box.innerHTML = "";

    var w = W();
    var currencies = Object.keys(o.prices);
    if (!currencies.length || !o.languages.length) {
      box.appendChild(el("p", "ob-small", "Online enrolment is opening soon. Email info@birdboxcoaching.com and we will get you started."));
      return;
    }

    var n = 0;
    function stepLabel(text, forId) {
      var l = el("label");
      var b = el("b", null, String(++n));
      l.appendChild(b);
      l.appendChild(document.createTextNode(text));
      if (forId) l.htmlFor = forId;
      return l;
    }

    var row = el("div", "ob-row");

    // Language — only asked when there is a choice, and asked first, as
    // large tiles in each language's own words so nobody misses it.
    if (o.languages.length > 1) {
      var lh = el("div", "ob-field");
      lh.appendChild(stepLabel(w.lang));
      box.appendChild(lh);
      var lt = el("div", "ob-opts ob-langs");
      o.languages.forEach(function (l) {
        var b = el("button", "ob-opt");
        b.type = "button";
        b.setAttribute("aria-pressed", String(l.language === state.language));
        b.appendChild(el("div", "ob-opt__k", LANG_NAME[l.language] || l.language));
        b.appendChild(el("div", "ob-opt__lang", LANG_NOTE[l.language] || l.label));
        b.onclick = function () { state.language = l.language; render(); };
        lt.appendChild(b);
      });
      box.appendChild(lt);
    } else {
      var only = el("div", "ob-field");
      var ol = el("label", null, w.course);
      only.appendChild(ol);
      only.appendChild(el("div", "ob-only", o.languages[0].label));
      row.appendChild(only);
    }

    var cf = el("div", "ob-field");
    var cl = stepLabel(w.cur, "ob-cur");
    var cs = el("select");
    cs.id = "ob-cur";
    currencies.forEach(function (c) {
      var op = el("option", null, c);
      op.value = c;
      cs.appendChild(op);
    });
    cs.value = state.currency;
    cs.onchange = function () { state.currency = cs.value; render(); };
    cf.appendChild(cl); cf.appendChild(cs);
    row.appendChild(cf);

    // Where they are based decides the VAT, so it is asked here, filled
    // in from where they are browsing.
    var kf = el("div", "ob-field");
    var kl = stepLabel(w.where, "ob-country");
    var ks = el("select");
    ks.id = "ob-country";
    var blank = el("option", null, w.choose);
    blank.value = "";
    ks.appendChild(blank);
    countries().forEach(function (c) {
      var op = el("option", null, c.name);
      op.value = c.code;
      ks.appendChild(op);
    });
    ks.value = state.country;
    ks.onchange = function () { state.country = ks.value; render(); };
    kf.appendChild(kl); kf.appendChild(ks);
    row.appendChild(kf);
    box.appendChild(row);

    var price = o.prices[state.currency];
    var rate = state.country ? vatFor(state.country) : 0;
    var vatNote = !state.country ? w.vatMaybe
      : rate > 0 ? w.vat(rate) : w.noVat;
    var each = Math.round(price / state.months);

    var ph = el("div", "ob-field");
    ph.appendChild(stepLabel(w.how));
    box.appendChild(ph);

    var opts = el("div", "ob-opts");
    function option(key, label, amt, per, note, extra) {
      var b = el("div", "ob-opt");
      b.setAttribute("role", "button");
      b.tabIndex = 0;
      b.setAttribute("aria-pressed", state.option === key ? "true" : "false");
      b.appendChild(el("div", "ob-opt__k", label));
      var a = el("div", "ob-opt__amt", amt + " ");
      a.appendChild(el("small", null, per));
      b.appendChild(a);
      b.appendChild(el("div", "ob-opt__note", note));
      if (extra) b.appendChild(extra);
      b.onclick = function (e) {
        if (e.target && e.target.tagName === "SELECT") return;
        if (state.option !== key) { state.option = key; render(); }
      };
      opts.appendChild(b);
    }

    option("full", w.full, money(price, state.currency), vatNote, w.fullNote);

    // How many months, 3 to 8.
    var mwrap = el("div", "ob-field");
    mwrap.style.marginTop = "10px";
    var ml = el("label", null, w.n);
    ml.htmlFor = "ob-months";
    var msel = el("select");
    msel.id = "ob-months";
    o.months.forEach(function (n) {
      var op = el("option", null, n + w.of + money(Math.round(price / n), state.currency));
      op.value = String(n);
      msel.appendChild(op);
    });
    msel.value = String(state.months);
    msel.onchange = function () { state.months = parseInt(msel.value, 10); state.option = "plan"; render(); };
    mwrap.appendChild(ml); mwrap.appendChild(msel);

    option("plan", w.plan, money(each, state.currency), w.month + vatNote,
      w.planNote(state.months), mwrap);
    box.appendChild(opts);

    var go = el("button", "tcc-cta ob-go", w.go);
    go.type = "button";
    go.onclick = function () { buy(go); };
    box.appendChild(go);

    box.appendChild(el("p", "ob-small",
      w.vatInfo + (o.on_site ? w.paidSite : w.paidLw)));

    var li = el("p", "ob-small");
    li.appendChild(document.createTextNode(w.already));
    var la = el("a", null, o.on_site ? w.mine : w.lwLogin);
    la.href = o.on_site ? "/learn/" : "https://www.birdboxacademy.com";
    la.style.color = "var(--accentText)";
    la.style.fontWeight = "700";
    li.appendChild(la);
    box.appendChild(li);

    var err = el("p", "ob-err");
    err.id = "ob-err";
    err.hidden = true;
    box.appendChild(err);
  }

  function showError(msg) {
    var e = document.getElementById("ob-err");
    if (!e) return;
    e.textContent = msg;
    e.hidden = false;
  }

  function buy(btn) {
    if (!state.country) {
      showError(W().needCountry);
      var k = document.getElementById("ob-country");
      if (k) k.focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = W().opening;
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand: brand,
        level: level,
        language: state.language,
        currency: state.currency,
        option: state.option,
        months: state.months,
        country: state.country,
        return_path: location.pathname,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.url) { location.href = d.url; return; }
        throw new Error((d && d.error) || "Checkout could not start.");
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = W().go;
        showError(e.message + W().retry);
      });
  }

  box.textContent = "Loading prices…";
  fetch(API + "?brand=" + encodeURIComponent(brand) + "&level=" + encodeURIComponent(level))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || d.error) throw new Error((d && d.error) || "No prices");
      state.offer = d;
      state.currency = d.currency;
      state.months = d.months && d.months.length ? d.months[0] : 3;
      state.country = d.country && CODES.indexOf(d.country) > -1 ? d.country : "";
      state.language = startLanguage(d.languages);
      render();
    })
    .catch(function () {
      box.innerHTML = "";
      box.appendChild(el("p", "ob-small", "Prices could not be loaded. Refresh the page, or email info@birdboxcoaching.com."));
    });
})();
