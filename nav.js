// Shared site navigation.
//
// Every page carries an empty <nav class="bb-topbar"></nav> and loads this
// file. Change the LINKS list below and the nav updates everywhere on the
// next deploy — one file, one commit.
//
// The nav styling still lives in each page's own <style> block, because it
// differs slightly between the dark pages and the portal. This script only
// fills in the links, so nothing visual changes when a page is converted.
//
// The Meta pixel also loads from here, so every page that carries the nav
// reports a PageView. Dataset 2663209040595150, owned by the BirdBox
// Coaching business portfolio. It now waits for consent — see consent.js,
// which this file pulls in itself, so no page needs changing.
(function () {
  "use strict";

  // ---- Consent gate -----------------------------------------------------
  // Nothing to do with advertising runs until the visitor has agreed. This
  // loads consent.js if it is not already on the page and holds the work
  // until then; no answer, or a no, means the callback never runs.
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

  // ---- Meta pixel -------------------------------------------------------
  // Guarded so that a page which also hard-codes the pixel does not load it
  // twice and count every visit as two.
  withConsent(function () {
    if (window.fbq) return;
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
  });

  // ---- Navigation -------------------------------------------------------
  var LINKS = [
    { href: "/merch", text: "Merch Store" },
    { href: "/blog", text: "Blog" },
    { href: "/trainer-directory", text: "Trainer Directory" },
    { href: "/birdbox-team/", text: "Meet the Team" },
    { href: "/about", text: "About" }
  ];
  // "/tcc/level-1/" and "/tcc/level-1" are the same page. Trailing slashes
  // are stripped so the active check does not depend on how the visitor
  // happened to type the address. The site root stays as "/".
  function tidy(path) {
    var p = String(path || "").split("?")[0].split("#")[0];
    p = p.replace(/\/index\.html$/, "/");
    if (p.length > 1) p = p.replace(/\/+$/, "");
    return p || "/";
  }
  function isCurrent(href, here) {
    var target = tidy(href);
    if (target === here) return true;
    // A section link stays lit on pages beneath it, so /birdbox-team/
    // is marked current while reading a page inside that folder.
    return target !== "/" && here.indexOf(target + "/") === 0;
  }
  function build() {
    var nav = document.querySelector("nav.bb-topbar");
    if (!nav) return;
    // Guard against a page that both ships hard-coded links and loads this
    // file during the changeover, which would otherwise show them twice.
    if (nav.getAttribute("data-nav-built") === "yes") return;
    var here = tidy(window.location.pathname);
    nav.textContent = "";
    for (var i = 0; i < LINKS.length; i++) {
      var item = LINKS[i];
      var a = document.createElement("a");
      a.href = item.href;
      a.textContent = item.text;
      if (isCurrent(item.href, here)) {
        a.className = "is-active";
        a.setAttribute("aria-current", "page");
      }
      nav.append(a);
    }
    nav.setAttribute("data-nav-built", "yes");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
