/* ============================================================
   portal/hosts-link.js
   Adds "Host requests" to the portal menu, next to Discount codes.
   It copies whatever the Discount codes link is doing, so it shows
   for admins only and disappears on sign-out — no changes needed
   inside portal/index.html beyond loading this file.
   ============================================================ */
(function () {
  function add() {
    var codes = document.getElementById("codeslink");
    if (!codes || document.getElementById("hostslink")) return;

    var link = document.createElement("a");
    link.id = "hostslink";
    link.href = "/portal/hosts/";
    link.textContent = "Host requests";
    link.className = codes.className;
    codes.insertAdjacentElement("afterend", link);

    new MutationObserver(function () {
      link.className = codes.className;
    }).observe(codes, { attributes: true, attributeFilter: ["class"] });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", add);
  } else {
    add();
  }
})();
