/* ============================================================
   portal/hosts-link.js
   Adds "Host requests" to the portal menu, next to Discount codes,
   and puts a red count on it when new requests have come in.

   It copies whatever the Discount codes link is doing, so it shows
   for admins only and disappears on sign-out — no changes needed
   inside portal/index.html beyond loading this file.

   The count is the number of requests with seen_at still empty.
   Opening /portal/hosts/ marks them seen and the badge clears.
   ============================================================ */
(function () {
  var SUPABASE_URL = "https://yvdmazpxtpuvidlcifnq.supabase.co";
  var SUPABASE_KEY = "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ";

  var link = null;
  var db = null;

  function addLink() {
    var codes = document.getElementById("codeslink");
    if (!codes || document.getElementById("hostslink")) return false;

    link = document.createElement("a");
    link.id = "hostslink";
    link.href = "/portal/hosts/";
    link.textContent = "Host requests";
    link.className = codes.className;
    codes.insertAdjacentElement("afterend", link);

    // Mirror the Discount codes link, which the portal already shows
    // to admins only and hides again on sign-out.
    new MutationObserver(function () {
      link.className = codes.className;
      if (link.className.indexOf("hidden") > -1) clearFlag();
    }).observe(codes, { attributes: true, attributeFilter: ["class"] });

    return true;
  }

  function clearFlag() {
    if (!link) return;
    var old = link.querySelector(".unread-flag");
    if (old) old.remove();
  }

  function setFlag(count) {
    if (!link) return;
    clearFlag();
    if (!count) return;
    // Same badge the rest of the portal uses, so the Menu button's own
    // red dot picks it up without anything else being told about it.
    var flag = document.createElement("span");
    flag.className = "unread-flag";
    flag.textContent = count > 9 ? "9+" : String(count);
    link.append(flag);
  }

  async function client() {
    if (db) return db;
    var mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    db = mod.createClient(SUPABASE_URL, SUPABASE_KEY);
    return db;
  }

  async function refresh() {
    if (!link || link.className.indexOf("hidden") > -1) return;
    try {
      var sb = await client();
      var session = (await sb.auth.getSession()).data.session;
      if (!session) return clearFlag();

      var res = await sb
        .from("host_requests")
        .select("id", { count: "exact", head: true })
        .is("seen_at", null);

      if (res.error) return;          // not an admin, or nothing to show
      setFlag(res.count || 0);
    } catch (err) {
      console.error("Host request count:", err && err.message);
    }
  }

  function boot() {
    if (!addLink()) return;
    refresh();

    // The menu link is drawn once, so the count has to keep itself
    // honest: when the tab comes back, and when the portal is restored
    // from the back/forward cache.
    window.addEventListener("pageshow", function (e) { if (e.persisted) refresh(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refresh();
    });
    // Signing in happens after this file runs, so look again shortly.
    setTimeout(refresh, 2500);
    setInterval(refresh, 120000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
