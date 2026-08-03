<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>You're registered — BirdBox Coaching</title>
<style>
  :root {
    --ink: #eceae6; --paper: #101215; --panel: #191c20; --shell: #0d0e10;
    --rule: rgba(255,255,255,0.14); --muted: #99a0a8;
    --brandcolour: #2f7fd0; --good: #6fbf87;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 17px; line-height: 1.65; -webkit-font-smoothing: antialiased;
    min-height: 100vh;
  }
  .bar {
    background: var(--shell); padding: 0.7rem 1.25rem;
    display: flex; align-items: center; gap: 0.75rem;
    border-bottom: 1px solid var(--rule);
  }
  .mark { width: 32px; height: 32px; border-radius: 4px; background: #fff;
          display: grid; place-items: center; flex: none; }
  .mark img { width: 24px; height: 24px; object-fit: contain; }
  .bar .name { font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #9aa1a9; }

  .wrap { max-width: 36rem; margin: 0 auto; padding: 2.6rem 1.25rem 4rem; }

  .tick {
    width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center;
    background: var(--brandcolour); color: #fff; font-size: 28px; line-height: 1;
    margin-bottom: 1.2rem;
  }
  h1 {
    font-size: clamp(1.5rem, 4.6vw, 2rem); line-height: 1.15;
    letter-spacing: -0.02em; font-weight: 700; margin: 0 0 0.5rem;
  }
  .sub { color: var(--muted); margin: 0 0 2rem; }

  .card {
    background: var(--panel); border: 1px solid var(--rule);
    border-top: 3px solid var(--brandcolour);
    border-radius: 6px; padding: 1.25rem; margin: 0 0 1.5rem;
  }
  .cname { font-weight: 700; font-size: 1.15rem; }
  .cdate { font-size: 1.05rem; margin-top: 0.15rem; }
  .cvenue { margin-top: 0.6rem; }
  .caddr { color: var(--muted); font-size: 0.95rem; }
  .paid {
    margin-top: 1rem; padding-top: 0.9rem; border-top: 1px solid var(--rule);
    display: flex; justify-content: space-between; gap: 1rem; font-weight: 650;
  }
  .paid .label { font-weight: 400; color: var(--muted); }

  h2 {
    font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--muted); font-weight: 600; margin: 2rem 0 0.6rem;
  }
  p { margin: 0 0 1rem; }

  .btn {
    display: inline-block; background: var(--brandcolour); color: #fff;
    text-decoration: none; font-weight: 650; padding: 0.85rem 1.4rem;
    border-radius: 5px; margin-top: 0.3rem;
  }
  .note {
    background: rgba(255,255,255,0.05); border: 1px solid var(--rule);
    border-radius: 5px; padding: 0.85rem 1rem; font-size: 0.95rem; margin: 0 0 1rem;
  }

  footer {
    margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid var(--rule);
    font-size: 0.82rem; color: var(--muted);
  }
  footer a { color: var(--muted); }
  .state { padding: 4rem 0; text-align: center; color: var(--muted); }
  .state a { color: var(--ink); }
  .hidden { display: none !important; }
</style>
</head>
<body>

<div class="bar">
  <span class="mark"><img src="/brand/birdBox.png" alt=""></span>
  <span class="name">BirdBox Coaching</span>
</div>

<div class="wrap">
  <div id="loading" class="state"><p>Confirming your registration…</p></div>

  <div id="problem" class="state hidden">
    <p id="problemtext">We could not load your registration.</p>
    <p>If you were charged, you are registered and your confirmation email is on its way.
       Contact <a href="mailto:info@birdboxcoaching.com">info@birdboxcoaching.com</a> if anything looks wrong.</p>
  </div>

  <main id="done" class="hidden">
    <div class="tick">✓</div>
    <h1 id="title">You're registered</h1>
    <p class="sub" id="sub">Thank you. Your place is booked.</p>

    <div class="card">
      <div class="cname" id="cname"></div>
      <div class="cdate" id="cdate"></div>
      <div class="cvenue" id="cvenue"></div>
      <div class="caddr" id="caddr"></div>
      <div class="paid">
        <span class="label" id="paidlabel">Paid</span>
        <span id="paidamount"></span>
      </div>
    </div>

    <div class="note hidden" id="balancenote"></div>

    <h2>What happens next</h2>
    <p id="emailline">A confirmation email is on its way with everything you need for the day.</p>

    <div id="manualwrap" class="hidden">
      <h2>Your course manual</h2>
      <p>Have a read before you arrive — it is available in several languages.</p>
      <a class="btn" id="manuallink" href="#">Open your course manual</a>
    </div>

    <footer>
      <p>Registering means you accepted our
        <a href="/agreements/#terms">terms of sale</a> and
        <a href="/agreements/#waiver">waiver of liability</a>.</p>
      <p>BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland ·
        <a href="mailto:info@birdboxcoaching.com">info@birdboxcoaching.com</a></p>
    </footer>
  </main>
</div>

<script>
const $ = (id) => document.getElementById(id);

const sessionId = new URLSearchParams(location.search).get("session_id");

load();

async function load() {
  if (!sessionId) return problem("This page needs a registration link from checkout.");

  try {
    const res = await fetch(
      "/.netlify/functions/registration-summary?session_id=" + encodeURIComponent(sessionId)
    );
    const data = await res.json();
    if (!data || !data.ok) return problem(data && data.error);

    document.documentElement.style.setProperty("--brandcolour", data.colour);
    if (data.icon) document.querySelector(".mark img").src = data.icon;

    if (data.firstName) {
      $("title").textContent = "You're registered, " + data.firstName;
    }
    document.title = "You're registered — " + data.courseName;

    $("cname").textContent = data.courseName;
    $("cdate").textContent = data.dates;
    $("cvenue").textContent = data.venueName || "";
    $("caddr").textContent = data.address || "";

    $("paidlabel").textContent = data.isDeposit ? "Deposit paid" : "Paid";
    $("paidamount").textContent = data.amountPaid;

    if (data.isDeposit) {
      $("balancenote").textContent =
        "The remaining " + data.balance + " will be charged automatically to the same card" +
        (data.balanceDate ? " on " + data.balanceDate : "") +
        ", " + data.balanceDaysBefore + " days before the course starts.";
      $("balancenote").classList.remove("hidden");
    }

    if (data.emailedTo) {
      $("emailline").textContent =
        "A confirmation email is on its way to " + data.emailedTo +
        " with everything you need for the day.";
    }

    if (data.manualUrl) {
      $("manuallink").href = data.manualUrl;
      $("manualwrap").classList.remove("hidden");
    }

    if (!data.paid) {
      $("sub").textContent =
        "Your payment is still being confirmed by your bank. You will get an email as soon as it clears.";
    }

    $("loading").classList.add("hidden");
    $("done").classList.remove("hidden");
  } catch (e) {
    problem();
  }
}

function problem(message) {
  if (message) $("problemtext").textContent = message;
  $("loading").classList.add("hidden");
  $("problem").classList.remove("hidden");
}
</script>

</body>
</html>
