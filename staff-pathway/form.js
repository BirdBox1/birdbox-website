// staff-pathway/form.js
//
// The Staff Pathway application form, shared by every course's page
// (/tgc/staff-pathway/, /tec/staff-pathway/). The page says which course
// it is with <body data-brand="tgc">; the lists (movements, courses,
// tracks, regions, languages, price) come from pathway-apply, so a course
// with no movement videos or no fee simply has those sections left out.
(function () {
  // Which course this page is for, from <body data-brand="…">.
  const BRAND = document.body.dataset.brand || "tgc";
  const KEY = "pathway-draft-" + BRAND;
  // When they first opened the form, kept with the draft: someone finishing
  // a saved draft can send it in seconds without looking like a bot.
  let opened = Number(store0().started) || Date.now();
  function store0() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[<>&"]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[m]));
  const form = $("form");
  let movements = [];
  let languages = [];

  // One dropdown per language; "Other" opens a box to type it.
  function addLang(value) {
    const box = $("languages"), n = box.children.length;
    const known = !value || languages.includes(value);
    const row = document.createElement("div");
    row.className = "lang";
    row.innerHTML = `<select id="lang-${n}" aria-label="Language ${n + 1}"><option value="">Choose a language…</option>${
      languages.map((l) => `<option${l === value ? " selected" : ""}>${esc(l)}</option>`).join("")}<option value="other"${known ? "" : " selected"}>Other</option></select>
      <input type="text" placeholder="Type the language" aria-label="Other language" class="${known ? "hidden" : ""}" value="${known ? "" : esc(value)}">
      ${n ? '<button type="button" class="x" data-drop-lang>Remove</button>' : ""}`;
    box.appendChild(row);
  }
  // Uploaded files by slot ("mv-0"…, "cv", "philosophy"): { path, name }.
  let files = {};
  const uploading = {};

  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} },
    clear() { try { localStorage.removeItem(KEY); } catch (e) {} },
  };

  function words() { return $("why").value.trim().split(/\s+/).filter(Boolean).length; }
  function updateCount() {
    const n = words();
    $("count").textContent = n + (n === 1 ? " word" : " words") + (n < 150 ? " (at least 150)" : "");
    $("count").className = "count" + (n >= 300 && n <= 600 ? " ok" : "");
  }

  function collect() {
    const v = {};
    form.querySelectorAll("input, select, textarea").forEach((el) => {
      if (!el.id || el.id === "company") return;
      if (el.type === "checkbox" || el.type === "radio") return;
      v[el.id] = el.value;
    });
    v.languages = [...form.querySelectorAll('#languages .lang')].map((row) => {
      const sel = row.querySelector("select").value;
      return (sel === "other" ? row.querySelector("input").value : sel).trim();
    }).filter(Boolean);
    v.courses = [...form.querySelectorAll('#courses input:checked')].map((i) => i.value);
    v.tracks = [...form.querySelectorAll('#track input:checked')].map((i) => i.value);
    v.files = files;
    v.movement_videos = movements.map((m, i) => ({ url: ($("mv-" + i) || {}).value || "", path: (files["mv-" + i] || {}).path || "" }));
    v.cv_path = (files.cv || {}).path || "";
    v.philosophy_path = (files.philosophy || {}).path || "";
    v.agree_terms = $("agree_terms").checked;
    v.agree_privacy = $("agree_privacy").checked;
    v.started = opened;
    return v;
  }

  function restore() {
    const v = store.get();
    Object.keys(v).forEach((k) => { const el = $(k); if (el && typeof v[k] === "string" && el.type !== "checkbox") el.value = v[k]; });
    (v.courses || []).forEach((c) => { const i = form.querySelector(`#courses input[value="${CSS.escape(c)}"]`); if (i) i.checked = true; });
    if (Array.isArray(v.languages) && v.languages.length) { $("languages").innerHTML = ""; v.languages.forEach(addLang); }
    (v.tracks || []).forEach((t) => { const i = form.querySelector(`#track input[value="${CSS.escape(t)}"]`); if (i) i.checked = true; });
    (v.movement_videos || []).forEach((m, i) => { const el = $("mv-" + i); if (el && m && typeof m.url === "string") el.value = m.url; });
    files = v.files && typeof v.files === "object" ? v.files : {};
    document.querySelectorAll(".file[data-slot]").forEach(drawFile);
    updateCount();
  }

  function build(cfg) {
    movements = cfg.movements;
    $("region").insertAdjacentHTML("beforeend", Object.entries(cfg.regions).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join(""));
    $("courses").innerHTML = Object.entries(cfg.courses).map(([k, c]) => `<label><input type="checkbox" value="${k}"> ${esc(c.label)}</label>`).join("");
    languages = cfg.languages;
    addLang("");
    $("track").innerHTML = Object.entries(cfg.tracks).map(([k, l]) => `<label><input type="checkbox" value="${k}"> <span>${esc(l)}</span></label>`).join("");
    // A course without movement videos (TEC) has no such section.
    const movesBox = $("moves");
    if (!movements.length && movesBox) movesBox.closest("fieldset").remove();
    if (movesBox && movements.length) movesBox.innerHTML = movements.map((m, i) =>
      (i === 0 || movements[i - 1].group !== m.group ? `<p class="group">${esc(m.group)}</p>` : "") +
      `<div class="move"><span>${esc(m.name)} *</span><div class="either">
        <div class="file" data-slot="mv-${i}" data-kind="video" data-name="${esc(m.group + " " + m.name.toLowerCase())}"></div>
        <input id="mv-${i}" type="url" placeholder="or paste a link: https://" aria-label="${esc(m.group + " " + m.name)} video link"></div></div>`).join("");
    document.querySelectorAll(".file[data-slot]").forEach(drawFile);
    // Only a paid pathway shows prices.
    const p = cfg.price, eur = (n) => "€" + n.toLocaleString("en-IE");
    if (p && $("p-monthly")) {
      $("p-monthly").textContent = eur(p.monthly) + " a month";
      $("p-months").textContent = "for " + p.months + " months";
      $("p-full").textContent = eur(p.inFull);
    }
    restore();
  }


  function drawFile(el) {
    const slot = el.dataset.slot, f = files[slot], u = uploading[slot];
    const what = el.dataset.kind === "video" ? "video" : "document";
    const accept = el.dataset.kind === "video" ? "video/*" : ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (u) {
      el.innerHTML = `<span>Uploading ${esc(u.name)}</span><span class="bar"><i style="width:${u.pct}%"></i></span><span>${u.pct}%</span>`;
    } else if (f) {
      el.innerHTML = `<span class="got">✓ ${esc(f.name)}</span><button type="button" class="x" data-remove="${slot}">Remove</button>`;
    } else {
      el.innerHTML = `<label class="pick">Upload ${what}<input type="file" accept="${accept}" data-upload="${slot}"></label>${el.dataset.error ? `<span class="err">${esc(el.dataset.error)}</span>` : ""}`;
    }
    const link = $(slot);
    if (link && link.type === "url") link.classList.toggle("hidden", !!(f || u));
  }

  const TYPES = { mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm", "3gp": "video/3gpp",
    pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

  async function upload(slot, file) {
    const el = document.querySelector(`.file[data-slot="${slot}"]`);
    const kind = el.dataset.kind;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const type = file.type || TYPES[ext] || "";
    el.dataset.error = "";
    uploading[slot] = { name: file.name, pct: 0 };
    drawFile(el);
    try {
      const r = await fetch("/.netlify/functions/pathway-upload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, type, size: file.size }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || "The upload could not start. Try again.");
      const body = new FormData();
      body.append("cacheControl", "3600");
      body.append("", file.slice(0, file.size, type), file.name);
      await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open("PUT", d.url);
        x.setRequestHeader("x-upsert", "false");
        x.upload.onprogress = (e) => { if (e.lengthComputable) { uploading[slot].pct = Math.floor(e.loaded / e.total * 100); drawFile(el); } };
        x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error("The upload did not finish. Try again.")));
        x.onerror = () => reject(new Error("The upload stopped. Check your connection and try again."));
        x.send(body);
      });
      files[slot] = { path: d.path, name: file.name };
    } catch (err) {
      el.dataset.error = err.message;
    }
    delete uploading[slot];
    drawFile(el);
    store.set(collect());
  }

  form.addEventListener("change", (e) => {
    const slot = e.target.dataset && e.target.dataset.upload;
    if (slot && e.target.files && e.target.files[0]) upload(slot, e.target.files[0]);
  });
  $("add-lang").addEventListener("click", () => { addLang(""); const s = $("languages").lastElementChild.querySelector("select"); s.focus(); });
  $("languages").addEventListener("change", (e) => {
    if (e.target.tagName !== "SELECT") return;
    const other = e.target.parentElement.querySelector("input");
    other.classList.toggle("hidden", e.target.value !== "other");
    if (e.target.value === "other") other.focus();
  });
  $("languages").addEventListener("click", (e) => {
    if (!e.target.hasAttribute("data-drop-lang")) return;
    e.target.parentElement.remove();
    store.set(collect());
  });

  form.addEventListener("click", (e) => {
    const slot = e.target.dataset && e.target.dataset.remove;
    if (!slot) return;
    delete files[slot];
    drawFile(document.querySelector(`.file[data-slot="${slot}"]`));
    store.set(collect());
  });

  fetch("/.netlify/functions/pathway-apply?brand=" + BRAND)
    .then((r) => r.json())
    .then((cfg) => { if (cfg.movements) build(cfg); else throw new Error(); })
    .catch(() => {
      const msg = "The form did not load. Refresh the page, or write to info@birdboxcoaching.com.";
      if ($("moves")) $("moves").innerHTML = '<p class="small">' + msg + "</p>";
      $("note").className = "note err"; $("note").textContent = msg;
    });

  form.addEventListener("input", () => { updateCount(); store.set(collect()); });
  form.addEventListener("change", () => store.set(collect()));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = $("note"), btn = $("submit");
    if (Object.keys(uploading).length) {
      $("note").className = "note err"; $("note").textContent = "Wait for your uploads to finish, then send.";
      return;
    }
    const v = collect();
    delete v.files;
    note.className = "note"; note.textContent = "";
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      const r = await fetch("/.netlify/functions/pathway-apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v, brand: BRAND, company: $("company").value, t: Date.now() - opened }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "That did not send. Try again, or write to info@birdboxcoaching.com.");
      store.clear();
      form.classList.add("hidden");
      $("done").classList.remove("hidden");
      $("done").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      note.className = "note err"; note.textContent = err.message;
      btn.disabled = false; btn.textContent = "Send my application";
    }
  });
})();
