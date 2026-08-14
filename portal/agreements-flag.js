// Puts a red count on the Agreements link in the portal top bar,
// showing how many agreements are waiting for this person's signature.
//
// It lives in its own file rather than inside portal/index.html, which
// is large enough that editing it by hand on an iPad is a risk in
// itself. Nothing else depends on this script: if it fails, the link
// still works and the agreements page still lists what is owed.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const db = createClient(
  "https://yvdmazpxtpuvidlcifnq.supabase.co",
  "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ"
);

const LINK_ID = "agreementslink";

// The portal signs in after this script loads, so waiting for a
// session is normal rather than a failure. It gives up quietly after
// a minute — somebody sitting on the sign-in screen is not signed in.
const CHECK_EVERY_MS = 1500;
const GIVE_UP_AFTER_MS = 60000;

function paint(count) {
  const link = document.getElementById(LINK_ID);
  if (!link) return;

  const existing = link.querySelector(".unread-flag");
  if (existing) existing.remove();

  if (!count) return;

  const flag = document.createElement("span");
  flag.className = "unread-flag";
  flag.textContent = count > 9 ? "9+" : String(count);
  flag.title = `${count} agreement${count === 1 ? "" : "s"} waiting for your signature`;
  link.append(flag);
}

// An admin can see every agreement, including ones meant for other
// people, so only the ones actually theirs are counted — otherwise the
// number would say "3 waiting" at somebody who owes nothing.
async function countOwed(staffId) {
  const [docs, sigs, mine] = await Promise.all([
    db.from("agreements").select("id, audience").eq("active", true),
    db.from("agreement_signatures").select("agreement_id").eq("staff_id", staffId),
    db.from("agreement_assignments").select("agreement_id").eq("staff_id", staffId),
  ]);

  if (docs.error) throw new Error(docs.error.message);

  const signed = new Set((sigs.data || []).map((s) => s.agreement_id));
  const assigned = new Set((mine.data || []).map((a) => a.agreement_id));

  return (docs.data || []).filter(
    (d) => !signed.has(d.id) && (d.audience === "all" || assigned.has(d.id))
  ).length;
}

async function run() {
  const started = Date.now();

  while (Date.now() - started < GIVE_UP_AFTER_MS) {
    const { data: { session } } = await db.auth.getSession();

    if (session) {
      try {
        paint(await countOwed(session.user.id));
      } catch (err) {
        console.error("Could not count agreements:", err.message);
      }
      return;
    }
    await new Promise((r) => setTimeout(r, CHECK_EVERY_MS));
  }
}

// Signing in without reloading the page has to update the count too,
// or somebody who just signed in sees nothing until they navigate.
db.auth.onAuthStateChange(async (event, session) => {
  if (event === "SIGNED_OUT") { paint(0); return; }
  if (!session) return;
  try {
    paint(await countOwed(session.user.id));
  } catch (err) {
    console.error("Could not count agreements:", err.message);
  }
});

run();
