/* portal/course-extras.js
 *
 * Two things that belong on a course but do not belong in the big file.
 *
 *   MEDIA — the promotional pack Sarah builds before the seminar, the
 *   group photo taken on the day, and a link to wherever the shoot
 *   actually lives if somebody came to film it.
 *
 *   TRAVEL — a tick per coach. Not a deadline and not a warning: a
 *   record of who has booked, so nobody has to ask.
 *
 * Nothing here reaches into portal/index.html. It watches for the
 * course view opening, reads the course id from the URL the portal
 * already keeps, and appends its own panel. If the portal changes
 * underneath it the panel simply does not appear — it cannot break the
 * page it is sitting on.
 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://yvdmazpxtpuvidlcifnq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ";

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// Phone photos are ten megabytes and gym wifi is what it is. A promo
// pack and anything a photographer uploads are left exactly as they are.
const PHOTO_MAX_PX = 2000;
const PHOTO_QUALITY = 0.85;

let me = null;
let myRole = null;
let currentCourseId = null;
let staffList = [];

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

const isAdmin = () => !!me && me.role === "admin";

/* ---------- shrinking, the same way the portal already does ---------- */

function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PHOTO_MAX_PX / Math.max(img.width, img.height));
      if (scale === 1) { resolve(file); return; }
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("Could not process that photo")),
        "image/jpeg", PHOTO_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That is not an image we can read")); };
    img.src = url;
  });
}

/* ---------- the panel ---------- */

const PANEL_ID = "extras-panel";

function buildPanel() {
  const el = document.createElement("div");
  el.id = PANEL_ID;
  el.className = "panel";
  el.style.marginTop = "1.5rem";
  el.innerHTML = `
    <h3>Media and travel</h3>

    <div id="ex-travel"></div>

    <div class="sep"></div>

    <h3 style="margin-top:0">Promotional pack
      <span class="hint" style="text-transform:none;letter-spacing:0">— artwork for this seminar</span></h3>
    <div id="ex-promo"></div>
    <div class="admin-row" style="margin-top:0.5rem">
      <input type="file" id="ex-promo-file" accept="image/*,application/pdf" multiple
             style="max-width:16rem">
      <button class="btn small" id="ex-promo-up" type="button">Upload</button>
      <span class="why" id="ex-promo-msg">JPG or PDF. Uploaded exactly as it is — never shrunk.</span>
    </div>

    <div class="sep"></div>

    <h3 style="margin-top:0">Photos from the day</h3>
    <div id="ex-photos"></div>
    <div class="admin-row" style="margin-top:0.5rem">
      <input type="file" id="ex-photo-file" accept="image/*" multiple style="max-width:16rem">
      <label class="pm-check" style="margin:0">
        <input type="checkbox" id="ex-photo-group"> This is the group photo
      </label>
      <label class="pm-check" style="margin:0">
        <input type="checkbox" id="ex-photo-full"> Keep full quality
      </label>
      <button class="btn small" id="ex-photo-up" type="button">Upload</button>
      <span class="why" id="ex-photo-msg"></span>
    </div>

    <div class="sep"></div>

    <h3 style="margin-top:0">Where the shoot lives
      <span class="hint" style="text-transform:none;letter-spacing:0">— a link, if somebody filmed it</span></h3>
    <div id="ex-links"></div>
    <div class="admin-row" style="margin-top:0.5rem">
      <input type="text" id="ex-link-url" placeholder="https://drive.google.com/..."
             style="flex:1 1 16rem;min-width:0">
      <input type="text" id="ex-link-note" placeholder="whose, or what is in it"
             style="flex:0 1 12rem;min-width:0">
      <button class="btn small" id="ex-link-add" type="button">Add link</button>
      <span class="why" id="ex-link-msg"></span>
    </div>`;
  return el;
}

/* ---------- travel ---------- */

