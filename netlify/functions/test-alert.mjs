// netlify/functions/test-alert.mjs
//
// TEMPORARY. Delete this file once the alert email is confirmed working.
//
// Visit:  /.netlify/functions/test-alert?key=birdbox-test-2026

const ALERT_EMAIL = "info@birdboxcoaching.com";
const PASSWORD = "birdbox-test-2026";

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== PASSWORD) {
    return new Response("Not found", { status: 404 });
  }

  const key = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM || "(ALERT_FROM not set)";

  const report =
    "RESEND_API_KEY present: " + (key ? "yes" : "NO") + "\n" +
    "RESEND_API_KEY length: " + (key ? key.length : 0) + "\n" +
    "RESEND_API_KEY starts: " + (key ? key.slice(0, 3) : "—") + "\n" +
    "ALERT_FROM: " + from + "\n\n";

  if (!key) {
    return new Response(
      report + "The function cannot see the key, so nothing was sent.\n" +
      "Check the Production value of RESEND_API_KEY in Netlify.",
      { status: 200, headers: { "Content-Type": "text/plain" } }
    );
  }

  const body =
    "This is a test of the BirdBox alert email.\n\n" +
    "If you are reading this in info@birdboxcoaching.com, then when a " +
    "real course balance fails every retry, you will be told.\n\n" +
    "Sent at " + new Date().toISOString();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com",
        to: [ALERT_EMAIL],
        subject: "[BirdBox] Test — course balance unpaid alert",
        text: body,
      }),
    });

    const data = await res.json();

    return new Response(
      report +
      (res.ok
        ? "Sent. Check " + ALERT_EMAIL + " (and spam).\nResend id: " + (data.id || "—")
        : "Resend rejected it:\n\n" + JSON.stringify(data, null, 2)),
      { status: 200, headers: { "Content-Type": "text/plain" } }
    );
  } catch (err) {
    return new Response(report + "Failed: " + err.message, { status: 500 });
  }
};
