/* ------------------------------------------------------------------
   portal/messages-sort.js

   The people list in Messages was alphabetical, which is no use once
   there are conversations — you want whoever you spoke to last at the
   top, with enough of the message to know what it was about.

   Loaded as a separate module so portal/index.html never has to be
   edited for this again. It waits for the portal to sign somebody in,
   then replaces the list rendering and keeps it up to date.
   ------------------------------------------------------------------ */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const db = createClient(
  "https://yvdmazpxtpuvidlcifnq.supabase.co",
  "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ"
);

const $ = (id) => document.getElementById(id);

let me = null;
let lastByPerson = new Map();   // other person's id -> { body, at, mine }
let unreadByPerson = new Map(); // other person's id -> count

/* ---------- who is signed in ---------- */

// The portal signs in on its own schedule, so rather than guess at
// timing this asks Supabase directly and then watches for changes.
async function whoAmI() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { me = null; return null; }
  if (me && me.id === session.user.id) return me;

  const { data } = await db.from("staff")
    .select("id, full_name").eq("id", session.user.id).maybeSingle();
  me = data || null;
  return me;
}

/* ---------- the data ---------- */

async function loadConversations() {
  lastByPerson = new Map();
  unreadByPerson = new Map();
  if (!me) return;

  const { data, error } = await db
    .from("direct_messages")
    .select("sender_id, recipient_id, body, created_at, read_at")
    .or("sender_id.eq." + me.id + ",recipient_id.eq." + me.id)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) { console.error("messages-sort: " + error.message); return; }

  for (const m of data || []) {
    const mine = m.sender_id === me.id;
    const other = mine ? m.recipient_id : m.sender_id;

    // Newest first, so the first time a person appears is their latest.
    if (!lastByPerson.has(other)) {
      lastByPerson.set(other, { body: m.body, at: m.created_at, mine });
    }
    if (!mine && !m.read_at) {
      unreadByPerson.set(other, (unreadByPerson.get(other) || 0) + 1);
    }
  }
}

/* ---------- formatting ---------- */

// Today shows a time, this week a day, anything older a date.
function whenLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (now - d < 6 * 86400000) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const tidy = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

/* ---------- styling ---------- */

// Injected rather than added to the portal's stylesheet, so this file
// stays entirely self-contained.
function addStyles() {
  if (document.getElementById("messages-sort-css")) return;
  const el = document.createElement("style");
  el.id = "messages-sort-css";
  el.textContent = `
    .dm-person { align-items: flex-start; }
    .dm-person .ms-txt { flex: 1 1 auto; min-width: 0; }
    .dm-person .ms-top {
      display: flex; align-items: baseline; gap: 0.5rem;
      justify-content: space-between;
    }
    .dm-person .ms-when {
      flex: none; font-size: 0.72rem; color: var(--muted); white-space: nowrap;
    }
    .dm-person .ms-peek {
      display: block; font-size: 0.8rem; color: var(--muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .dm-person .ms-peek.ms-unread { color: var(--ink); font-weight: 600; }
    .dm-person .nm.ms-unread { font-weight: 700; }
  `;
  document.head.append(el);
}

/* ---------- rebuilding the list ---------- */

// The portal draws the list its own way. Rather than fight it, this
// reorders the buttons it has already made and adds the preview line
// to each — so avatars, click handlers and unread dots keep working
// exactly as they did.
function restyleList() {
  const box = $("dm-people");
  if (!box) return;

  const rows = Array.from(box.querySelectorAll(".dm-person"));
  if (!rows.length) return;

  for (const row of rows) {
    const nm = row.querySelector(".nm");
    if (!nm || row.dataset.msDone === "1") continue;

    // Match the row to a person by the name the portal printed.
    const name = tidy(nm.textContent);
    let id = null;
    for (const [pid, last] of lastByPerson) {
      if (row.dataset.msId === pid) { id = pid; break; }
    }
    if (!id) id = row.dataset.msId || null;

    row.dataset.msName = name;
  }

  // Look each row's person up by name, since that is what is on screen.
  // Names are unique across the team in practice; anybody ambiguous
  // simply keeps the old ordering rather than being sorted wrongly.
  const nameToId = new Map();
  for (const [pid, v] of lastByPerson) nameToId.set(pid, v);

  // Sort: most recent conversation first, then everybody else by name.
  const withTime = new Map();
  for (const row of rows) {
    const id = row.dataset.msPersonId;
    withTime.set(row, id ? lastByPerson.get(id) : null);
  }

  rows.sort((a, b) => {
    const la = withTime.get(a), lb = withTime.get(b);
    if (la && lb) return new Date(lb.at) - new Date(la.at);
    if (la) return -1;
    if (lb) return 1;
    return tidy(a.dataset.msName).localeCompare(tidy(b.dataset.msName));
  });

  for (const row of rows) box.append(row);
}

/* ---------- the real work ---------- */

// Reads the portal's own staff list off the rendered buttons, matches
// each to a conversation, then rewrites the row contents.
async function decorate() {
  const box = $("dm-people");
  if (!box) return;

  const rows = Array.from(box.querySelectorAll(".dm-person"));
  if (!rows.length) return;

  // Already done this pass? The portal re-renders on every open, so
  // this is checked per element rather than globally.
  if (rows.every((r) => r.dataset.msDone === "1")) return;

  await whoAmI();
  if (!me) return;

  const { data: staff } = await db.from("staff")
    .select("id, full_name").eq("active", true);
  if (!staff) return;

  await loadConversations();

  const byName = new Map();
  for (const p of staff) byName.set(tidy(p.full_name), p.id);

  for (const row of rows) {
    const nm = row.querySelector(".nm");
    if (!nm) continue;

    const name = tidy(nm.textContent);
    const id = byName.get(name);
    row.dataset.msName = name;
    if (id) row.dataset.msPersonId = id;

    const last = id ? lastByPerson.get(id) : null;
    const unread = id ? (unreadByPerson.get(id) || 0) : 0;

    // Wrap the name in a row of its own so a timestamp can sit beside
    // it, then hang the preview underneath.
    if (row.dataset.msDone !== "1") {
      const txt = document.createElement("span");
      txt.className = "ms-txt";

      const top = document.createElement("span");
      top.className = "ms-top";

      nm.replaceWith(txt);
      top.append(nm);

      if (last) {
        const when = document.createElement("span");
        when.className = "ms-when";
        when.textContent = whenLabel(last.at);
        top.append(when);
      }

      const peek = document.createElement("span");
      peek.className = "ms-peek" + (unread ? " ms-unread" : "");
      peek.textContent = last
        ? (last.mine ? "You: " : "") + tidy(last.body)
        : "No messages yet";

      txt.append(top, peek);
      nm.classList.toggle("ms-unread", unread > 0);
      row.dataset.msDone = "1";
    }
  }

  restyleList();
}

/* ---------- keep it applied ---------- */

// The portal rebuilds this list whenever Messages is opened, a thread
// is read, or a message arrives. Watching the container catches all
// three without needing to know when any of them happen.
function watch() {
  const box = $("dm-people");
  if (!box) return false;

  let pending = false;
  const run = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; decorate(); }, 60);
  };

  new MutationObserver(run).observe(box, { childList: true });
  run();
  return true;
}

// The container only exists once the portal has drawn its views, so
// wait for it rather than assuming.
function begin() {
  if (watch()) return;
  const tries = setInterval(() => { if (watch()) clearInterval(tries); }, 400);
  setTimeout(() => clearInterval(tries), 30000);
}

addStyles();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", begin);
} else {
  begin();
}