async function renderTravel(courseId) {
  const box = $("ex-travel");
  if (!box) return;

  const { data, error } = await db.from("course_staff")
    .select("staff_id, role, travel_booked, travel_booked_at, staff ( full_name )")
    .eq("course_id", courseId);

  if (error) { box.innerHTML = '<p class="whenline">Could not load who is coaching this.</p>'; return; }

  const rows = data || [];
  if (!rows.length) {
    box.innerHTML = '<p class="whenline">Nobody assigned yet, so there is no travel to book.</p>';
    return;
  }

  const done = rows.filter((r) => r.travel_booked).length;

  box.innerHTML =
    `<h3 style="margin:0 0 0.6rem">Travel
       <span class="hint" style="text-transform:none;letter-spacing:0">— ${done} of ${rows.length} booked</span></h3>` +
    rows.map((r) => {
      const name = (r.staff && r.staff.full_name) || "A coach";
      const mine = me && r.staff_id === me.id;
      // A coach ticks their own. An admin can correct anybody's, because
      // somebody has to be able to.
      const canTick = mine || isAdmin();
      const when = r.travel_booked_at
        ? new Date(r.travel_booked_at).toLocaleDateString("en-GB",
            { day:"numeric", month:"short", year:"numeric" })
        : "";
      return `<div class="rc-row">
        <label class="pm-check" style="margin:0;flex:1 1 auto">
          <input type="checkbox" data-travel="${esc(r.staff_id)}"
                 ${r.travel_booked ? "checked" : ""} ${canTick ? "" : "disabled"}>
          <span style="${mine ? "font-weight:650" : ""}">${esc(name)}</span>
        </label>
        <span class="pill${r.role === "lead_coach" ? " lead" : ""}">${
          r.role === "lead_coach" ? "lead" : "assist"}</span>
        ${r.travel_booked
          ? `<span class="pill on">booked${when ? " " + esc(when) : ""}</span>`
          : '<span class="pill warn">not booked</span>'}
      </div>`;
    }).join("");

  box.querySelectorAll("[data-travel]").forEach((cb) =>
    cb.addEventListener("change", async () => {
      const on = cb.checked;
      cb.disabled = true;
      const { error: err } = await db.from("course_staff").update({
        travel_booked: on,
        travel_booked_at: on ? new Date().toISOString() : null,
      }).eq("course_id", courseId).eq("staff_id", cb.dataset.travel);
      cb.disabled = false;
      if (err) { window.alert("Could not save that: " + err.message); cb.checked = !on; return; }
      renderTravel(courseId);
    }));
}

/* ---------- media ---------- */

async function renderMedia(courseId) {
  const { data, error } = await db.from("seminar_media")
    .select("id, kind, file_path, file_name, link_url, caption, uploaded_by, created_at, staff:uploaded_by ( full_name )")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });

  if (error) { console.error("Could not load media:", error.message); return; }
  const rows = data || [];

  drawFiles($("ex-promo"), rows.filter((r) => r.kind === "promo"),
    "Nothing yet. Sarah adds the artwork here once the course is live.");
  drawFiles($("ex-photos"), rows.filter((r) => ["photo","group"].includes(r.kind)),
    "No photos yet.");
  drawLinks($("ex-links"), rows.filter((r) => r.kind === "link"));
}

function drawFiles(box, rows, empty) {
  if (!box) return;
  if (!rows.length) { box.innerHTML = `<p class="whenline">${esc(empty)}</p>`; return; }

  box.innerHTML = rows.map((r) => {
    const who = (r.staff && r.staff.full_name) || "somebody";
    const when = new Date(r.created_at).toLocaleDateString("en-GB",
      { day:"numeric", month:"short", year:"numeric" });
    return `<div class="rc-row">
      <span class="desc" style="flex:1 1 10rem">
        ${esc(r.file_name || "file")}
        ${r.kind === "group" ? ' <span class="pill ink">group photo</span>' : ""}
        <div class="hint">${esc(who)} · ${esc(when)}</div>
      </span>
      <button class="btn ghost tiny" data-open="${esc(r.file_path)}">Open</button>
      ${(isAdmin() || (me && r.uploaded_by === me.id))
        ? `<button class="btn ghost tiny danger" data-drop="${esc(r.id)}"
             data-path="${esc(r.file_path)}">Remove</button>` : ""}
    </div>`;
  }).join("");

  wireFileButtons(box);
}

