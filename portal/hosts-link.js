/* ============================================================
   portal/hosts-link.js
   Adds "Online courses", "Host requests", "Trainer directory" and
   "Staff Pathway" to the portal menu, next to Discount codes, and puts a
   red count on the last three when new requests, directory listings or
   Staff Pathway applications have come in.

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
  var dirLink = null;
  var pathLink = null;
  var db = null;

  function addLink() {
    var codes = document.getElementById("codeslink");
    if (!codes || document.getElementById("hostslink")) return false;

    // "Online courses" (BirdBox Learn admin) goes just above Discount
    // codes and follows the same admin-only show/hide.
    var learn = document.createElement("a");
    learn.id = "learnlink";
    learn.href = "/portal/learn/";
    learn.textContent = "Online courses";
    learn.className = codes.className;
    // Each goes into its group in the menu (Courses or People); the
    // fallback is next to Discount codes, where they always sat.
    var courses = document.getElementById("mg-courses");
    var people = document.getElementById("mg-people");
    if (courses) courses.appendChild(learn); else codes.insertAdjacentElement("beforebegin", learn);
    new MutationObserver(function () { learn.className = codes.className; })
      .observe(codes, { attributes: true, attributeFilter: ["class"] });

    link = document.createElement("a");
    link.id = "hostslink";
    link.href = "/portal/hosts/";
    link.textContent = "Host requests";
    link.className = codes.className;
    var peopleHead = people && people.querySelector(".mhead");
    if (peopleHead) peopleHead.insertAdjacentElement("afterend", link); else codes.insertAdjacentElement("afterend", link);

    dirLink = document.createElement("a");
    dirLink.id = "directorylink";
    dirLink.href = "/portal/directory/";
    dirLink.textContent = "Trainer directory";
    dirLink.className = codes.className;
    link.insertAdjacentElement("afterend", dirLink);

    pathLink = document.createElement("a");
    pathLink.id = "pathwaylink";
    pathLink.href = "/portal/staff-pathway/";
    pathLink.textContent = "Staff Pathway";
    pathLink.className = codes.className;
    dirLink.insertAdjacentElement("afterend", pathLink);
    // In the People group they read Staff Pathway, Trainer directory,
    // Host requests, then Message the team.
    if (peopleHead) peopleHead.after(pathLink, dirLink, link);

    // Mirror the Discount codes link, which the portal already shows
    // to admins only and hides again on sign-out.
    new MutationObserver(function () {
      link.className = codes.className;
      dirLink.className = codes.className;
      pathLink.className = codes.className;
      if (link.className.indexOf("hidden") > -1) { clearFlag(link); clearFlag(dirLink); clearFlag(pathLink); }
    }).observe(codes, { attributes: true, attributeFilter: ["class"] });

    return true;
  }

  function clearFlag(el) {
    if (!el) return;
    var old = el.querySelector(".unread-flag");
    if (old) old.remove();
  }

  function setFlag(el, count) {
    if (!el) return;
    clearFlag(el);
    if (!count) return;
    // Same badge the rest of the portal uses, so the Menu button's own
    // red dot picks it up without anything else being told about it.
    var flag = document.createElement("span");
    flag.className = "unread-flag";
    flag.textContent = count > 9 ? "9+" : String(count);
    el.append(flag);
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
      if (!session) { clearFlag(link); clearFlag(dirLink); clearFlag(pathLink); return; }

      var res = await sb
        .from("host_requests")
        .select("id", { count: "exact", head: true })
        .is("seen_at", null);

      if (res.error) return;          // not an admin, or nothing to show
      setFlag(link, res.count || 0);

      // New listings, a coach asking for an older course to be checked, or
      // a contact request the screening held back.
      var dir = await sb
        .from("directory_profiles")
        .select("id", { count: "exact", head: true })
        .is("seen_at", null);
      var held = await sb
        .from("directory_contact_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "held");
      if (!dir.error) setFlag(dirLink, (dir.count || 0) + (held.error ? 0 : held.count || 0));

      // Staff Pathway applications nobody has opened the review page for yet.
      var apps = await sb
        .from("staff_pathway_applications")
        .select("id", { count: "exact", head: true })
        .is("seen_at", null);
      if (!apps.error) setFlag(pathLink, apps.count || 0);
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
