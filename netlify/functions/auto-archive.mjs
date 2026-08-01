// netlify/functions/auto-archive.mjs
//
// Runs once a day. Anything that finished more than 24 hours ago is
// archived, so the live list only ever shows what is still ahead.
//
// Nothing else is touched — registrations, payments and coach notes
// all stay exactly where they are and remain readable in the portal
// under the archived tab.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // A course finishes at ends_at where there is one, otherwise at
  // starts_at — a workshop is a single session with no end time set.
  const { data: candidates, error } = await supabase
    .from("courses")
    .select("id, title, starts_at, ends_at")
    .eq("archived", false)
    .lt("starts_at", cutoff);

  if (error) {
    console.error("auto-archive could not read courses:", error.message);
    return new Response("error", { status: 500 });
  }

  const done = (candidates || []).filter((c) => {
    const finished = c.ends_at || c.starts_at;
    return new Date(finished) < new Date(cutoff);
  });

  if (!done.length) {
    console.log("auto-archive: nothing to do");
    return new Response("ok", { status: 200 });
  }

  const { error: updateError } = await supabase
    .from("courses")
    .update({ archived: true, status: "complete" })
    .in("id", done.map((c) => c.id));

  if (updateError) {
    console.error("auto-archive could not archive:", updateError.message);
    return new Response("error", { status: 500 });
  }

  console.log(
    `auto-archive: archived ${done.length} course(s) — ` +
    done.map((c) => c.title).join("; ")
  );
  return new Response("ok", { status: 200 });
};

export const config = { schedule: "@daily" };
