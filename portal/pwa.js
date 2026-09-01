/* BirdBox Coaching Portal — home screen install.

   Loaded by every portal page. Adds the tags iOS and Android look for
   when somebody taps "Add to Home Screen", and registers the service
   worker. Done here rather than in each page's <head> so there is one
   file to change instead of five. */

(function () {
  "use strict";

  var THEME = "#0d0e10";   // the portal top bar

  function head() {
    return document.head || document.getElementsByTagName("head")[0];
  }

  function addLink(rel, href) {
    if (document.querySelector('link[rel="' + rel + '"]')) return;
    var el = document.createElement("link");
    el.rel = rel;
    el.href = href;
    head().appendChild(el);
  }

  function addMeta(name, content) {
    if (document.querySelector('meta[name="' + name + '"]')) return;
    var el = document.createElement("meta");
    el.name = name;
    el.content = content;
    head().appendChild(el);
  }

  addLink("manifest", "/manifest.json");
  addLink("apple-touch-icon", "/apple-touch-icon.png");

  addMeta("theme-color", THEME);
  addMeta("apple-mobile-web-app-capable", "yes");
  addMeta("mobile-web-app-capable", "yes");
  addMeta("apple-mobile-web-app-status-bar-style", "black");
  addMeta("apple-mobile-web-app-title", "BirdBox");

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/portal/sw.js")
        .catch(function (err) {
          // Never fatal — the portal works exactly as before without it.
          console.warn("Service worker did not register:", err);
        });
    });
  }

  /* ---------------- noticing a new version ---------------- */

  // Added to a home screen, iOS suspends the app and resumes it exactly
  // as it was. Nothing is fetched, so the code running is whatever was
  // loaded the day it was opened — a coach can be a week behind and
  // have no way of knowing. Fully closing the app is currently the only
  // thing that picks up a deploy.
  //
  // So on returning to the app we ask the server whether index.html has
  // changed since we loaded it. HEAD is not a GET, so the service
  // worker passes it straight through to the network. If the tag has
  // moved, a new version has been deployed.
  //
  // It offers rather than reloads: somebody may be halfway through
  // typing a message, and taking that away to install an update nobody
  // asked for would be its own bug.

  var CHECK_URL = "/portal/index.html";
  var MIN_GAP_MS = 60000;   // never ask the server more often than this
  var loadedTag = null;
  var lastCheck = 0;
  var offered = false;

  function tagOf(res) {
    if (!res) return null;
    return res.headers.get("etag") || res.headers.get("last-modified") || null;
  }

  // Exposed so it can be tested without a network.
  function isNewer(before, now) {
    if (!before || !now) return false;   // nothing to compare — say nothing
    return before !== now;
  }

  function offerReload() {
    if (offered || document.getElementById("bb-update-bar")) return;
    offered = true;

    var bar = document.createElement("div");
    bar.id = "bb-update-bar";
    bar.style.cssText =
      "position:fixed;left:50%;bottom:1.1rem;transform:translateX(-50%);z-index:200;" +
      "display:flex;gap:0.8rem;align-items:center;background:#0d0e10;color:#fff;" +
      "border-radius:8px;padding:0.7rem 0.9rem;box-shadow:0 10px 30px rgba(0,0,0,0.3);" +
      "font:inherit;font-size:0.9rem;max-width:calc(100vw - 2rem)";

    var text = document.createElement("span");
    text.textContent = "A newer version of the portal is available.";

    var go = document.createElement("button");
    go.type = "button";
    go.textContent = "Reload";
    go.style.cssText =
      "font:inherit;font-size:0.85rem;font-weight:600;background:#fff;color:#0d0e10;" +
      "border:0;border-radius:4px;padding:0.35rem 0.8rem;cursor:pointer";
    go.onclick = function () { location.reload(); };

    var later = document.createElement("button");
    later.type = "button";
    later.textContent = "Later";
    later.style.cssText =
      "font:inherit;font-size:0.85rem;background:none;color:#b9c0c7;" +
      "border:0;padding:0.35rem;cursor:pointer";
    later.onclick = function () { bar.remove(); };

    bar.appendChild(text);
    bar.appendChild(go);
    bar.appendChild(later);
    document.body.appendChild(bar);
  }

  function checkVersion() {
    if (document.hidden) return;
    var now = Date.now();
    if (now - lastCheck < MIN_GAP_MS) return;
    lastCheck = now;

    fetch(CHECK_URL, { method: "HEAD", cache: "no-store" })
      .then(function (res) {
        var tag = tagOf(res);
        if (!tag) return;                       // no tag served — nothing to do
        if (loadedTag === null) { loadedTag = tag; return; }   // first look
        if (isNewer(loadedTag, tag)) offerReload();
      })
      .catch(function () { /* offline: not worth saying anything */ });

    // Give the worker a nudge at the same time, so the next real load
    // is already holding the new files.
    if ("serviceWorker" in navigator && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.update) reg.update();
      }).catch(function () {});
    }
  }

  // Record where we stand as soon as the page is up, then look again
  // each time somebody comes back to it.
  window.addEventListener("load", function () {
    lastCheck = 0;
    checkVersion();
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) checkVersion();
  });
  window.addEventListener("pageshow", checkVersion);
  window.addEventListener("focus", checkVersion);

  window.__birdboxVersionCheck = { isNewer: isNewer, offerReload: offerReload };
})();
