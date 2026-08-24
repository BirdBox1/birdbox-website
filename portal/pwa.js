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
})();
