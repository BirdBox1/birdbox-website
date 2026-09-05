// Cookie consent for birdboxcoaching.com.
//
// The Meta pixel loads from two places — nav.js on every page with the top
// bar, and pixel.js on the course and registration-complete pages, which do
// not carry the nav. Both now ask this file first and neither loads anything
// until the visitor has said yes.
//
// Nothing here needs adding to a page. nav.js and pixel.js pull this file in
// themselves, so every page that already loads one of them is covered.
//
// The rules this is written to:
//   - No non-essential cookie or tracker fires before consent
//   - Reject is exactly as easy as Accept — same size, same prominence
//   - The choice can be changed later, from a link in the footer
//   - Doing nothing counts as no
//
// Supabase, Netlify and Stripe are not gated: they are doing what the
// visitor asked for, which needs no consent.
(function () {
  "use strict";

  var KEY = "bb-consent";        // "yes" | "no"
  var waiting = [];              // callbacks held until a yes

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function remember(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* private mode */ }
  }

  function granted() { return stored() === "yes"; }

  // Everything the pixel wants to do goes through here. Called immediately
  // if they have already agreed, on the click if they agree now, never
  // otherwise.
  function whenGranted(fn) {
    if (typeof fn !== "function") return;
    if (granted()) { fn(); return; }
    waiting.push(fn);
  }

  function release() {
    var list = waiting.slice();
    waiting.length = 0;
    for (var i = 0; i < list.length; i++) {
      try { list[i](); } catch (e) { /* one failure must not stop the rest */ }
    }
  }

  // Saying no after saying yes cannot un-send what Meta already has, so the
  // page reloads — that clears the pixel out of memory and stops anything
  // further being sent.
  function decide(value) {
    var was = stored();
    remember(value);
    close();
    if (value === "yes") release();
    else if (was === "yes") location.reload();
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

  function show() {
    if (box) return;
    style();

    box = document.createElement("div");
    box.className = "bb-consent";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Cookies");
    box.innerHTML =
      '<div class="in">' +
        '<p>We use Meta advertising cookies to see which of our ads bring ' +
        'people to our courses. They are not needed for the site to work, ' +
        'and we do not set them unless you agree. ' +
        '<a href="/privacy">Privacy notice</a></p>' +
        '<div class="btns">' +
          '<button type="button" class="no">Reject</button>' +
          '<button type="button" class="yes">Accept</button>' +
        '</div>' +
      '</div>';

    box.querySelector(".yes").onclick = function () { decide("yes"); };
    box.querySelector(".no").onclick = function () { decide("no"); };

    document.body.appendChild(box);
  }

  // ---- Changing your mind later ----------------------------------------
  // Dropped into the first <footer> on the page, or into any element with
  // id="cookie-settings" if a page wants to place it itself.

  function addLink() {
    var slot = document.getElementById("cookie-settings");
    var host = slot || document.querySelector("footer");
    if (!host || host.getAttribute("data-cookie-link") === "yes") return;

    var b = document.createElement("button");
    b.type = "button";
    b.className = "bb-cookie-link";
    b.textContent = "Cookie settings";
    b.onclick = function () { show(); };

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
    if (!stored()) show();     // no answer yet, and no answer means no
    addLink();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.bbConsent = {
    granted: granted,
    whenGranted: whenGranted,
    open: show
  };

  // Anything that asked before this file finished loading is picked up here.
  if (granted()) release();
})();
