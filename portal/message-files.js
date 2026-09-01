/* portal/message-files.js
 *
 * Attachments on the one-to-one Messages view.
 *
 * Coaches are asked to report portal problems with clear text and a
 * screenshot. Until now the screenshot had nowhere to go, which in
 * practice meant it did not get sent.
 *
 * It also carries three smaller things the Messages view was missing:
 * a draft that survives leaving the page, a search over the names, and
 * a way to see everything shared in one conversation.
 *
 * Nothing here reaches into portal/index.html. It watches for the
 * Messages view opening and adds to it. If the portal changes
 * underneath it, the additions simply do not appear.
 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// A phone keyboard has no shift key, so Enter-to-send leaves no way to
// start a second line. The portal treats Enter as a new line on a touch
// screen; these two listeners have to agree with it or Enter would
// still send.
const TOUCH_INPUT = (() => {
  try { return window.matchMedia("(pointer: coarse)").matches; }
  catch (e) { return false; }
})();


const SUPABASE_URL = "https://yvdmazpxtpuvidlcifnq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ";

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// A screenshot off a phone is three or four megabytes and nobody needs
// it at full size to read an error message. A PDF is left alone.
const SHOT_MAX_PX = 1600;
const SHOT_QUALITY = 0.85;
const MAX_BYTES = 15 * 1024 * 1024;

let me = null;
let pending = null;      // the file chosen but not yet sent
let lastThread = null;   // who the box was last typed into
let showingFiles = false;
let mountingFiles = false;

/* ---------- who is signed in ---------- */

async function whoAmI() {
  if (me) return me;
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const { data } = await db.from("staff")
    .select("id, full_name, role").eq("id", session.user.id).maybeSingle();
  me = data || null;
  return me;
}

/* ---------- shrinking ---------- */

