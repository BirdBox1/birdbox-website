/* ------------------------------------------------------------------
   portal/messages-refresh.js

   iOS suspends a home-screen web app and resumes it exactly as it was,
   so the portal never re-fetches and the thread silently stops
   updating. A coach sends an attachment from another device, comes
   back to the app, sees nothing, and concludes attachments are broken.

   This re-opens whichever conversation is on screen when the app comes
   back to the foreground, and again if a new message lands while it is
   open. Re-opening the thread is the portal's own code path, so
   nothing here needs to know how messages are drawn.

   Depends on messages-sort.js for data-ms-person-id on each row.
   ------------------------------------------------------------------ */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const db = createClient(
  "https://yvdmazpxtpuvidlcifnq.supabase.co",
  "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ"
);

const POLL_MS = 25000;   // how often to look for a new message
const MIN_GAP_MS = 2000; // never re-open more than this often

let openPersonId = null;
let openPersonName = null;
let lastIncoming = null;  // newest message received in the open thread
let lastReopen = 0;
let meId = null;

const tidy = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

/* ---------- which conversation is open ---------- */

// Capture phase, on the document, so it still works after the portal
// rebuilds the list and replaces every row element.
document.addEventListener("click", (e) => {
  const row = e.target && e.target.closest ? e.target.closest(".dm-person") : null;
  if (!row) return;

  const id = row.dataset.msPersonId || null;
  const nm = row.querySelector(".nm");
  const name = nm ? tidy(nm.textContent) : null;

  // A different person: start the new-message watch from scratch.
  if (id !== openPersonId || name !== openPersonName) lastIncoming = null;

  openPersonId = id;
  openPersonName = name;
}, true);

// Rows are re-created often, so find it fresh each time rather than
// holding on to an element that may since have been detached.
function findRow() {
  const box = document.getElementById("dm-people");
  if (!box) return null;

  if (openPersonId) {
    const hit = box.querySelector('.dm-person[data-ms-person-id="' + openPersonId + '"]');
    if (hit) return hit;
  }
  if (openPersonName) {
    for (const row of box.querySelectorAll(".dm-person")) {
      const nm = row.querySelector(".nm");
      if (nm && tidy(nm.textContent) === openPersonName) return row;
    }
  }
  return null;
}

/* ---------- re-opening it ---------- */

// Found by placeholder rather than id, so this keeps working if the
// compose box is ever moved or renamed.
function draftBox() {
  return document.querySelector(
    'textarea[placeholder^="Write a message"], input[placeholder^="Write a message"]'
  );
}

function reopen() {
  const now = Date.now();
  if (now - lastReopen < MIN_GAP_MS) return;

  const row = findRow();
  if (!row) return;   // not on Messages, or no thread open — nothing to do

  lastReopen = now;

  // Anything half-typed must survive the redraw.
  const box = draftBox();
  const draft = box ? box.value : "";

  row.click();

  if (draft) {
    setTimeout(() => {
      const b = draftBox();
      if (b && !b.value) b.value = draft;
    }, 700);
  }
}

/* ---------- coming back to the foreground ---------- */

function onResume() {
  if (document.hidden) return;
  reopen();
}

document.addEventListener("visibilitychange", onResume);
window.addEventListener("pageshow", onResume);
window.addEventListener("focus", onResume);

/* ---------- new message while it is open ---------- */

async function whoAmI() {
  const { data: { session } } = await db.auth.getSession();
  meId = session ? session.user.id : null;
  return meId;
}

async function checkForNew() {
  if (document.hidden || !openPersonId) return;
  if (!meId && !(await whoAmI())) return;

  const { data, error } = await db
    .from("direct_messages")
    .select("created_at")
    .eq("sender_id", openPersonId)
    .eq("recipient_id", meId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || !data.length) return;

  const at = data[0].created_at;

  // First look just records where things stand — no redraw.
  if (lastIncoming === null) { lastIncoming = at; return; }

  if (at > lastIncoming) {
    lastIncoming = at;
    reopen();
  }
}

setInterval(checkForNew, POLL_MS);
