/* ============================================================
   host-request.js  —  "Host a seminar" form
   Lives at the repo root, loaded by /seminars/index.html with:
     <script src="/host-request.js"></script>
   Injects a form section just above the footer and writes to
   the Supabase table public.host_requests.
   Deep link: https://birdboxcoaching.com/seminars/#host
   ============================================================ */
(function () {
  var SUPABASE_URL = "https://yvdmazpxtpuvidlcifnq.supabase.co";
  var SUPABASE_KEY = "sb_publishable_GOrQSPEuHhbKLQMgqsATvg_rKpro7uZ";

  var COURSES = [
    ["any", "Any seminar"],
    ["tgc", "TGC — The Gymnastics Course"],
    ["tcc", "TCC — The Coaches Course"],
    ["tec", "TEC — The Endurance Course"],
    ["twc", "TWC — The Weightlifting Course"]
  ];

  var COUNTRIES = ("Afghanistan|Albania|Algeria|Andorra|Angola|Argentina|Armenia|Australia|Austria|Azerbaijan|" +
    "Bahamas|Bahrain|Bangladesh|Barbados|Belarus|Belgium|Belize|Benin|Bolivia|Bosnia and Herzegovina|Botswana|" +
    "Brazil|Brunei|Bulgaria|Burkina Faso|Cambodia|Cameroon|Canada|Cape Verde|Chad|Chile|China|Colombia|" +
    "Costa Rica|Croatia|Cuba|Cyprus|Czechia|Denmark|Dominican Republic|Ecuador|Egypt|El Salvador|Estonia|" +
    "Eswatini|Ethiopia|Fiji|Finland|France|Gabon|Georgia|Germany|Ghana|Greece|Guatemala|Honduras|Hong Kong|" +
    "Hungary|Iceland|India|Indonesia|Iraq|Ireland|Israel|Italy|Ivory Coast|Jamaica|Japan|Jordan|Kazakhstan|" +
    "Kenya|Kosovo|Kuwait|Latvia|Lebanon|Liechtenstein|Lithuania|Luxembourg|Macau|Madagascar|Malaysia|Maldives|" +
    "Malta|Mauritius|Mexico|Moldova|Monaco|Mongolia|Montenegro|Morocco|Mozambique|Namibia|Nepal|Netherlands|" +
    "New Zealand|Nicaragua|Nigeria|North Macedonia|Norway|Oman|Pakistan|Panama|Papua New Guinea|Paraguay|Peru|" +
    "Philippines|Poland|Portugal|Qatar|Romania|Rwanda|Saudi Arabia|Senegal|Serbia|Singapore|Slovakia|Slovenia|" +
    "South Africa|South Korea|Spain|Sri Lanka|Sweden|Switzerland|Taiwan|Tanzania|Thailand|Trinidad and Tobago|" +
    "Tunisia|Turkey|Uganda|Ukraine|United Arab Emirates|United Kingdom|United States|Uruguay|Uzbekistan|" +
    "Venezuela|Vietnam|Zambia|Zimbabwe|Other").split("|");

  var CSS = [
    "#host { scroll-margin-top: 80px; }",
    "#host .hr-intro { max-width: 46rem; color: #C9C4C5; font-size: 16px; line-height: 1.6; margin: 0 0 18px; }",
    "#host .hr-form { border: 1px solid #342F31; background: #1C1719; padding: 20px 22px 24px; }",
    "#host .hr-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 16px; }",
    "#host .hr-f { display: block; min-width: 0; }",
    "#host .hr-f label { display: block; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #8A8385; margin-bottom: 5px; }",
    "#host .hr-f input, #host .hr-f select { width: 100%; border: 1px solid #342F31; background: #171214; color: #F2EFEF; padding: 10px 12px; font-size: 15px; font-family: inherit; border-radius: 0; -webkit-appearance: none; appearance: none; }",
    "#host .hr-f select { background-image: linear-gradient(45deg, transparent 50%, #8A8385 50%), linear-gradient(135deg, #8A8385 50%, transparent 50%); background-position: calc(100% - 18px) 50%, calc(100% - 13px) 50%; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; padding-right: 34px; }",
    "#host .hr-f input:focus, #host .hr-f select:focus { outline: none; border-color: #4FA8DE; }",
    "#host .hr-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 18px; }",
    "#host .hr-btn { border: 0; background: #4FA8DE; color: #0B0A0A; font-family: inherit; font-size: 13px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; padding: 13px 26px; cursor: pointer; }",
    "#host .hr-btn:hover { background: #6FB9E8; }",
    "#host .hr-btn[disabled] { opacity: 0.55; cursor: default; }",
    "#host .hr-msg { font-size: 14px; color: #C9C4C5; }",
    "#host .hr-msg.err { color: #E8837C; }",
    "#host .hr-msg.ok { color: #7FD3A1; }",
    "#host .hr-done { border: 1px solid #342F31; background: #1C1719; padding: 26px 22px; text-align: center; }",
    "#host .hr-done h3 { margin: 0 0 8px; font-size: 20px; font-weight: 800; }",
    "#host .hr-done p { margin: 0; color: #C9C4C5; }",
    "#host .hr-pot { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }",
    "@media (max-width: 900px) { #host .hr-grid { grid-template-columns: 1fr 1fr; } }",
    "@media (max-width: 560px) { #host .hr-grid { grid-template-columns: 1fr; } }"
  ].join("\n");

  function opts(list) {
    return list.map(function (c) {
      return Array.isArray(c)
        ? '<option value="' + c[0] + '">' + c[1] + "</option>"
        : '<option value="' + c + '">' + c + "</option>";
    }).join("");
  }

  function build() {
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    var sec = document.createElement("section");
    sec.className = "l1-section";
    sec.id = "host";
    sec.innerHTML =
      '<p class="l1-label">Bring us to you</p>' +
      '<h2 class="l1-h2">Host A Seminar</h2>' +
      '<p class="hr-intro">Want a BirdBox seminar at your gym? Send us your details and we will come back to you ' +
      "about dates, numbers and what hosting involves.</p>" +
      '<form class="hr-form" id="hr-form" novalidate>' +
        '<div class="hr-grid">' +
          '<div class="hr-f"><label for="hr-name">Contact name</label>' +
            '<input id="hr-name" name="name" type="text" autocomplete="name" required></div>' +
          '<div class="hr-f"><label for="hr-email">Contact email</label>' +
            '<input id="hr-email" name="email" type="email" autocomplete="email" inputmode="email" required></div>' +
          '<div class="hr-f"><label for="hr-gym">Gym name</label>' +
            '<input id="hr-gym" name="gym" type="text" required></div>' +
          '<div class="hr-f"><label for="hr-loc">Gym location (city / town)</label>' +
            '<input id="hr-loc" name="loc" type="text" required></div>' +
          '<div class="hr-f"><label for="hr-country">Gym country</label>' +
            '<select id="hr-country" name="country" required><option value="">Select a country</option>' + opts(COUNTRIES) + "</select></div>" +
          '<div class="hr-f"><label for="hr-air">Nearest international airport</label>' +
            '<input id="hr-air" name="airport" type="text" placeholder="e.g. Dublin (DUB)"></div>' +
          '<div class="hr-f"><label for="hr-int">Seminar of interest</label>' +
            '<select id="hr-int" name="interest">' + opts(COURSES) + "</select></div>" +
        "</div>" +
        '<div class="hr-pot"><label for="hr-web">Leave this empty</label>' +
          '<input id="hr-web" name="website" type="text" tabindex="-1" autocomplete="off"></div>' +
        '<div class="hr-actions">' +
          '<button class="hr-btn" id="hr-send" type="submit">Send request</button>' +
          '<span class="hr-msg" id="hr-msg"></span>' +
        "</div>" +
      "</form>";

    var footer = document.querySelector("footer");
    if (footer && footer.parentNode) footer.parentNode.insertBefore(sec, footer);
    else document.body.appendChild(sec);

    wire(sec);

    // Deep link: /seminars/#host  (the section is added after load, so scroll here)
    var h = (location.hash || "").toLowerCase();
    if (h === "#host" || h === "#host-a-seminar" || h === "#hosting") {
      setTimeout(function () { sec.scrollIntoView({ behavior: "smooth", block: "start" }); }, 120);
    }
  }

  function wire(sec) {
    var form = sec.querySelector("#hr-form");
    var msg = sec.querySelector("#hr-msg");
    var btn = sec.querySelector("#hr-send");
    var val = function (id) { return (sec.querySelector(id).value || "").trim(); };

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      msg.className = "hr-msg";

      if (val("#hr-web")) return; // bot

      var row = {
        contact_name: val("#hr-name"),
        contact_email: val("#hr-email"),
        gym_name: val("#hr-gym"),
        gym_location: val("#hr-loc"),
        gym_country: val("#hr-country"),
        nearest_airport: val("#hr-air"),
        interest: val("#hr-int") || "any"
      };

      if (!row.contact_name || !row.contact_email || !row.gym_name || !row.gym_location || !row.gym_country) {
        msg.className = "hr-msg err";
        msg.textContent = "Please fill in name, email, gym, location and country.";
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.contact_email)) {
        msg.className = "hr-msg err";
        msg.textContent = "That email address does not look right.";
        return;
      }

      btn.disabled = true;
      msg.textContent = "Sending…";

      fetch(SUPABASE_URL + "/rest/v1/host_requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: "Bearer " + SUPABASE_KEY,
          Prefer: "return=minimal"
        },
        body: JSON.stringify(row)
      })
        .then(function (r) {
          if (!r.ok) return r.text().then(function (t) { throw new Error(t || r.status); });
          sec.querySelector(".hr-intro").remove();
          form.outerHTML =
            '<div class="hr-done"><h3>Thank you — request received</h3>' +
            "<p>We have your details and will be in touch by email about hosting.</p></div>";
        })
        .catch(function (err) {
          btn.disabled = false;
          msg.className = "hr-msg err";
          msg.textContent = "Sorry — that did not send. Please email info@birdboxcoaching.com instead.";
          if (window.console) console.error("host-request:", err);
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
