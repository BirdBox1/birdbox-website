// The "Join Coaches Worldwide" box at the foot of the home, TGC and TCC pages.
// Sends the email to /.netlify/functions/newsletter-signup, which saves it and
// adds it to the Brevo list (Nathan, 8 Nov 2026).
//
// <script src="/newsletter.js" data-brand="tgc" defer></script>
(function () {
  var me = document.currentScript;
  var brand = (me && me.getAttribute("data-brand")) || "birdbox";
  function start() {
    var box = document.querySelector(".bb-signup");
    var input = document.getElementById("bb-email");
    var btn = document.getElementById("bb-signup-btn");
    var note = document.getElementById("bb-signup-note");
    if (!box || !input || !btn || !note) return;

    // a field people never see; bots fill it in
    var trap = document.createElement("input");
    trap.type = "text"; trap.name = "website"; trap.tabIndex = -1; trap.autocomplete = "off";
    trap.setAttribute("aria-hidden", "true");
    trap.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0";
    box.appendChild(trap);

    var busy = false;
    function send() {
      if (busy) return;
      var email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        note.textContent = "Please enter a valid email address.";
        input.focus();
        return;
      }
      busy = true; btn.disabled = true;
      note.textContent = "Signing you up…";
      fetch("/.netlify/functions/newsletter-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, brand: brand, page: location.pathname, website: trap.value })
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          if (x.ok && x.d.ok) {
            note.textContent = "Thanks, you’re on the list. Look out for our emails.";
            input.value = "";
          } else {
            note.textContent = x.d.error || "Sorry, that didn’t save. Please try again in a minute.";
          }
        })
        .catch(function () { note.textContent = "Sorry, that didn’t save. Please check your connection and try again."; })
        .then(function () { busy = false; btn.disabled = false; });
    }
    btn.addEventListener("click", send);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); send(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
