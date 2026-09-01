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

// What is already on this course. Held so an upload can tell the coach
// they are about to add the same photo twice, which is the thing that
// actually happened on the Mexico seminar.
let mediaRows = [];

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
    </div>

    <div id="ex-ads-wrap" class="hidden">
      <div class="sep"></div>
      <h3 style="margin-top:0">Adverts
        <span class="hint" style="text-transform:none;letter-spacing:0">— admin only, never shown to coaches</span></h3>
      <div id="ex-ads"></div>
      <div class="admin-row" style="margin-top:0.5rem">
        <input type="text" id="ex-ad-label" placeholder="What it is — e.g. Meta, San Antonio, Aug"
               style="flex:1 1 14rem;min-width:0">
        <select id="ex-ad-kind" style="flex:0 1 9rem">
          <option value="campaign">Campaign</option>
          <option value="adset">Ad set</option>
          <option value="ad">Ad</option>
        </select>
        <input type="text" id="ex-ad-objid" placeholder="Meta ID (optional for now)"
               style="flex:0 1 12rem;min-width:0">
      </div>
      <div class="admin-row" style="margin-top:0.4rem">
        <input type="number" id="ex-ad-budget" placeholder="Budget" step="0.01" min="0"
               style="flex:0 1 8rem">
        <input type="number" id="ex-ad-spend" placeholder="Spent so far" step="0.01" min="0"
               style="flex:0 1 8rem">
        <select id="ex-ad-cur" style="flex:0 1 7rem">
          <option>EUR</option><option>USD</option><option>GBP</option>
          <option>AUD</option><option>CAD</option>
        </select>
        <select id="ex-ad-status" style="flex:0 1 9rem">
          <option value="live">Live</option>
          <option value="planned">Planned</option>
          <option value="paused">Paused</option>
          <option value="finished">Finished</option>
        </select>
        <button class="btn small" id="ex-ad-add" type="button">Add advert</button>
        <span class="why" id="ex-ad-msg"></span>
      </div>
      <p class="whenline" id="ex-ad-total" style="margin-top:0.6rem"></p>
    </div>`;
  return el;
}

/* ---------- adverts ---------- */

// Admin only, by policy as well as by hiding the panel: the RLS on
// course_adverts refuses a coach outright, so a coach who went looking
// would find nothing rather than find it hidden.
//
// Spend is typed for now. The columns the nightly Meta sync will write
// — impressions, clicks, synced_at — already exist, so wiring the API
// later changes nothing here except where the numbers come from.

const cents = (v) => {
  const n = parseFloat(String(v == null ? "" : v).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const showMoney = (c, cur) => c == null ? "—" :
  new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "EUR" })
    .format(c / 100);

async function renderAdverts(courseId) {
  const wrap = $("ex-ads-wrap");
  if (!wrap) return;
  wrap.classList.toggle("hidden", !isAdmin());
  if (!isAdmin()) return;

  const box = $("ex-ads");
  const { data, error } = await db.from("course_adverts")
    .select("id, label, meta_object_id, meta_object_kind, status, budget_cents, spend_cents, currency, impressions, clicks, synced_at, notes, started_on, ended_on")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });

  if (error) {
    box.innerHTML = '<p class="whenline bad">Adverts could not load: ' + esc(error.message) + "</p>";
    return;
  }

  const rows = data || [];
  if (!rows.length) {
    box.innerHTML = '<p class="whenline">No advert recorded for this seminar.</p>';
    $("ex-ad-total").textContent = "";
    return;
  }

  box.innerHTML = rows.map((r) => {
    const meta = r.synced_at
      ? `${r.impressions == null ? "" : r.impressions + " seen · "}` +
        `${r.clicks == null ? "" : r.clicks + " clicks · "}from Meta`
      : (r.meta_object_id ? "not synced yet" : "typed by hand");
    return `<div class="rc-row">
      <span class="desc" style="flex:1 1 12rem">
        ${esc(r.label || "Advert")}
        <span class="pill">${esc(r.status)}</span>
        <div class="hint">${esc(showMoney(r.spend_cents, r.currency))} spent` +
        `${r.budget_cents != null ? " of " + esc(showMoney(r.budget_cents, r.currency)) : ""}` +
        ` · ${esc(meta)}</div>
      </span>
      <button class="btn ghost tiny" data-ad-edit="${r.id}" type="button">Update spend</button>
      <button class="btn ghost tiny danger" data-ad-del="${r.id}" type="button">Remove</button>
    </div>`;
  }).join("");

  // Spend and takings are usually in different currencies — the ad
  // account bills in euro, a San Antonio seminar sells in dollars — so
  // they are shown side by side rather than converted into a number
  // that would look precise and be wrong.
  const byCur = {};
  for (const r of rows) {
    const c = r.currency || "EUR";
    byCur[c] = (byCur[c] || 0) + (r.spend_cents || 0);
  }
  const spentText = Object.entries(byCur)
    .map(([cur, c]) => showMoney(c, cur)).join(" · ");

  let takings = "";
  const { data: regs } = await db.from("registrations")
    .select("amount_paid_cents, currency, status, payment_status")
    .eq("course_id", courseId);
  const live = (regs || []).filter((r) =>
    (r.status || "active") === "active" &&
    r.payment_status !== "refunded" && r.payment_status !== "failed");
  if (live.length) {
    const cur = live[0].currency || "EUR";
    const total = live.reduce((n, r) => n + (r.amount_paid_cents || 0), 0);
    takings = ` · ${live.length} registration${live.length === 1 ? "" : "s"}` +
      ` worth ${showMoney(total, cur)}`;
    // Cost per registration only where one currency is in play, since
    // dividing euro by dollars means nothing.
    if (Object.keys(byCur).length === 1 && Object.keys(byCur)[0] === cur) {
      const per = Math.round(byCur[cur] / live.length);
      takings += ` · ${showMoney(per, cur)} of advertising per registration`;
    }
  }

  $("ex-ad-total").textContent = spentText + " spent" + takings + ".";

  for (const b of box.querySelectorAll("[data-ad-del]")) {
    b.addEventListener("click", async () => {
      if (!window.confirm("Remove this advert record?")) return;
      b.disabled = true;
      const { error: e } = await db.from("course_adverts")
        .delete().eq("id", b.dataset.adDel);
      if (e) { window.alert("Could not remove it: " + e.message); b.disabled = false; return; }
      adsByCourse = null;
      renderAdverts(courseId);
    });
  }

  for (const b of box.querySelectorAll("[data-ad-edit]")) {
    b.addEventListener("click", async () => {
      const row = rows.find((r) => r.id === b.dataset.adEdit);
      const typed = window.prompt(
        `Spend so far on "${row.label || "this advert"}", in ${row.currency}:`,
        row.spend_cents == null ? "" : (row.spend_cents / 100).toFixed(2));
      if (typed === null) return;
      const value = cents(typed);
      if (value === null) { window.alert("That is not a number."); return; }
      b.disabled = true;
      const { error: e } = await db.from("course_adverts")
        .update({ spend_cents: value, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (e) { window.alert("Could not save: " + e.message); b.disabled = false; return; }
      adsByCourse = null;
      renderAdverts(courseId);
    });
  }
}

/* ---------- travel ---------- */

async function renderTravel(courseId) {
  const box = $("ex-travel");
  if (!box) return;

  const { data, error } = await db.from("course_staff")
    .select("staff_id, role, travel_booked, travel_booked_at, staff ( full_name )")
    .eq("course_id", courseId);

  if (error) {
    box.innerHTML = '<p class="whenline bad">Travel could not load: ' + esc(error.message) +
      '</p><p class="whenline">If that mentions travel_booked, step 26 has not been run.</p>';
    return;
  }

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

  if (error) {
    const note = '<p class="whenline bad">Media could not load: ' + esc(error.message) +
      '</p><p class="whenline">If that mentions seminar_media, step 25 has not been run.</p>';
    for (const id of ["ex-promo", "ex-photos", "ex-links"]) {
      if ($(id)) $(id).innerHTML = note;
    }
    mediaRows = [];
    return;
  }
  const rows = data || [];
  mediaRows = rows;

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

async function uploadFiles(files, kind, shrinkIt, onStep) {
  const out = [];
  let done = 0;
  for (const file of files) {
    let body = file;
    let name = file.name;

    // A phone photo over gym wifi is a long wait with nothing to look
    // at, so say which one is going up and how far through we are.
    if (onStep) onStep(done + 1, files.length, name);

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
    done++;
  }

  if (out.length) {
    const { error } = await db.from("seminar_media").insert(out);
    if (error) throw new Error(error.message);
  }
  return out.length;
}

// The button is the thing they just pressed, so the button is where
// the progress goes. A grey line underneath it wraps onto its own row
// on a phone and is missed — which is how the same seminar ended up
// with the group photo uploaded twice.
function runUpload(btnId, msgId, files, kind, shrinkIt, after) {
  const btn = $(btnId);
  const msg = $(msgId);
  const label = btn.textContent;

  btn.disabled = true;
  msg.style.color = "";
  msg.textContent = files.length > 1
    ? `Uploading ${files.length} files — this can take a minute on gym wifi.`
    : "Uploading — this can take a minute on gym wifi.";
  btn.textContent = "Uploading…";

  return uploadFiles(files, kind, shrinkIt, (i, total, name) => {
    btn.textContent = total > 1 ? `Uploading ${i}/${total}…` : "Uploading…";
    msg.textContent = `Sending ${name}…`;
  }).then(async (n) => {
    btn.textContent = "Uploaded";
    msg.style.color = "var(--good)";
    msg.textContent = n === 1
      ? "Done — it is in the list above."
      : `Done — ${n} added to the list above.`;
    await after();
    // Long enough to be read from across a gym floor.
    setTimeout(() => {
      btn.textContent = label;
      msg.style.color = "";
    }, 6000);
  }).catch((err) => {
    btn.textContent = label;
    msg.style.color = "var(--bad)";
    msg.textContent = "Could not upload: " + err.message;
  }).finally(() => {
    btn.disabled = false;
  });
}

// Same name and same size already on this course is nearly always a
// second press rather than a second photo.
function alreadyThere(files) {
  return files.filter((f) =>
    mediaRows.some((r) => r.file_name === f.name)).map((f) => f.name);
}

function wirePanel() {
  $("ex-promo-up").addEventListener("click", async () => {
    const msg = $("ex-promo-msg");
    const files = Array.from($("ex-promo-file").files || []);
    if (!files.length) { msg.textContent = "Choose a file first."; return; }

    const dupes = alreadyThere(files);
    if (dupes.length && !window.confirm(
      `${dupes.join(", ")} ${dupes.length === 1 ? "is" : "are"} already on this course.\n\n` +
      "Upload again anyway?"
    )) return;

    await runUpload("ex-promo-up", "ex-promo-msg", files, "promo", false, async () => {
      $("ex-promo-file").value = "";
      await renderMedia(currentCourseId);
    });
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

    const dupes = alreadyThere(files);
    if (dupes.length && !window.confirm(
      `${dupes.join(", ")} ${dupes.length === 1 ? "is" : "are"} already on this course.\n\n` +
      "Upload again anyway?"
    )) return;

    // There can only be one group photo, and the second one silently
    // replacing nothing is worse than being asked.
    if (group && mediaRows.some((r) => r.kind === "group") && !window.confirm(
      "This course already has a group photo.\n\n" +
      "Adding another leaves two marked as the group photo. Continue?"
    )) return;

    await runUpload("ex-photo-up", "ex-photo-msg", files,
      group ? "group" : "photo", !$("ex-photo-full").checked, async () => {
        $("ex-photo-file").value = "";
        $("ex-photo-group").checked = false;
        await renderMedia(currentCourseId);
      });
  });

  const adAdd = $("ex-ad-add");
  if (adAdd) adAdd.addEventListener("click", async () => {
    const msg = $("ex-ad-msg");
    const label = $("ex-ad-label").value.trim();
    if (!label) { msg.textContent = "Give it a name you will recognise."; return; }

    adAdd.disabled = true;
    msg.style.color = "";
    msg.textContent = "Saving…";

    const { error } = await db.from("course_adverts").insert({
      course_id: currentCourseId,
      label,
      meta_object_id: $("ex-ad-objid").value.trim() || null,
      meta_object_kind: $("ex-ad-kind").value,
      status: $("ex-ad-status").value,
      budget_cents: cents($("ex-ad-budget").value),
      spend_cents: cents($("ex-ad-spend").value) || 0,
      currency: $("ex-ad-cur").value,
      created_by: me ? me.id : null,
    });

    adAdd.disabled = false;

    if (error) {
      msg.style.color = "var(--bad)";
      // The unique index is the likeliest failure, and it is worth
      // saying plainly rather than showing the raw constraint name.
      msg.textContent = /course_adverts_object_uniq/.test(error.message)
        ? "That Meta ID is already attached to another seminar."
        : "Could not save: " + error.message;
      return;
    }

    for (const id of ["ex-ad-label", "ex-ad-objid", "ex-ad-budget", "ex-ad-spend"]) {
      $(id).value = "";
    }
    adsByCourse = null;   // the list pill is now out of date
    msg.style.color = "var(--good)";
    msg.textContent = "Added.";
    setTimeout(() => { msg.textContent = ""; msg.style.color = ""; }, 4000);
    await renderAdverts(currentCourseId);
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
  if (!id) {
    // The one line in openCourse has not been added, or has not
    // deployed. Say so on the page rather than showing nothing.
    const wrapNow = view.querySelector(".wrap");
    if (wrapNow && !document.getElementById(PANEL_ID)) {
      const warn = document.createElement("div");
      warn.id = PANEL_ID;
      warn.className = "panel";
      warn.style.marginTop = "1.5rem";
      warn.innerHTML =
        "<h3>Media and travel</h3><p class=\"whenline\">Waiting on the course id. " +
        "The line <code>window.__birdboxCourseId = course.id;</code> needs to be " +
        "inside openCourse in portal/index.html.</p>";
      wrapNow.appendChild(warn);
    }
    return;
  }
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

  if (!me) {
    const t = $("ex-travel");
    if (t) t.innerHTML =
      '<p class="whenline bad">Not signed in as far as this panel can tell, ' +
      'so nothing below will load. Sign out and back in.</p>';
  }

  await renderTravel(id);
  await renderMedia(id);
  await renderAdverts(id);
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

// Which seminars are being advertised, and what has gone on them.
// Admin only — the query would be refused for a coach anyway, but not
// asking at all saves a pointless request on every list they open.
let adsByCourse = null;

async function loadAdverts() {
  if (!isAdmin()) return new Map();
  const { data, error } = await db.from("course_adverts")
    .select("course_id, spend_cents, currency, status");
  if (error) return null;

  const by = new Map();
  for (const r of data || []) {
    const t = by.get(r.course_id) || { count: 0, live: 0, spend: {} };
    t.count++;
    if (r.status === "live") t.live++;
    const cur = r.currency || "EUR";
    t.spend[cur] = (t.spend[cur] || 0) + (r.spend_cents || 0);
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
  if (!adsByCourse) adsByCourse = await loadAdverts();
  if (!travelByCourse) return;

  for (const card of cards) {
    const flags = card.querySelector(".flags");
    if (!flags) continue;

    if (!flags.querySelector(".travel-pill")) {
      const t = travelByCourse.get(card.dataset.courseId);
      if (t && t.total) {
        const s = document.createElement("span");
        s.className = "pill travel-pill" + (t.done === t.total ? " done" : " warn");
        s.textContent = t.done === t.total
          ? "travel booked"
          : `travel ${t.done} of ${t.total}`;
        flags.append(s);
      }
    }

    // Whether a seminar is being advertised is worth seeing from the
    // list, because the ones with nothing behind them are exactly the
    // ones that quietly fail to fill.
    if (isAdmin() && adsByCourse && !flags.querySelector(".ad-pill")) {
      const a = adsByCourse.get(card.dataset.courseId);
      // Nothing recorded means no pill at all. Across 150 seminars a
      // row of "no advert" labels is noise on every card, and the eye
      // stops reading them.
      if (a) {
        const s = document.createElement("span");
        s.className = "pill ad-pill" + (a.live ? " on" : "");

        const spent = Object.entries(a.spend)
          .map(([cur, c]) => new Intl.NumberFormat(undefined, {
            style: "currency", currency: cur, maximumFractionDigits: 0,
          }).format(c / 100))
          .join(" · ");

        s.textContent = "advert " + spent;
        s.title = `${a.count} advert${a.count === 1 ? "" : "s"}` +
          `${a.live ? `, ${a.live} live` : ""}`;
        flags.append(s);
      }
    }
  }
}

/* ---------- who has actually signed in ---------- */

// Five accounts have never been used, and until this was visible there
// was no way to tell a coach who has not got round to it from an invite
// that never arrived. Admin only — it reads auth data through a
// SECURITY DEFINER function that checks is_admin() itself.

let signIns = null;

function agoText(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return days + " days ago";
  if (days < 60) return Math.round(days / 7) + " weeks ago";
  return Math.round(days / 30.44) + " months ago";
}

async function loadSignIns() {
  const { data, error } = await db.rpc("staff_sign_ins");
  if (error) { console.warn("Sign-ins unavailable:", error.message); return null; }
  const by = new Map();
  for (const r of data || []) by.set(String(r.email || "").toLowerCase(), r.last_sign_in);
  return by;
}

async function paintTeam() {
  if (!isAdmin()) return;
  const lists = ["tm-list", "tm-gone"]
    .map((id) => document.getElementById(id)).filter(Boolean);
  if (!lists.length) return;

  const rows = [];
  for (const l of lists) rows.push(...l.querySelectorAll(".inv-row"));
  if (!rows.length) return;

  if (!signIns) signIns = await loadSignIns();
  if (!signIns) return;

  for (const row of rows) {
    if (row.querySelector(".signin-note")) continue;

    // The rows carry no id, so they are matched on the email address
    // already printed under the name.
    let hit = null;
    const text = (row.textContent || "").toLowerCase();
    for (const [email, when] of signIns.entries()) {
      if (email && text.includes(email)) { hit = { email, when }; break; }
    }
    if (!hit) continue;

    const who = row.querySelector(".who");
    if (!who) continue;

    const note = document.createElement("div");
    note.className = "signin-note whenline";
    note.style.marginTop = "0.15rem";
    if (hit.when) {
      note.textContent = "Last signed in " + agoText(hit.when);
    } else {
      note.style.color = "var(--bad)";
      note.style.fontWeight = "650";
      note.textContent = "Never signed in";
    }
    who.appendChild(note);
  }
}

async function run() {
  // Raced against a timer: getSession can hang when two Supabase clients
  // share one session, and a hang here would take the whole file with it.
  try {
    await Promise.race([
      whoAmI(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("sign-in check timed out")), 4000)),
    ]);
  } catch (err) {
    console.warn("course-extras:", err.message);
  }

  // The portal swaps views in and out rather than navigating, so there
  // is nothing to hook. Watching is the only honest way to know when a
  // course has been opened.
  const observer = new MutationObserver(() => {
    mount().catch(() => {});
    paintList().catch(() => {});
    paintTeam().catch(() => {});
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["class"] });

  mount().catch(() => {});
  paintList().catch(() => {});
  paintTeam().catch(() => {});
}

run();
