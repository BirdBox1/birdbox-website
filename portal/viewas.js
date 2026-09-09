/* ============================================================
   portal/viewas.js
   Lets an admin drop into coach view, so the portal shows only the
   courses they are actually allocated to and only the coach tools.
   Nothing changes in the database and nothing changes for anybody
   else — it is a switch on this device, remembered until it is
   switched back.

   How it works: this is a classic script, so it runs before the
   portal's own module. It sets window.bbCoachView first, and the
   portal's two admin checks read it.

   Not a security feature. An admin still has admin permissions in
   the database; this only changes what they are shown.
   ============================================================ */
(function () {
  var KEY = "bb_view_as_coach";
  var SUPABASE_URL = "https://yvdmazpxtpuvidlcifnq.supabase.co";
  var SUPABASE_KEY = "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ";

  function read() {
    try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }

  // Set synchronously, before the portal module runs.
  window.bbCoachView = read();

  function setView(on) {
    try {
      if (on) localStorage.setItem(KEY, "1");
      else localStorage.removeItem(KEY);
    } catch (e) { /* private mode: the switch just will not stick */ }
    location.reload();
  }
  window.bbSetCoachView = setView;

  var CSS = ""
    + ".bb-viewas{margin-top:.5rem;font:inherit;font-size:.75rem;letter-spacing:.06em;"
    + "text-transform:uppercase;background:rgba(255,255,255,.10);color:#fff;"
    + "border:1px solid rgba(255,255,255,.35);padding:.32rem .7rem;border-radius:3px;"
    + "cursor:pointer;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}"
    + ".bb-viewas:hover{background:rgba(255,255,255,.20)}"
    + ".bb-viewas.on{background:#c9a227;border-color:#c9a227;color:#141414;font-weight:650}";

  function style() {
    if (document.getElementById("bb-viewas-css")) return;
    var s = document.createElement("style");
    s.id = "bb-viewas-css";
    s.textContent = CSS;
    document.head.append(s);
  }

  function draw() {
    if (document.getElementById("viewasbtn")) return true;
    var caption = document.querySelector("#view-courses .banner .caption");
    if (!caption) return false;

    style();

    var b = document.createElement("button");
    b.id = "viewasbtn";
    b.type = "button";
    b.className = "bb-viewas" + (window.bbCoachView ? " on" : "");
    b.textContent = window.bbCoachView
      ? "Coach view — switch back to admin"
      : "Switch to coach view";
    b.onclick = function () { setView(!window.bbCoachView); };
    caption.append(b);

    // The role line still reads from the staff row, so say plainly
    // which view this is rather than leaving it saying "admin".
    if (window.bbCoachView) {
      var role = document.getElementById("myrole");
      if (role) role.textContent = "admin · coach view";
    }
    return true;
  }

  var db = null;
  async function client() {
    if (db) return db;
    var mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    db = mod.createClient(SUPABASE_URL, SUPABASE_KEY);
    return db;
  }

  // In coach view every other admin signal on the page is hidden, so
  // the staff row is the only way left to know the button belongs here.
  async function check() {
    if (document.getElementById("viewasbtn")) return;
    try {
      var sb = await client();
      var session = (await sb.auth.getSession()).data.session;
      if (!session) return;

      var res = await sb.from("staff").select("role")
        .eq("id", session.user.id).maybeSingle();
      if (res.error || !res.data || res.data.role !== "admin") return;

      draw();
    } catch (err) {
      console.error("Coach view switch:", err && err.message);
    }
  }

  function boot() {
    check();
    // Signing in happens after this file runs, so look again.
    setTimeout(check, 2500);
    setTimeout(check, 6000);
    window.addEventListener("pageshow", function (e) { if (e.persisted) check(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
