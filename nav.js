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

// ===== GTranslate language switcher =====
// Adds the language dropdown to the shared nav on every public page.
// Runs after the nav is built (above), and skips the /portal pages so the
// staff/coach area stays English-only.
(function () {
  "use strict";

  // Never show the translator on the staff/coach portal.
  if (String(window.location.pathname || "").toLowerCase().indexOf("/portal") === 0) return;

  function addGTranslate() {
    var nav = document.querySelector("nav.bb-topbar");
    if (nav && !nav.querySelector(".gtranslate_wrapper")) {
      var wrap = document.createElement("div");
      wrap.className = "gtranslate_wrapper";
      nav.append(wrap);
    }

    window.gtranslateSettings = {"default_language":"en","native_language_names":true,"detect_browser_language":true,"url_structure":"sub_domain","languages":["en","fr","it","es","de","zh-CN","cs","fi","nl","ja","ko","pl","pt","ca","hu","ar","ro","ru"],"wrapper_selector":".gtranslate_wrapper","flag_size":16,"switcher_horizontal_position":"inline","flag_style":"3d","switcher_text_color":"#f7f7f7","switcher_arrow_color":"#f2f2f2","switcher_border_color":"#161616","switcher_background_color":"#303030","switcher_background_shadow_color":"#474747","switcher_background_hover_color":"#3a3a3a","dropdown_text_color":"#eaeaea","dropdown_hover_color":"#748393","dropdown_background_color":"#474747"};

    var s = document.createElement("script");
    s.src = "https://cdn.gtranslate.net/widgets/latest/dwf.js";
    s.defer = true;
    document.body.appendChild(s);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addGTranslate);
  } else {
    addGTranslate();
  }
})();
