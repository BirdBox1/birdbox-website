/* portal/plan-prefill.js
 *
 * Promote a plan to a live course.
 *
 * The scheduling planner links to /portal/?plan=<uuid>. This reads that
 * plan, opens the portal's own New course form, and fills it in. It does
 * not create anything — an admin still reads the form and presses Create
 * course, which is the point: a plan becomes real when a human says so.
 *
 * Nothing here reaches into portal/index.html. It works the same way a
 * person would: it presses the New course button, types into the fields,
 * and lets the portal's own handlers do the slug, the time zone, the
 * currency and the standard price. That way this file can never disagree
 * with what the form would have done on its own.
 *
 * Once the course is created, the plan is stamped live and pointed at it.
 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://yvdmazpxtpuvidlcifnq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ";

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);

/* ---------------- waiting ---------------- */

// The portal signs in, loads the staff row, then reveals New course.
// None of that is finished when this file runs, so everything below
// waits for the page to be ready rather than assuming it.
function waitFor(test, label, ms = 25000, step = 120) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let ready = false;
      try { ready = !!test(); } catch (e) { ready = false; }
      if (ready) return resolve(true);
      if (Date.now() - started > ms) return reject(new Error("Timed out waiting for " + label));
      setTimeout(tick, step);
    };
    tick();
  });
}

const visible = (id) => {
  const el = $(id);
  return !!el && !el.classList.contains("hidden");
};

/* ---------------- filling ---------------- */

function fire(el, names) {
  for (const name of names) {
    el.dispatchEvent(new Event(name, { bubbles: true }));
  }
}

function setValue(id, value, events) {
  const el = $(id);
  if (!el) return false;
  if (value == null || value === "") return false;
  el.value = String(value);
  if (events && events.length) fire(el, events);
  return true;
}

// The form offers L1 and L2. A plan may hold "1", "L1" or "Level 1".
function levelOption(raw) {
  const digits = String(raw == null ? "" : raw).replace(/\D/g, "");
  return digits ? "L" + digits : "";
}