function drawLinks(box, rows) {
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = '<p class="whenline">No link yet. Add one if somebody shot this seminar.</p>';
    return;
  }
  box.innerHTML = rows.map((r) => {
    const who = (r.staff && r.staff.full_name) || "somebody";
    return `<div class="rc-row">
      <span class="desc" style="flex:1 1 10rem">
        <a href="${esc(r.link_url)}" target="_blank" rel="noopener">${esc(r.caption || r.link_url)}</a>
        <div class="hint">${esc(who)}</div>
      </span>
      ${(isAdmin() || (me && r.uploaded_by === me.id))
        ? `<button class="btn ghost tiny danger" data-drop="${esc(r.id)}">Remove</button>` : ""}
    </div>`;
  }).join("");
  wireFileButtons(box);
}

function wireFileButtons(box) {
  box.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", async () => {
      // The bucket is private, so a file is reached through a link that
      // lasts an hour rather than a public URL.
      const { data, error } = await db.storage
        .from("seminar-media").createSignedUrl(b.dataset.open, 3600);
      if (error || !data?.signedUrl) {
        window.alert("Could not open that: " + (error ? error.message : "no link"));
        return;
      }
      window.open(data.signedUrl, "_blank");
    }));

  box.querySelectorAll("[data-drop]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!window.confirm("Remove this? It cannot be undone.")) return;
      b.disabled = true;
      if (b.dataset.path) {
        await db.storage.from("seminar-media").remove([b.dataset.path]);
      }
      const { error } = await db.from("seminar_media").delete().eq("id", b.dataset.drop);
      if (error) { window.alert("Could not remove it: " + error.message); b.disabled = false; return; }
      renderMedia(currentCourseId);
    }));
}

