// The Apply form on the programming pages (TGC, TCC), Nathan 1 Nov 2026.
//
// Tiers 4 and 5 (1:1) go into the app's application process (apply on the
// app): the coach they would like, or BirdBox matches them; the coach or
// the office is told, they get a confirmation, and it shows in Clients to
// accept. Until programming is on sale, tiers 2 and 3 email the office and
// the person gets a confirmation.
//
// The page marks its course on the section: <section id="apply" data-brand="tcc">.

const APPLY = "https://app.birdboxcoaching.com/.netlify/functions/apply";
const $ = (id) => document.getElementById(id);
const section = $("apply");
const brand = (section && section.dataset.brand) || "tgc";
const tierEl = $("ap-tier");
const note = $("ap-note");
const btn = $("ap-submit");
const coachWrap = $("ap-coach-wrap");
const coachEl = $("ap-coach");

function say(message, ok) {
  note.textContent = message;
  note.className = ok ? "l1-form__note l1-form__note--ok" : "l1-form__note";
}

const tierNum = () => Number(String(tierEl.value).replace(/\D/g, ""));

// coaches with room for this tier, as a preference
async function loadCoaches() {
  const t = tierNum();
  const oneToOne = t === 4 || t === 5;
  coachWrap.hidden = !oneToOne;
  if (!oneToOne) return;
  coachEl.innerHTML = '<option value="">Leave it to BirdBox</option>';
  try {
    const r = await fetch(`${APPLY}?tier=${t}`);
    const d = await r.json();
    for (const c of d.coaches || []) {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = c.name;
      coachEl.appendChild(o);
    }
  } catch (e) { /* the office matches them */ }
}

// Apply on a tier card picks that tier and jumps to the form
for (const b of document.querySelectorAll("[data-tier]")) {
  b.addEventListener("click", () => {
    tierEl.value = b.dataset.tier;
    loadCoaches();
    section.scrollIntoView({ behavior: "smooth" });
    $("ap-name").focus({ preventScroll: true });
  });
}
tierEl.addEventListener("change", loadCoaches);
loadCoaches();

btn.addEventListener("click", async () => {
  const name = $("ap-name").value.replace(/\s+/g, " ").trim();
  const email = $("ap-email").value.trim();
  if (!name) { say("Please add your name.", false); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("Please enter a valid email address.", false); return; }
  const cut = name.indexOf(" ");
  btn.disabled = true;
  say("Sending…", false);
  try {
    const r = await fetch(APPLY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand, tier: tierNum(),
        first_name: cut > 0 ? name.slice(0, cut) : name,
        last_name: cut > 0 ? name.slice(cut + 1) : "",
        email,
        country: $("ap-country").value.trim(),
        goals: $("ap-goals").value.trim(),
        coach_id: coachWrap.hidden ? "" : coachEl.value,
        website: ($("ap-website") || {}).value || "",
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || "Something went wrong. Please try again in a moment.");
    say("Thanks, your application is in. Check your email: we have sent you a confirmation.", true);
    for (const id of ["ap-name", "ap-email", "ap-country", "ap-goals"]) $(id).value = "";
  } catch (e) {
    say(e.message, false);
    btn.disabled = false;
  }
});