// A plan carries a weekend, not a pair of dates. A seminar runs the
// Saturday and the Sunday; a workshop is one day. The times stay at the
// form's own defaults, because a plan has never held them.
function dayAfter(isoDate) {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// A plan with no level is a workshop — that is the only thing on the
// calendar that has no level, and the form asks for one otherwise.
const planType = (plan) => (levelOption(plan.level) ? "live_seminar" : "workshop");

function setCoach(staffId) {
  if (!staffId) return false;
  const box = $("coachlist");
  if (!box) return false;
  const rows = box.querySelectorAll("select");
  for (const sel of rows) {
    if (sel.dataset && sel.dataset.staff === staffId) {
      sel.value = "lead_coach";
      fire(sel, ["change"]);
      return true;
    }
  }
  return false;
}

// Order matters here, and it is the order a person would type in.
// Brand and type settle what the rest of the form looks like; country
// settles the currency, the state picker and the time zone; currency
// fills the standard price, so anything the plan priced differently is
// written over the top of it afterwards.
function fillFromPlan(plan) {
  const notes = [];
  const type = planType(plan);

  setValue("f-brand", plan.brand, ["change"]);
  setValue("f-type", type, ["change"]);
  setValue("f-level", levelOption(plan.level), ["change"]);
  setValue("f-language", plan.language, ["change"]);

  setValue("f-country", String(plan.country || "").toUpperCase(), ["change"]);
  setValue("f-state", String(plan.state || "").toUpperCase(), ["change"]);

  // Written after the country, because choosing a country either sets
  // the zone or deliberately clears it. The plan's own zone wins.
  setValue("f-timezone", plan.timezone, ["input", "change"]);

  setValue("f-city", plan.city, ["input", "change", "blur"]);
  setValue("f-venue", plan.venue_name);
  setValue("f-address", plan.address);

  if (plan.latitude != null) setValue("f-lat", plan.latitude);
  if (plan.longitude != null) setValue("f-lng", plan.longitude);
  if (plan.latitude == null || plan.longitude == null) {
    notes.push("no map pin on the plan — use Look up from address");
  }

  setValue("f-hostname", plan.host_name);
  setValue("f-hostemail", plan.host_email);
  if (plan.host_spots != null) setValue("f-hostspots", plan.host_spots);
  if (plan.prepaid_spots != null) setValue("f-prepaid", plan.prepaid_spots);
  if (plan.capacity != null) setValue("f-capacity", plan.capacity);

  // Changing the currency fills in the standard price, so the plan's own
  // figures go in after it or they would be wiped.
  setValue("f-currency", plan.currency, ["change"]);
  if (plan.price_cents != null) {
    setValue("f-price", (plan.price_cents / 100).toFixed(2));
    notes.push("price taken from the plan");
  }
  if (plan.deposit_cents != null) {
    setValue("f-deposit", (plan.deposit_cents / 100).toFixed(2));
  }

  if (plan.weekend_start) {
    setValue("f-date", plan.weekend_start, ["change", "input"]);
    if (type === "live_seminar") {
      setValue("f-enddate", dayAfter(plan.weekend_start), ["change", "input"]);
    }
  }

  if (plan.coach_staff_id && !setCoach(plan.coach_staff_id)) {
    notes.push("the planned coach is not in the picker — assign one below");
  }

  const admin = [
    "From plan " + String(plan.id).slice(0, 8),
    plan.market ? "market: " + plan.market : "",
    plan.note || "",
    plan.coach_note || "",
  ].filter(Boolean).join(" · ");
  setValue("f-adminnotes", admin);

  // Deliberately a draft. Promoting a plan should not put a seminar on
  // sale before anybody has read the form back.
  setValue("f-status", "draft");

  return notes;
}

/* ---------------- saying what happened ---------------- */

function describe(plan, notes) {
  const title = $("form-title");
  const sub = $("form-sub");
  if (title) title.textContent = "New course — from a plan";
  if (!sub) return;

  const where = [plan.venue_name, plan.city || plan.market].filter(Boolean).join(", ");
  const bits = [
    "Filled in from the " + (plan.stage || "planned") + " plan for " +
      (where || plan.market) + ", weekend of " + (plan.weekend_start || "—") + ".",
    "It is set to Draft — read it through, then change Status to Published before creating it.",
  ];
  if (notes.length) bits.push("Worth checking: " + notes.join("; ") + ".");
  sub.textContent = bits.join(" ");
}

/* ---------------- linking the plan to the course ---------------- */

// The created panel shows the registration link and nothing else, so the
// course is found by its slug. Watched rather than hooked, because
// nothing in this file can reach inside the portal's own module.
function watchForCreated(plan) {
  let handled = false;

  const timer = setInterval(() => {
    if (handled) return;
    if (!visible("created")) return;
    const box = $("created-link");
    const link = box && box.value ? box.value.trim() : "";
    if (!link) return;
    handled = true;
    clearInterval(timer);
    linkPlanToCourse(plan, link);
  }, 500);

  // A form left open all afternoon should not keep polling forever.
  setTimeout(() => clearInterval(timer), 45 * 60 * 1000);
}

async function linkPlanToCourse(plan, link) {
  const sub = $("form-sub");
  const say = (text) => { if (sub) sub.textContent = text; };

  const slug = link.replace(/\/+$/, "").split("/").pop();
  if (!slug) { say("Course created, but the plan could not be linked to it."); return; }

  const { data: course, error: findErr } = await db
    .from("courses").select("id, title").eq("slug", slug).maybeSingle();

  if (findErr || !course) {
    say("Course created, but the plan could not be linked to it — " +
        (findErr ? findErr.message : "the new course could not be found by its link."));
    return;
  }

  const { error } = await db.from("planned_seminars").update({
    course_id: course.id,
    stage: "live",
    updated_at: new Date().toISOString(),
  }).eq("id", plan.id);

  say(error
    ? "Course created, but the plan is still marked " + (plan.stage || "as it was") +
      " — " + error.message
    : "Course created. The plan is now marked live and linked to it.");
}

/* ---------------- go ---------------- */

async function run() {
  const planId = new URLSearchParams(location.search).get("plan");
  if (!planId) return;

  try {
    // New course only appears for an admin, once the staff row is read.
    await waitFor(() => visible("newcourse"), "the portal to finish signing in");
  } catch (err) {
    window.alert(
      "This link opens a plan in the new-course form, which is admin only.\n\n" +
      "Sign in as an admin and open the link again."
    );
    return;
  }

  const { data: plan, error } = await db
    .from("planned_seminars").select("*").eq("id", planId).maybeSingle();

  if (error) { window.alert("Could not load that plan: " + error.message); return; }
  if (!plan) { window.alert("No plan found for that link. It may have been deleted."); return; }

  if (plan.course_id && !window.confirm(
    "This plan has already been promoted — a course was created from it.\n\n" +
    "Carry on and create a second one?"
  )) return;

  $("newcourse").click();

  try {
    // openForm builds the countries, the time zones, the price table and
    // the coach picker. The picker is last, so it is what to wait for.
    await waitFor(
      () => visible("view-new") && $("coachlist").querySelectorAll("select").length > 0,
      "the new-course form to open"
    );
  } catch (err) {
    window.alert("The new-course form did not open. Try the New course button yourself.");
    return;
  }

  const notes = fillFromPlan(plan);
  describe(plan, notes);
  watchForCreated(plan);
}

run();
