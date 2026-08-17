// Shared site navigation.
//
// Every page carries an empty <nav class="bb-topbar"></nav> and loads this
// file. Change the LINKS list below and the nav updates everywhere on the
// next deploy — one file, one commit.
//
// The nav styling still lives in each page's own <style> block, because it
// differs slightly between the dark pages and the portal. This script only
// fills in the links, so nothing visual changes when a page is converted.

(function () {
  "use strict";

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
