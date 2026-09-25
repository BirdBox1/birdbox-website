// portal/switch.js
//
// The "Programming portal" button, and the other half of it: signing a
// coach in here when they arrive from the programming portal.
//
// - On /portal/ it adds "Programming portal ↗" to the top of the Menu.
// - Sub-pages get the same entry through /portal/menu.js, which calls
//   openTrain() from here.
// - Arriving with ?bbswitch=<token> (sent by the programming portal's
//   own button), the token is exchanged for a session and the page
//   reloads clean, already signed in.
//
// The token itself comes from netlify/functions/portal-switch.mjs.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const db = createClient(
  "https://yvdmazpxtpuvidlcifnq.supabase.co",
  "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ"
);

const LABEL = "Programming portal ↗";

// ---------- arriving from the programming portal ----------

async function consumeSwitch() {
  const q = new URLSearchParams(location.search);
  const token = q.get("bbswitch");
  if (!token) return;

  // Take it out of the address bar straight away, used or not.
  q.delete("bbswitch");
  const clean = location.pathname + (q.toString() ? "?" + q : "") + location.hash;
  try { history.replaceState(null, "", clean); } catch (e) { /* ignore */ }

  const { error } = await db.auth.verifyOtp({ token_hash: token, type: "magiclink" });
  if (error) {
    console.error("Portal switch:", error.message);
    return;             // falls back to the normal sign-in screen
  }
  // The portal has already drawn itself as signed out, so start again.
  location.replace(clean);
}

// ---------- going to the programming portal ----------

export async function openTrain(el) {
  const was = el ? el.textContent : "";
  if (el) el.textContent = "Opening…";
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) throw new Error("Sign in first.");

    const res = await fetch("/.netlify/functions/portal-switch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ to: "train" }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.url) throw new Error(out.error || "Could not switch just now.");

    location.href = out.url;
  } catch (err) {
    if (el) {
      el.textContent = err.message;
      setTimeout(() => { el.textContent = was; }, 4000);
    }
  }
}

// ---------- the Menu entry on /portal/ itself ----------

function addToMainMenu() {
  const panel = document.getElementById("menupanel");
  if (!panel || document.getElementById("trainlink")) return;

  const a = document.createElement("a");
  a.id = "trainlink";
  a.className = "linkbtn";
  a.href = "#";
  a.textContent = LABEL;
  a.addEventListener("click", (e) => {
    e.preventDefault();
    openTrain(a);
  });
  panel.prepend(a);
}

consumeSwitch();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", addToMainMenu);
} else {
  addToMainMenu();
}