async function uploadFiles(files, kind, shrinkIt) {
  const out = [];
  for (const file of files) {
    let body = file;
    let name = file.name;

    // Only photos, and only when asked. Artwork and PDFs are left alone.
    if (shrinkIt && /^image\//.test(file.type)) {
      try { body = await shrink(file); } catch (e) { body = file; }
    }

    const ext = (name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${currentCourseId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2,7)}.${ext}`;

    const { error } = await db.storage.from("seminar-media")
      .upload(path, body, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) throw new Error(error.message);

    out.push({
      course_id: currentCourseId,
      kind,
      file_path: path,
      file_name: name,
      mime_type: file.type || null,
      size_bytes: body.size || file.size || null,
      uploaded_by: me ? me.id : null,
    });
  }

  if (out.length) {
    const { error } = await db.from("seminar_media").insert(out);
    if (error) throw new Error(error.message);
  }
  return out.length;
}

function wirePanel() {
  $("ex-promo-up").addEventListener("click", async () => {
    const msg = $("ex-promo-msg");
    const files = Array.from($("ex-promo-file").files || []);
    if (!files.length) { msg.textContent = "Choose a file first."; return; }
    $("ex-promo-up").disabled = true;
    msg.textContent = "Uploading…";
    try {
      const n = await uploadFiles(files, "promo", false);
      msg.textContent = `${n} added.`;
      $("ex-promo-file").value = "";
      await renderMedia(currentCourseId);
    } catch (err) { msg.textContent = "Could not upload: " + err.message; }
    $("ex-promo-up").disabled = false;
  });

  $("ex-photo-up").addEventListener("click", async () => {
    const msg = $("ex-photo-msg");
    const files = Array.from($("ex-photo-file").files || []);
    if (!files.length) { msg.textContent = "Choose a photo first."; return; }
    const group = $("ex-photo-group").checked;
    if (group && files.length > 1) {
      msg.textContent = "The group photo is one photo. Untick it to add several.";
      return;
    }
    $("ex-photo-up").disabled = true;
    msg.textContent = "Uploading…";
    try {
      const n = await uploadFiles(files, group ? "group" : "photo", !$("ex-photo-full").checked);
      msg.textContent = `${n} added.`;
      $("ex-photo-file").value = "";
      $("ex-photo-group").checked = false;
      await renderMedia(currentCourseId);
    } catch (err) { msg.textContent = "Could not upload: " + err.message; }
    $("ex-photo-up").disabled = false;
  });

  $("ex-link-add").addEventListener("click", async () => {
    const msg = $("ex-link-msg");
    const url = $("ex-link-url").value.trim();
    if (!/^https?:\/\//i.test(url)) { msg.textContent = "That does not look like a link."; return; }
    $("ex-link-add").disabled = true;
    msg.textContent = "Saving…";
    const { error } = await db.from("seminar_media").insert({
      course_id: currentCourseId,
      kind: "link",
      link_url: url,
      caption: $("ex-link-note").value.trim() || null,
      uploaded_by: me ? me.id : null,
    });
    $("ex-link-add").disabled = false;
    if (error) { msg.textContent = "Could not save: " + error.message; return; }
    msg.textContent = "Added.";
    $("ex-link-url").value = "";
    $("ex-link-note").value = "";
    await renderMedia(currentCourseId);
  });
}

/* ---------- the course being looked at ---------- */

// The portal sets window.__birdboxCourseId when it opens a course — one
// line, added to openCourse. Guessing it from the page would be
// guesswork, and a media panel attached to the wrong seminar is worse
// than no media panel.

async function mount() {
  const view = document.getElementById("view-course");
  if (!view || view.classList.contains("hidden")) return;

  const id = window.__birdboxCourseId;
  if (!id) return;
  if (document.getElementById(PANEL_ID) && currentCourseId === id) return;

  currentCourseId = id;

  const old = document.getElementById(PANEL_ID);
  if (old) old.remove();

  const wrap = view.querySelector(".wrap");
  if (!wrap) return;

  // Above the admin panel where there is one, so the destructive things
  // stay at the bottom of the page.
  const adminPanel = document.getElementById("adminpanel");
  const panel = buildPanel();
  if (adminPanel && adminPanel.parentNode === wrap) wrap.insertBefore(panel, adminPanel);
  else wrap.appendChild(panel);

  wirePanel();
  await renderTravel(id);
  await renderMedia(id);
}

/* ---------- travel, at a glance on the list ---------- */

// Who has booked, without opening the course. The cards carry their own
// id — one line added where the card is built — so this can find them.
let travelByCourse = null;

async function loadTravel() {
  const { data, error } = await db.from("course_staff")
    .select("course_id, travel_booked");
  if (error) return null;
  const by = new Map();
  for (const r of data || []) {
    const t = by.get(r.course_id) || { total: 0, done: 0 };
    t.total++;
    if (r.travel_booked) t.done++;
    by.set(r.course_id, t);
  }
  return by;
}

async function paintList() {
  const list = document.getElementById("courses-list");
  if (!list) return;
  const cards = list.querySelectorAll("[data-course-id]");
  if (!cards.length) return;

  if (!travelByCourse) travelByCourse = await loadTravel();
  if (!travelByCourse) return;

  for (const card of cards) {
    const flags = card.querySelector(".flags");
    if (!flags || flags.querySelector(".travel-pill")) continue;

    const t = travelByCourse.get(card.dataset.courseId);
    if (!t || !t.total) continue;

    const s = document.createElement("span");
    s.className = "pill travel-pill" + (t.done === t.total ? " done" : " warn");
    s.textContent = t.done === t.total
      ? "travel booked"
      : `travel ${t.done} of ${t.total}`;
    flags.append(s);
  }
}

async function run() {
  if (!(await whoAmI())) return;

  // The portal swaps views in and out rather than navigating, so there
  // is nothing to hook. Watching is the only honest way to know when a
  // course has been opened.
  const observer = new MutationObserver(() => {
    mount().catch(() => {});
    paintList().catch(() => {});
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["class"] });

  mount().catch(() => {});
  paintList().catch(() => {});
}

run();