function shrink(file) {
  return new Promise((resolve) => {
    if (!/^image\//.test(file.type)) { resolve(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, SHOT_MAX_PX / Math.max(img.width, img.height));
      if (scale === 1) { resolve(file); return; }
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", SHOT_QUALITY);
    };
    // Anything unreadable as an image is sent exactly as it is rather
    // than refused — a screenshot is more use than a rule.
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

/* ---------- who the thread is with ---------- */

// The portal keeps this in its own scope, so it is read off the heading
// the page already prints. Matched against the team list rather than
// trusted as a name.
let staffList = [];

async function loadStaff() {
  if (staffList.length) return staffList;
  const { data } = await db.from("staff")
    .select("id, full_name").eq("active", true);
  staffList = data || [];
  return staffList;
}

async function currentThread() {
  const heading = $("dm-with");
  if (!heading) return null;

  // Only the text the portal itself wrote. The Files button lives in
  // this same heading, so reading textContent would ask for somebody
  // called "Michaela DotterweichFiles" and find nobody.
  let name = "";
  for (const node of heading.childNodes || []) {
    if (node.nodeType === 3) name += node.textContent || "";
  }
  name = name.trim();
  if (!name) name = (heading.textContent || "").replace(/Files$|Back to messages$/, "").trim();

  if (!name || name.startsWith("Choose")) return null;
  await loadStaff();
  const hit = staffList.find((s) => s.full_name === name);
  return hit ? hit.id : null;
}

/* ---------- drafts ---------- */

// Half a message written, then off to the portal to find a discount
// code, and back to an empty box. Kept on this device only: the loss
// being solved is leaving the page, not moving between devices.

const draftKey = (to) => "bb.dm.draft." + (me ? me.id : "?") + "." + to;

function saveDraft(to, text) {
  if (!to) return;
  try {
    if (text && text.trim()) localStorage.setItem(draftKey(to), text);
    else localStorage.removeItem(draftKey(to));
  } catch (e) { /* private browsing, or a full disk */ }
}

function readDraft(to) {
  try { return localStorage.getItem(draftKey(to)) || ""; }
  catch (e) { return ""; }
}

async function wireDraft() {
  const box = $("dm-box");
  if (!box || box.dataset.draftWired) return;
  box.dataset.draftWired = "1";

  box.addEventListener("input", async () => {
    const to = await currentThread();
    if (to) { lastThread = to; saveDraft(to, box.value); }
  });

  // Sending clears it, otherwise the draft outlives the message.
  const clear = async () => {
    const to = lastThread || (await currentThread());
    if (to) saveDraft(to, "");
  };
  const send = $("dm-send");
  if (send) send.addEventListener("click", () => setTimeout(clear, 300));
  box.addEventListener("keydown", (e) => {
    if (TOUCH_INPUT) return;
    if (e.key === "Enter" && !e.shiftKey) setTimeout(clear, 300);
  });
}

// Called whenever the thread changes, so the box shows that person's
// unfinished message rather than the last one typed anywhere.
async function restoreDraft() {
  const box = $("dm-box");
  if (!box) return;
  const to = await currentThread();
  if (!to || to === lastThread) return;
  lastThread = to;

  // A new conversation starts on its messages, not on the last
  // person's file list.
  if (showingFiles) {
    showingFiles = false;
    const panel = document.getElementById("dmf-panel");
    if (panel) panel.remove();
    const list = $("dm-list");
    if (list) list.style.display = "";
  }
  const draft = readDraft(to);
  // Never write over something already in the box.
  if (draft && !box.value) box.value = draft;
}

/* ---------- searching the names ---------- */

// Twenty-eight people is enough to scroll past the one you want.

const SEARCH_ID = "dmf-search";

function mountSearch() {
  const people = $("dm-people");
  if (!people || document.getElementById(SEARCH_ID)) return;

  const box = document.createElement("input");
  box.id = SEARCH_ID;
  box.type = "text";
  box.placeholder = "Search the team";
  box.setAttribute("autocomplete", "off");
  box.style.cssText =
    "width:100%;font:inherit;font-size:0.88rem;padding:0.4rem 0.6rem;" +
    "border:1px solid var(--rule);border-radius:4px;background:#fff;" +
    "margin-bottom:0.5rem";

  box.addEventListener("input", () => filterPeople(box.value));

  people.parentNode.insertBefore(box, people);
}

function filterPeople(term) {
  const people = $("dm-people");
  if (!people) return;
  const q = String(term || "").trim().toLowerCase();
  for (const row of people.querySelectorAll(".dm-person")) {
    const name = (row.textContent || "").toLowerCase();
    row.style.display = !q || name.includes(q) ? "" : "none";
  }
}

/* ---------- everything shared in one conversation ---------- */

const FILES_ID = "dmf-shared";

async function mountFilesLink() {
  const heading = $("dm-with");
  if (!heading) return;

  // The observer fires several times in a row, and this function waits
  // on a lookup before it appends. Without a guard taken BEFORE the
  // wait, every one of those calls passes the "is it there?" test and
  // five buttons appear. The flag is set synchronously; the check
  // inside the heading is repeated afterwards for the same reason.
  if (mountingFiles) return;
  if (heading.querySelector && heading.querySelector("." + FILES_ID)) return;

  mountingFiles = true;
  try {
    const to = await currentThread();
    if (!to) return;
    if (heading.querySelector && heading.querySelector("." + FILES_ID)) return;

    // Belt and braces: anything left over from an earlier race goes.
    for (const old of heading.querySelectorAll("." + FILES_ID)) old.remove();

    const link = document.createElement("button");
    link.id = FILES_ID;
    link.className = "btn ghost tiny " + FILES_ID;
    link.type = "button";
    link.style.cssText = "margin-left:0.6rem;vertical-align:middle";
    link.textContent = showingFiles ? "Back to messages" : "Files";
    link.addEventListener("click", () => toggleShared(link));
    heading.appendChild(link);
  } finally {
    mountingFiles = false;
  }
}

async function toggleShared(link) {
  const list = $("dm-list");
  if (!list) return;

  if (showingFiles) {
    showingFiles = false;
    link.textContent = "Files";
    const panel = document.getElementById("dmf-panel");
    if (panel) panel.remove();
    list.style.display = "";
    return;
  }

  const to = await currentThread();
  if (!to) return;

  const { data, error } = await db.from("direct_messages")
    .select("id, sender_id, body, created_at, file_path, file_name, mime_type")
    .or(`and(sender_id.eq.${me.id},recipient_id.eq.${to}),` +
        `and(sender_id.eq.${to},recipient_id.eq.${me.id})`)
    .order("created_at", { ascending: false });

  if (error) { window.alert("Could not load: " + error.message); return; }

  const rows = data || [];
  const files = rows.filter((r) => r.file_path);
  // A link in the text is worth finding again as much as a file is.
  const links = [];
  for (const r of rows) {
    for (const m of String(r.body || "").match(/https?:\/\/\S+/g) || []) {
      links.push({ url: m, when: r.created_at, mine: r.sender_id === me.id });
    }
  }

  showingFiles = true;
  link.textContent = "Back to messages";
  list.style.display = "none";

  // Never two panels, however many buttons were pressed.
  for (const old of document.querySelectorAll("#dmf-panel")) old.remove();

  const panel = document.createElement("div");
  panel.id = "dmf-panel";
  panel.style.cssText = "max-height:26rem;overflow-y:auto";

  if (!files.length && !links.length) {
    panel.innerHTML =
      '<p class="chat-none">Nothing has been shared in this conversation yet.</p>';
  } else {
    if (files.length) {
      const h = document.createElement("div");
      h.className = "whenline";
      h.style.cssText = "font-weight:650;color:var(--ink);margin:0 0 0.4rem";
      h.textContent = files.length + (files.length === 1 ? " file" : " files");
      panel.append(h);

      // Pictures first, as pictures. A screenshot is recognised at a
      // glance and never by its filename.
      const images = files.filter((f) => /^image\//.test(f.mime_type || ""));
      const rest = files.filter((f) => !/^image\//.test(f.mime_type || ""));

      if (images.length) {
        const grid = document.createElement("div");
        grid.style.cssText =
          "display:grid;gap:0.4rem;margin-bottom:0.7rem;" +
          "grid-template-columns:repeat(auto-fill,minmax(7rem,1fr))";
        for (const f of images) grid.append(thumb(f));
        panel.append(grid);
      }

      for (const f of rest) panel.append(sharedRow(f));
    }
    if (links.length) {
      const h = document.createElement("div");
      h.className = "whenline";
      h.style.cssText = "font-weight:650;color:var(--ink);margin:0.9rem 0 0.4rem";
      h.textContent = links.length + (links.length === 1 ? " link" : " links");
      panel.append(h);
      for (const l of links) {
        const row = document.createElement("div");
        row.className = "rc-row";

        // A real preview would mean fetching the page, which the
        // browser will not do for somebody else's site. The domain and
        // its icon are honest about what this is, and enough to
        // recognise a link you have seen before.
        let host = "";
        try { host = new URL(l.url).hostname.replace(/^www\./, ""); } catch (e) {}

        if (host) {
          const icon = document.createElement("img");
          icon.src = "https://" + host + "/favicon.ico";
          icon.alt = "";
          icon.style.cssText = "flex:none;width:16px;height:16px;object-fit:contain";
          icon.onerror = () => icon.remove();
          row.append(icon);
        }

        const wrap = document.createElement("span");
        wrap.style.cssText = "flex:1 1 auto;min-width:0";
        const a = document.createElement("a");
        a.href = l.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = l.url;
        a.style.cssText = "display:block;overflow-wrap:anywhere";
        const meta = document.createElement("div");
        meta.className = "hint";
        meta.textContent = [host, (l.mine ? "you" : "them"),
          new Date(l.when).toLocaleDateString("en-GB",
            { day: "numeric", month: "short", year: "numeric" })]
          .filter(Boolean).join(" \u00b7 ");
        wrap.append(a, meta);
        row.append(wrap);
        panel.append(row);
      }
    }
  }

  list.parentNode.insertBefore(panel, list.nextSibling);
}

// One picture in the grid. The link is asked for as it is drawn rather
// than up front, so opening the panel does not wait on twenty of them.
function thumb(m) {
  const box = document.createElement("button");
  box.type = "button";
  box.style.cssText =
    "padding:0;border:1px solid var(--rule);border-radius:5px;overflow:hidden;" +
    "background:#f0eeea;cursor:pointer;display:block;width:100%;text-align:left";

  const frame = document.createElement("span");
  frame.style.cssText =
    "display:block;aspect-ratio:1/1;background:#f0eeea";
  box.append(frame);

  const cap = document.createElement("span");
  cap.className = "hint";
  cap.style.cssText =
    "display:block;padding:0.3rem 0.4rem;overflow:hidden;" +
    "text-overflow:ellipsis;white-space:nowrap";
  cap.textContent = (m.sender_id === me.id ? "You" : "Them") + " \u00b7 " +
    new Date(m.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  box.append(cap);

  db.storage.from("chat-files").createSignedUrl(m.file_path, 3600).then(({ data }) => {
    if (!data?.signedUrl) { cap.textContent = m.file_name || "file"; return; }
    const img = document.createElement("img");
    img.src = data.signedUrl;
    img.alt = m.file_name || "";
    img.loading = "lazy";
    img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
    frame.append(img);
    box.title = m.file_name || "";
    box.addEventListener("click", () => window.open(data.signedUrl, "_blank"));
  });

  return box;
}

function sharedRow(m) {
  const row = document.createElement("div");
  row.className = "rc-row";

  const who = document.createElement("span");
  who.className = "desc";
  who.style.cssText = "flex:1 1 8rem;min-width:0";
  const nm = document.createElement("div");
  nm.textContent = m.file_name || "file";
  const when = document.createElement("div");
  when.className = "hint";
  when.textContent = (m.sender_id === me.id ? "You" : "Them") + " \u00b7 " +
    new Date(m.created_at).toLocaleDateString("en-GB",
      { day: "numeric", month: "short", year: "numeric" });
  who.append(nm, when);

  const open = document.createElement("button");
  open.type = "button";
  open.className = "btn ghost tiny";
  open.textContent = "Open";
  open.addEventListener("click", async () => {
    const { data } = await db.storage
      .from("chat-files").createSignedUrl(m.file_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  });

  row.append(who, open);
  return row;
}

/* ---------- the attach button ---------- */

const BTN_ID = "dmf-attach";

function mountButton() {
  const row = $("dm-send") && $("dm-send").parentNode;
  if (!row || document.getElementById(BTN_ID)) return;

  const input = document.createElement("input");
  input.type = "file";
  input.id = "dmf-file";
  input.accept = "image/*,application/pdf";
  input.style.display = "none";

  const btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.type = "button";
  btn.className = "btn ghost small";
  btn.textContent = "Attach";

  const note = document.createElement("span");
  note.id = "dmf-note";
  note.className = "why";

  btn.addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;

    if (file.size > MAX_BYTES) {
      note.textContent = "That file is too big — 15MB is the limit.";
      pending = null;
      return;
    }

    note.textContent = "Preparing…";
    const body = await shrink(file);
    pending = { body, name: file.name, type: file.type || "application/octet-stream" };
    note.textContent = "Ready to send: " + file.name;
    btn.textContent = "Change";
  });

  // Insert before Send, so the order reads attach then send.
  row.insertBefore(input, $("dm-send"));
  row.insertBefore(btn, $("dm-send"));
  row.appendChild(note);

  // The portal's own Send handler runs first and writes the message; a
  // capture-phase listener gets in before it to upload and stash the
  // path on the row afterwards.
  $("dm-send").addEventListener("click", onSend, true);
  const box = $("dm-box");
  if (box) {
    box.addEventListener("keydown", (e) => {
      if (TOUCH_INPUT) return;
      if (e.key === "Enter" && !e.shiftKey) onSend();
    }, true);
  }
}

/* ---------- sending ---------- */

// The portal inserts the message itself. Rather than duplicate that,
// the file is uploaded first and the row is updated immediately
// afterwards — the newest message from me in this thread is the one
// that has just been written.
async function onSend() {
  if (!pending) return;

  const note = $("dmf-note");
  const to = await currentThread();
  if (!to) { note.textContent = "Open a conversation first."; return; }

  const file = pending;
  pending = null;
  note.textContent = "Sending the file…";

  try {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${me.id}/${to}/${Date.now()}-${Math.random().toString(36).slice(2,7)}.${ext}`;

    const { error } = await db.storage.from("chat-files")
      .upload(path, file.body, { contentType: file.type, upsert: false });
    if (error) throw new Error(error.message);

    // Give the portal a moment to write its own row, then attach to it.
    await new Promise((r) => setTimeout(r, 700));

    const { data: rows } = await db.from("direct_messages")
      .select("id, file_path")
      .eq("sender_id", me.id).eq("recipient_id", to)
      .order("created_at", { ascending: false }).limit(1);

    const row = rows && rows[0];
    if (!row || row.file_path) {
      // No message to attach to — the file would be orphaned, so it is
      // sent as a message of its own rather than left in the bucket.
      await db.from("direct_messages").insert({
        sender_id: me.id, recipient_id: to, body: "",
        file_path: path, file_name: file.name,
        mime_type: file.type, size_bytes: file.body.size || null,
      });
    } else {
      await db.from("direct_messages").update({
        file_path: path, file_name: file.name,
        mime_type: file.type, size_bytes: file.body.size || null,
      }).eq("id", row.id);
    }

    note.textContent = "";
    $(BTN_ID).textContent = "Attach";
    decorate().catch(() => {});
  } catch (err) {
    note.textContent = "Could not send that file: " + err.message;
  }
}

/* ---------- showing what arrived ---------- */

async function decorate() {
  const list = $("dm-list");
  if (!list || !me) return;

  const to = await currentThread();
  if (!to) return;

  const { data, error } = await db.from("direct_messages")
    .select("id, sender_id, body, created_at, file_path, file_name, mime_type")
    .or(`and(sender_id.eq.${me.id},recipient_id.eq.${to}),` +
        `and(sender_id.eq.${to},recipient_id.eq.${me.id})`)
    .not("file_path", "is", null)
    .order("created_at", { ascending: true });

  if (error || !data || !data.length) return;

  const bodies = list.querySelectorAll(".chat-msg .body");
  if (!bodies.length) return;

  // Matched on the message text, since the rendered rows carry no id.
  // A file sent on its own has no text, so those are matched by
  // position from the end instead.
  const withFiles = data.slice();

  for (const el of bodies) {
    if (el.querySelector(".dmf-file")) continue;
    const text = (el.textContent || "").trim();

    let idx = withFiles.findIndex((m) => (m.body || "").trim() === text);
    if (idx < 0 && !text) idx = withFiles.findIndex((m) => !(m.body || "").trim());
    if (idx < 0) continue;

    const m = withFiles.splice(idx, 1)[0];
    el.append(attachmentEl(m));
  }
}

function attachmentEl(m) {
  const wrap = document.createElement("span");
  wrap.className = "dmf-file";
  wrap.style.cssText = "display:block;margin-top:0.5rem";

  const isImage = /^image\//.test(m.mime_type || "");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn ghost tiny";
  btn.textContent = isImage ? "View image" : ("Open " + (m.file_name || "file"));
  btn.addEventListener("click", async () => {
    const { data, error } = await db.storage
      .from("chat-files").createSignedUrl(m.file_path, 3600);
    if (error || !data?.signedUrl) {
      window.alert("Could not open that: " + (error ? error.message : "no link"));
      return;
    }
    window.open(data.signedUrl, "_blank");
  });

  wrap.append(btn);

  // A screenshot is worth showing rather than making somebody tap to
  // find out what it is.
  if (isImage) {
    db.storage.from("chat-files").createSignedUrl(m.file_path, 3600).then(({ data }) => {
      if (!data?.signedUrl) return;
      const img = document.createElement("img");
      img.src = data.signedUrl;
      img.alt = m.file_name || "";
      img.style.cssText =
        "display:block;margin-top:0.4rem;max-width:100%;max-height:16rem;" +
        "border:1px solid var(--rule);border-radius:4px;cursor:pointer";
      img.addEventListener("click", () => window.open(data.signedUrl, "_blank"));
      wrap.append(img);
    });
  }

  return wrap;
}

/* ---------- go ---------- */

async function run() {
  try {
    await Promise.race([
      whoAmI(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("sign-in check timed out")), 4000)),
    ]);
  } catch (err) {
    console.warn("message-files:", err.message);
  }
  if (!me) return;

  const tick = () => {
    const view = document.getElementById("view-messages");
    if (!view || view.classList.contains("hidden")) return;
    mountButton();
    mountSearch();
    wireDraft().catch(() => {});
    restoreDraft().catch(() => {});
    mountFilesLink().catch(() => {});
    decorate().catch(() => {});
  };

  new MutationObserver(tick).observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["class"],
  });

  tick();
}

run();
