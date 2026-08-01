// netlify/functions/test-alert.mjs
//
// TEMPORARY. Delete this file once the alert email is confirmed working.
//
// Visit:  /.netlify/functions/test-alert?key=<RESEND_API_KEY>
//
// Sends the same kind of alert the webhook sends when a course balance
// has failed every retry, so we can prove the email actually arrives
// rather than assuming it will weeks from now.

const ALERT_EMAIL = "info@birdboxcoaching.com";

export default async (req) => {
  const url = new URL(req.url);
  const key = process.env.RESEND_API_KEY;

  // Gate on the key itself so a stray visitor cannot send mail.
  if (!key || url.searchParams.get("key") !== key) {
    return new Response("Not found", { status: 404 });
  }

  const from = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";

  const body =
    "This is a test of the BirdBox alert email.\n\n" +
    "If you are reading this in info@birdboxcoaching.com, then when a " +
    "real course balance fails every retry, you will be told.\n\n" +
    "Example of the real thing:\n\n" +
    "  Jane Smith (jane@example.com) paid a deposit for tgc-l1-london-1126 " +
    "but the balance has failed every retry and is still unpaid.\n" +
    "  Amount outstanding: 410.00 GBP\n" +
    "  Stripe invoice: in_1234567890\n\n" +
    "  They have not been removed from the course — contact them or " +
    "remove them manually.\n\n" +
    "Sent at " + new Date().toISOString();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [ALERT_EMAIL],
        subject: "[BirdBox] Test — course balance unpaid alert",
        text: body,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(
        "Resend rejected it:\n\n" + JSON.stringify(data, null, 2),
        { status: 200, headers: { "Content-Type": "text/plain" } }
      );
    }

    return new Response(
      "Sent. Check " + ALERT_EMAIL + " (and spam).\n\n" +
      "From: " + from + "\nResend id: " + (data.id || "—"),
      { status: 200, headers: { "Content-Type": "text/plain" } }
    );
  } catch (err) {
    return new Response("Failed: " + err.message, { status: 500 });
  }
};
