// portal/mentor/gate.js
//
// Lives under /portal/ so it opens inside the installed portal app (whose
// scope is /portal/) instead of throwing out to the browser.
//
// The mentor portal is being built (Nathan, 22 Nov 2026). Until it opens,
// only admins (staff.role = "admin": Nathan and Michaela) can get in.
// It uses the same sign-in as the seminars portal: same site, same
// Supabase session, so there is no second login.
//
// Everything on these pages is still example data. Real mentee data will
// come through server functions that check the same admin rule, so the
// lock does not depend on this file alone.
//
// Arriving from the programming portal with ?bbswitch=… is handled by
// /portal/switch.js, which signs the coach in and reloads the page.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm";
import "/portal/switch.js";

const db = createClient(
  "https://yvdmazpxtpuvidlcifnq.supabase.co",
  "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ"
);
window.MENTOR_DB = db;

const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

function shut(title, text, link) {
  const g = document.getElementById("gate");
  g.innerHTML = `<div class="gbox"><img src="/brand/birdbox-mark.png" alt="" width="64"><h1>${title}</h1><p>${text}</p>${link || ""}</div>`;
  g.classList.remove("hidden");
}

function open(staff) {
  document.documentElement.classList.remove("gated");
  window.MENTOR_STAFF = staff;
  window.dispatchEvent(new CustomEvent("mentor-ready", { detail: staff }));
}

(async () => {
  if (new URLSearchParams(location.search).has("bbswitch")) return; // switch.js reloads the page
  if (LOCAL) { open({ full_name: "Nathan Bird", role: "admin", local: true }); return; }

  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    shut("Sign in first", "The mentor portal uses your normal BirdBox portal sign-in.",
      `<a class="gbtn" href="/portal/">Go to the portal</a>`);
    return;
  }
  const { data: staff } = await db.from("staff")
    .select("full_name, role, active").eq("id", session.user.id).maybeSingle();
  if (!staff || staff.active === false || staff.role !== "admin") {
    shut("Not open yet", "The mentor portal is still being built. It will appear in your portal menu when it opens.",
      `<a class="gbtn" href="/portal/">Back to the portal</a>`);
    return;
  }
  open(staff);
})();
