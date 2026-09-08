// Cookie consent for birdboxcoaching.com.
//
// The Meta pixel loads from two places — nav.js on every page with the top
// bar, and pixel.js on the course, quiz and registration-complete pages,
// which do not carry the nav. Both ask this file first and neither loads
// anything until this file says they may.
//
// Nothing here needs adding to a page. nav.js and pixel.js pull this file in
// themselves, so every page that already loads one of them is covered.
//
// ---------------------------------------------------------------------------
// Where the banner shows, and why
// ---------------------------------------------------------------------------
// Consent before tracking is a European rule — the ePrivacy Directive, as it
// lands in each member state, plus the UK's PECR. It is not the law in the
// United States, Canada, Australia, New Zealand or the UAE, where the
// standard is notice and the ability to opt out rather than permission asked
// in advance.
//
// So the banner is shown to visitors in the EU, the EEA, the UK and
// Switzerland, and to anyone whose country we cannot establish. Everywhere
// else the pixel runs, the privacy notice explains it, and the "Cookie
// settings" link in the footer lets anybody turn it off — which is what
// those jurisdictions ask for.
//
// The country comes from /.netlify/functions/geo, which reads Netlify's own
// edge geolocation. It is cached for a week so this is one request per
// visitor rather than one per page. If the lookup fails for any reason the
// banner shows: an unknown visitor is treated as a European one.
//
// The rules this is written to:
//   - In Europe, no non-essential cookie or tracker fires before consent
//   - Reject is exactly as easy as Accept — same size, same prominence
//   - The choice can be changed later, from a link in the footer, anywhere
//   - Doing nothing counts as no
//
// Supabase, Netlify and Stripe are not gated anywhere: they are doing what
// the visitor asked for, which needs no consent.
(function () {
  "use strict";

  var KEY = "bb-consent";        // "yes" | "no" — only ever set by a click
  var GEO_KEY = "bb-geo";        // {c:"US",t:1234567890}
  var GEO_TTL = 7 * 24 * 60 * 60 * 1000;

  var waiting = [];              // callbacks held until we are allowed
  var allowed = false;           // has the pixel been let go this page view

  // Consent-before-tracking countries. EU 27, then the rest of the EEA,
  // then the UK, then Switzerland — which is not bound by ePrivacy but
  // whose revised FADP is close enough that it is not worth the argument.
  var ASK = {
    AT:1, BE:1, BG:1, HR:1, CY:1, CZ:1, DK:1, EE:1, FI:1, FR:1, DE:1, GR:1,
    HU:1, IE:1, IT:1, LV:1, LT:1, LU:1, MT:1, NL:1, PL:1, PT:1, RO:1, SK:1,
    SI:1, ES:1, SE:1,
    IS:1, LI:1, NO:1,
    GB:1, CH:1
  };

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function remember(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* private mode */ }
  }

  // granted() answers the question the pixel actually cares about: may I
  // send something right now. That is true after an explicit yes and also
  // true outside Europe, where no yes was needed.
  function granted() { return allowed; }

  // Everything the pixel wants to do goes through here. Called immediately
  // if we are already clear, on the click if they agree, never otherwise.
  function whenGranted(fn) {
    if (typeof fn !== "function") return;
    if (allowed) { fn(); return; }
    waiting.push(fn);
  }

  function release() {
    allowed = true;
    var list = waiting.slice();
    waiting.length = 0;
    for (var i = 0; i < list.length; i++) {
      try { list[i](); } catch (e) { /* one failure must not stop the rest */ }
    }
  }

  // Saying no after the pixel has already gone cannot un-send what Meta has,
  // so the page reloads — that clears the pixel out of memory and stops
  // anything further being sent.
  function decide(value) {
    var wasAllowed = allowed;
    remember(value);
    close();
    if (value === "yes") release();
    else if (wasAllowed) location.reload();
  }

  // ---- Where is this person --------------------------------------------

  function cachedCountry() {
    try {
      var raw = localStorage.getItem(GEO_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.c || !o.t) return null;
      if (Date.now() - o.t > GEO_TTL) return null;
      return o.c;
    } catch (e) { return null; }
  }

  function cacheCountry(code) {
    try {
      localStorage.setItem(GEO_KEY, JSON.stringify({ c: code, t: Date.now() }));
    } catch (e) { /* private mode */ }
  }

  // Hands back "ask" or "allow". Anything unexpected — a failed request, a
  // country we do not recognise, no country at all — comes back as "ask".
  function jurisdiction(done) {
    var hit = cachedCountry();
    if (hit) { done(ASK[hit] ? "ask" : "allow"); return; }

    var settled = false;
    function finish(code) {
      if (settled) return;
      settled = true;
      if (code) cacheCountry(code);
      done(code && !ASK[code] ? "allow" : "ask");
    }

    // If the network is slow the banner appears rather than the visitor
    // being tracked on a guess.
    setTimeout(function () { finish(null); }, 2500);

    try {
      fetch("/.netlify/functions/geo", { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { finish(d && d.country ? String(d.country).toUpperCase() : null); })
        .catch(function () { finish(null); });
    } catch (e) {
      finish(null);
    }
  }

  // ---- The banner -------------------------------------------------------

  var box = null;

  function close() {
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
  }

  function style() {
    if (document.getElementById("bb-consent-style")) return;
    var s = document.createElement("style");
    s.id = "bb-consent-style";
    s.textContent = [
      ".bb-consent{position:fixed;left:0;right:0;bottom:0;z-index:9999;",
      "  background:#141a24;color:#fff;padding:16px 18px;",
      "  box-shadow:0 -6px 24px rgba(0,0,0,.28);",
      "  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;}",
      ".bb-consent .in{max-width:1040px;margin:0 auto;display:flex;gap:16px;",
      "  align-items:center;flex-wrap:wrap;}",
      ".bb-consent p{margin:0;flex:1 1 320px;font-size:14px;line-height:1.5;}",
      ".bb-consent a{color:#fff;text-decoration:underline;}",
      ".bb-consent .btns{display:flex;gap:10px;flex:0 0 auto;}",
      ".bb-consent button{font:inherit;font-size:14px;font-weight:600;",
      "  padding:11px 20px;border-radius:8px;cursor:pointer;margin:0;",
      "  border:1px solid rgba(255,255,255,.55);background:transparent;color:#fff;}",
      ".bb-consent button.yes{background:#D8393D;border-color:#D8393D;}",
      ".bb-cookie-link{font-size:13px;opacity:.75;text-decoration:underline;",
      "  cursor:pointer;background:none;border:0;padding:0;color:inherit;",
      "  font-family:inherit;}",
      "@media (max-width:560px){.bb-consent .btns{width:100%;}",
      "  .bb-consent .btns button{flex:1;}}"
    ].join("");
    document.head.appendChild(s);
  }

  // running === true when the pixel is already going, which is the case for
  // someone outside Europe who has opened this from the footer link. The
  // wording changes to match: they are turning something off, not deciding
  // whether to turn it on.
  function show(running) {
    if (box) return;
    style();

    var words = running
      ? 'We use Meta advertising cookies to see which of our ads bring ' +
        'people to our courses. They are not needed for the site to work. ' +
        'You can switch them off here. ' +
        '<a href="/privacy">Privacy notice</a>'
      : 'We use Meta advertising cookies to see which of our ads bring ' +
        'people to our courses. They are not needed for the site to work, ' +
        'and we do not set them unless you agree. ' +
        '<a href="/privacy">Privacy notice</a>';

    box = document.createElement("div");
    box.className = "bb-consent";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Cookies");
    box.innerHTML =
      '<div class="in">' +
        '<p>' + words + '</p>' +
        '<div class="btns">' +
          '<button type="button" class="no">' + (running ? "Switch off" : "Reject") + '</button>' +
          '<button type="button" class="yes">' + (running ? "Keep on" : "Accept") + '</button>' +
        '</div>' +
      '</div>';

    box.querySelector(".yes").onclick = function () { decide("yes"); };
    box.querySelector(".no").onclick = function () { decide("no"); };

    document.body.appendChild(box);
  }

  function openPanel() { show(allowed); }

  // ---- Changing your mind later ----------------------------------------
  // Dropped into the first <footer> on the page, or into any element with
  // id="cookie-settings" if a page wants to place it itself. This goes on
  // every page in every country — outside Europe it is the opt-out those
  // rules ask for, and inside it is the way back to a changed mind.

  function addLink() {
    var slot = document.getElementById("cookie-settings");
    var host = slot || document.querySelector("footer");
    if (!host || host.getAttribute("data-cookie-link") === "yes") return;

    var b = document.createElement("button");
    b.type = "button";
    b.className = "bb-cookie-link";
    b.textContent = "Cookie settings";
    b.onclick = function () { openPanel(); };

    if (slot) {
      slot.appendChild(b);
    } else {
      var wrap = document.createElement("div");
      wrap.style.cssText = "margin-top:10px;text-align:center;";
      wrap.appendChild(b);
      host.appendChild(wrap);
    }
    host.setAttribute("data-cookie-link", "yes");
  }

  // ---- Start ------------------------------------------------------------

  function start() {
    addLink();

    var answer = stored();

    // An explicit answer settles it everywhere. A no is a no in Texas as
    // much as in Toulouse.
    if (answer === "yes") { release(); return; }
    if (answer === "no") return;

    jurisdiction(function (verdict) {
      if (verdict === "allow") release();
      else show(false);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.bbConsent = {
    granted: granted,
    whenGranted: whenGranted,
    open: openPanel
  };
})();
