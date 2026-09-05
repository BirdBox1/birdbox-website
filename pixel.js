// Meta pixel for the pages that do not carry the shared nav.
//
// nav.js already loads the pixel on every page that has the top bar, but the
// course pages at /c/<slug>/ and the /registration-complete/ page do not load
// nav.js — which meant the two pages that actually sell anything reported
// nothing at all. This file fills that gap.
//
// Dataset 2663209040595150, owned by the BirdBox Coaching business portfolio.
//
// It is safe to load this alongside nav.js: both guard on window.fbq, so
// whichever runs first wins and a visit is never counted twice.
//
// Nothing here fires until the visitor has accepted cookies. consent.js is
// pulled in by this file, so neither page needs editing. No answer, or a
// no, means no pixel, no cookie and no events.
//
// Events sent, once consent is given:
//   PageView         every page that loads this file
//   ViewContent      a course page once the course has rendered
//   InitiateCheckout when someone presses a pay button
//   Purchase         the registration-complete page, once payment is shown
(function () {
  "use strict";

  // ---- Consent gate -----------------------------------------------------
  function withConsent(fn) {
    if (window.bbConsent) { window.bbConsent.whenGranted(fn); return; }

    (window.__bbConsentQueue = window.__bbConsentQueue || []).push(fn);

    if (!document.getElementById("bb-consent-js")) {
      var s = document.createElement("script");
      s.id = "bb-consent-js";
      s.src = "/consent.js";
      s.onload = function () {
        var q = window.__bbConsentQueue || [];
        window.__bbConsentQueue = [];
        for (var i = 0; i < q.length; i++) window.bbConsent.whenGranted(q[i]);
      };
      document.head.appendChild(s);
    }
  }

  // Everything below runs only after an accept. If they accept part way
  // through reading a course page the page has already rendered, so the
  // ViewContent check passes straight away and the event still goes.
  withConsent(function () {

  // ---- Pixel ------------------------------------------------------------
  if (!window.fbq) {
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window,document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '2663209040595150');
    fbq('track', 'PageView');
  }

  // ---- Helpers ----------------------------------------------------------

  // The course slug, taken from /c/<slug>/. This is the same value used as
  // utm_campaign on the ads, so a campaign and its pixel events line up.
  function slug() {
    var m = location.pathname.match(/\/c\/([^\/]+)/);
    return m ? m[1] : "";
  }

  // Prices are rendered as text — "€600", "£560", "US$710", "A$975" — so the
  // amount and the currency both have to be read back out of the string.
  // Returns null rather than guessing when the text does not look like money.
  function money(text) {
    if (!text) return null;
    var t = String(text).replace(/\s+/g, "");
    var currency =
      /US\$/i.test(t) ? "USD" :
      /A\$/i.test(t)  ? "AUD" :
      /NZ\$/i.test(t) ? "NZD" :
      /€/.test(t)     ? "EUR" :
      /£/.test(t)     ? "GBP" :
      /CHF/i.test(t)  ? "CHF" :
      /\$/.test(t)    ? "USD" : null;
    if (!currency) return null;
    // Strip everything that is not a digit, a dot or a comma, then treat the
    // last separator as the decimal point if it has exactly two digits after.
    var digits = t.replace(/[^0-9.,]/g, "");
    if (!digits) return null;
    var normalised = digits.replace(/,(\d{2})$/, ".$1").replace(/,/g, "");
    var value = parseFloat(normalised);
    if (!isFinite(value) || value <= 0) return null;
    return { value: value, currency: currency };
  }

  // Only the direct text of an element, ignoring any struck-through "was"
  // price or "you save" note sitting inside it.
  function ownText(el) {
    if (!el) return "";
    var out = "";
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) out += el.childNodes[i].textContent;
    }
    return out.trim();
  }

  // Both pages render from a fetch, so nothing worth reporting exists at
  // load. Poll for it, and give up quietly after fifteen seconds.
  function whenReady(test, done) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (test()) { clearInterval(timer); done(); }
      else if (tries > 60) { clearInterval(timer); }
    }, 250);
  }

  var sent = {};
  function once(name, params) {
    if (sent[name]) return;
    sent[name] = true;
    fbq("track", name, params || {});
  }

  // ---- Course pages -----------------------------------------------------
  if (/^\/c\//.test(location.pathname)) {
    whenReady(
      function () {
        var p = document.getElementById("price");
        return p && ownText(p).length > 0;
      },
      function () {
        var m = money(ownText(document.getElementById("price")));
        var params = {
          content_type: "product",
          content_ids: [slug()],
          content_name: document.title.replace(/\s*—\s*BirdBox Coaching\s*$/, ""),
        };
        if (m) { params.value = m.value; params.currency = m.currency; }
        once("ViewContent", params);
      }
    );

    // The pay buttons are built after render, so listen on the document
    // rather than binding to buttons that do not exist yet.
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".opt") : null;
      if (!btn) return;
      var m = money(ownText(document.getElementById("price")));
      var params = { content_type: "product", content_ids: [slug()], num_items: 1 };
      if (m) { params.value = m.value; params.currency = m.currency; }
      // Not once() — someone may pick deposit, change their mind, pay in full.
      fbq("track", "InitiateCheckout", params);
    }, true);
  }

  // ---- Registration complete -------------------------------------------
  if (/^\/registration-complete/.test(location.pathname)) {
    whenReady(
      function () {
        var done = document.getElementById("done");
        var amount = document.getElementById("paidamount");
        return done && !done.classList.contains("hidden") &&
               amount && amount.textContent.trim().length > 0;
      },
      function () {
        var m = money(document.getElementById("paidamount").textContent);
        var params = {
          content_type: "product",
          content_name: document.title.replace(/^You're registered\s*—\s*/, ""),
          num_items: 1,
        };
        if (m) { params.value = m.value; params.currency = m.currency; }
        once("Purchase", params);
      }
    );
  }

  });
})();
