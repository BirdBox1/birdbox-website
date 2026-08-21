// The portal menu, shared by every page except /portal/ itself
// (which has its own, with the unread counts on it).
//
// Each sub-page was written with its own header and a "back to the
// portal" link where the menu should be. This removes that link and
// puts the real menu there, so navigation works from anywhere.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const db = createClient(
  "https://yvdmazpxtpuvidlcifnq.supabase.co",
  "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ"
);

// admin: only shown to an admin. The rest everybody gets.
// Messages is a view inside the portal rather than a page of its own,
// so it is reached with ?view= and the portal opens straight onto it.
const LINKS = [
  { href: "/portal/",             label: "All courses" },
  { href: "/portal/blog/",        label: "Blog" },
  { href: "/portal/feedback/",    label: "Feedback" },
  { href: "/portal/documents/",   label: "My documents" },
  { href: "/portal/agreements/",  label: "Agreements" },
  { href: "/portal/availability/",label: "My availability" },
  { href: "/portal/reflections/", label: "Reflections" },
  { href: "/portal/workshops/",   label: "Workshops" },
  { href: "/portal/codes/",       label: "Discount codes", admin: true },
  { href: "/portal/?view=messages", label: "Messages" },
  { href: "/portal/broadcast/",   label: "Message the team", admin: true },
  { href: "/portal/planner/",     label: "Seminar planner", admin: true },
  { href: "/portal/year/",        label: "Scheduling planner" },
  { href: "/portal/competitors/", label: "Their courses", admin: true },
  { href: "/portal/markets/",     label: "Where to go", admin: true },
  { href: "/portal/change-password/", label: "Change password" },
];

const CSS = `
.bbm-bar { position: relative; }
.bbm-btn {
  margin-left: auto; font: inherit; font-size: 0.8rem;
  background: none; color: #cfd4d9; border: 1px solid #33373c;
  padding: 0.3rem 0.7rem; border-radius: 3px; cursor: pointer;
  white-space: nowrap; flex: none;
}
.bbm-btn:hover { color: #fff; border-color: #55595e; }
.bbm-panel {
  position: fixed; right: 0.9rem; z-index: 200;
  background: #0d0e10; border: 1px solid #33373c; border-radius: 6px;
  padding: 0.35rem; min-width: 13rem; max-height: 80vh; overflow-y: auto;
  display: flex; flex-direction: column;
  box-shadow: 0 14px 34px rgba(0,0,0,0.4);
}
.bbm-panel a, .bbm-panel button {
  display: block; width: 100%; text-align: left; border: 0;
  border-radius: 4px; padding: 0.5rem 0.65rem; font: inherit;
  font-size: 0.88rem; color: #cfd4d9; background: none;
  text-decoration: none; white-space: nowrap; cursor: pointer;
}
.bbm-panel a:hover, .bbm-panel button:hover { background: #1c1e21; color: #fff; }
.bbm-panel a.here { color: #fff; font-weight: 650; }
.bbm-who {
  padding: 0.6rem 0.65rem 0.4rem; margin-top: 0.35rem;
  border-top: 1px solid #33373c; font-size: 0.78rem; color: #9aa1a9;
}
.bbm-hidden { display: none !important; }

/* Below 737px the button stops fighting the logo for the row
   and drops underneath it. */
@media (max-width: 46rem) {
  .bbm-bar { flex-wrap: wrap; row-gap: 0.5rem; }
  .bbm-btn { flex: 1 1 100%; margin-left: 0; order: 9; }
  .bbm-panel { right: 0.9rem; left: 0.9rem; min-width: 0; }
}`;

// The header each page happens to have, found by the back link it
// carries rather than by a class name — they are not consistent.
function findBar() {
  const back = Array.from(document.querySelectorAll("a")).find((a) => {
    const h = (a.getAttribute("href") || "").replace(/\/+$/, "");
    const t = (a.textContent || "").trim().toLowerCase();
    return h === "/portal" || /back to the portal|back to portal|^←\s*portal$/.test(t);
  });
  if (back) {
    const bar = back.parentElement;
    back.remove();
    return bar;
  }
  return document.querySelector(".bar");
}

function build() {
  // The main portal has its own menu with the unread counts on it.
  if (document.getElementById("menubtn")) return;

  const bar = findBar();
  if (!bar) return;
  bar.classList.add("bbm-bar");

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bbm-btn";
  btn.textContent = "Menu";
  bar.appendChild(btn);

  const panel = document.createElement("div");
  panel.className = "bbm-panel bbm-hidden";
  const here = location.pathname.replace(/\/+$/, "") || "/portal";

  for (const l of LINKS) {
    const a = document.createElement("a");
    a.href = l.href;
    a.textContent = l.label;
    if (l.admin) a.dataset.admin = "1";
    // Query strings never mark the page you are on — only real paths.
    if (!l.href.includes("?") && l.href.replace(/\/+$/, "") === here) {
      a.className = "here";
    }
    panel.appendChild(a);
  }

  const who = document.createElement("div");
  who.className = "bbm-who";
  panel.appendChild(who);

  const out = document.createElement("button");
  out.type = "button";
  out.textContent = "Sign out";
  out.onclick = async () => {
    await db.auth.signOut();
    location.href = "/portal/";
  };
  panel.appendChild(out);

  document.body.appendChild(panel);

  const close = () => panel.classList.add("bbm-hidden");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Sits under the bar wherever the bar happens to be.
    panel.style.top = (bar.getBoundingClientRect().bottom + 6) + "px";
    panel.classList.toggle("bbm-hidden");
  });
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // Admin-only entries stay out of sight until we know who this is.
  db.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) return;
    const { data: staff } = await db.from("staff")
      .select("full_name, role").eq("id", session.user.id).maybeSingle();
    if (!staff) return;
    who.textContent = staff.full_name;
    if (staff.role !== "admin") {
      panel.querySelectorAll('[data-admin="1"]').forEach((a) => a.remove());
    }
  });
}

build();
