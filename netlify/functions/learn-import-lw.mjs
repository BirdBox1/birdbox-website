// netlify/functions/learn-migrate-invite.mjs
//
// Portal → Online courses → "Email the imported LearnWorlds students" (admins only).
//
// Who gets it: everyone added by the LearnWorlds import (source
// "learnworlds import") EXCEPT people who were already on the portal
// before the import (any other enrolment), staff (learn_all_access),
// anyone who has already logged in to BirdBox Learn, and anyone already
// sent this email (learn_invites).
//
// POST { action: "list" }            -> { todo: [...], skipped: {...} }
// POST { action: "send", email }      -> { ok: true }   (one person; the portal loops)
// POST { action: "test", lang }       -> { ok: true }   (sends that language to the admin)
//
// Each email is in the language of the person's course(s) and carries
// the signed 30-day /learn/start link, so one tap logs them in.

import { createClient } from "@supabase/supabase-js";
import { learnStartLink } from "./learnworlds.mjs";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const OFFICE = "info@birdboxcoaching.com";
const FROM = process.env.ALERT_FROM || "alerts@send.birdboxcoaching.com";
const json = (b, status = 200) => new Response(JSON.stringify(b), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const t = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    const { data: auth } = await db.auth.getUser(t);
    const user = auth && auth.user;
    if (!user) return json({ error: "Please log in again." }, 401);
    const { data: me } = await db.from("staff").select("role, active").eq("id", user.id).maybeSingle();
    if (!me || !me.active || me.role !== "admin") return json({ error: "Only an admin can do this." }, 403);

    const body = await req.json().catch(() => ({}));
    if (body.action === "list") return json(await list());
    if (body.action === "send") return json(await sendOne(String(body.email || "").trim().toLowerCase(), body.person || {}));
    if (body.action === "test") {
      const lang = TEXT[body.lang] ? body.lang : "en";
      await deliver(user.email, { first: "Nathan", lang, courses: [TEST_COURSE[lang]] });
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error("learn-migrate-invite:", err && (err.message || err));
    return json({ error: String((err && err.message) || err) }, 500);
  }
};

async function all(table, cols) {
  const out = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(table + ": " + error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
async function loggedIn() {
  const s = new Set();
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    for (const u of data.users) if (u.email && u.last_sign_in_at) s.add(u.email.toLowerCase());
    if (data.users.length < 1000) break;
  }
  return s;
}

// Build the list of people to email, and why the others are skipped.
async function people() {
  const [enr, courses, staff, sent, logged] = await Promise.all([
    all("learn_enrolments", "email, source, course_id, first_name, last_name"),
    all("learn_courses", "id, slug, title, language"),
    all("learn_all_access", "email"),
    all("learn_invites", "email, sent_at"),
    loggedIn(),
  ]);
  const courseBy = new Map(courses.map((c) => [c.id, c]));
  const staffSet = new Set(staff.map((s) => s.email.toLowerCase()));
  const sentBy = new Map(sent.map((s) => [s.email.toLowerCase(), s.sent_at]));
  const by = new Map();
  for (const e of enr) {
    const k = String(e.email || "").toLowerCase(); if (!k) continue;
    if (!by.has(k)) by.set(k, { email: k, first: null, last: null, imported: [], other: 0 });
    const p = by.get(k);
    if (e.source === "learnworlds import") p.imported.push(courseBy.get(e.course_id)); else p.other++;
    p.first = p.first || e.first_name; p.last = p.last || e.last_name;
  }
  const todo = [], skipped = { already_on_portal: 0, staff: 0, logged_in: 0, already_emailed: 0 };
  for (const p of by.values()) {
    if (!p.imported.length) continue;
    if (staffSet.has(p.email)) { skipped.staff++; continue; }
    if (p.other) { skipped.already_on_portal++; continue; }
    if (logged.has(p.email)) { skipped.logged_in++; continue; }
    if (sentBy.has(p.email)) { skipped.already_emailed++; continue; }
    const courses = p.imported.filter(Boolean);
    todo.push({ email: p.email, name: [p.first, p.last].filter(Boolean).join(" "), first: p.first || "", lang: pickLang(courses), courses: courses.map((c) => c.title) });
  }
  todo.sort((a, b) => a.email.localeCompare(b.email));
  return { todo, skipped };
}
async function list() { return people(); }

function pickLang(courses) {
  const langs = new Set(courses.map((c) => String(c.language || "en").slice(0, 2).toLowerCase()));
  if (langs.size === 1) { const l = [...langs][0]; if (TEXT[l]) return l; }
  return "en";
}

// The portal passes the details from "list", so each send is quick; only the
// checks that matter for sending twice are repeated here.
async function sendOne(email, p) {
  const { data: done } = await db.from("learn_invites").select("email").eq("email", email).maybeSingle();
  if (done) return { error: email + " has already been emailed." };
  const { data: imp } = await db.from("learn_enrolments").select("id").eq("email", email).eq("source", "learnworlds import").limit(1);
  if (!imp || !imp.length) return { error: email + " was not imported from LearnWorlds." };
  await deliver(email, { first: String(p.first || "").slice(0, 60), lang: TEXT[p.lang] ? p.lang : "en", courses: (Array.isArray(p.courses) ? p.courses : []).slice(0, 12).map((c) => String(c).slice(0, 120)) });
  await db.from("learn_invites").upsert({ email, sent_at: new Date().toISOString(), kind: "learnworlds-move" }, { onConflict: "email" });
  return { ok: true };
}

async function deliver(to, p) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("The email service is not set up (no Resend key).");
  const T = TEXT[p.lang] || TEXT.en;
  const link = learnStartLink(to, 30);
  const first = String(p.first || "").trim().split(/\s+/)[0];
  const hi = first ? T.hi(first) : T.hiNoName;
  const list = (p.courses || []).filter(Boolean);
  const p3 = T.p3(closeDate(p.lang));
  const text = [hi, "", T.p1, "", ...list.map((c) => "• " + c), "", T.button + ":", link, "", T.p2, "", p3, "", T.p4, "", "Nathan", "BirdBox Coaching"].join("\n");
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#16181b;max-width:540px">
<p>${esc(hi)}</p>
<p>${esc(T.p1)}</p>
${list.length ? "<ul style=\"padding-left:1.2em\">" + list.map((c) => "<li><b>" + esc(c) + "</b></li>").join("") + "</ul>" : ""}
<p style="margin:28px 0"><a href="${link.replace(/&/g, "&amp;")}" style="display:inline-block;background:#4FA8DE;color:#0C1116;text-decoration:none;font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:14px;padding:14px 26px">${esc(T.button)}</a></p>
<p>${esc(T.p2)}</p>
<p>${esc(p3)}</p>
<p>${esc(T.p4)}</p>
<p>Nathan<br>BirdBox Coaching</p>
</div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `BirdBox Coaching <${FROM}>`, to: [to], reply_to: OFFICE, subject: T.subject, text, html }),
  });
  if (!res.ok) throw new Error("The email was not accepted: " + (await res.text()).slice(0, 160));
}

// The last day BirdBox Academy (LearnWorlds) is open. Change here if the date moves.
const ACADEMY_CLOSES = "2026-10-30";
const closeDate = (lang) => new Intl.DateTimeFormat({ en: "en-GB", es: "es-ES", fr: "fr-FR", it: "it-IT", de: "de-DE" }[lang] || "en-GB",
  { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(ACADEMY_CLOSES + "T12:00:00Z"));

const TEST_COURSE = {
  en: "The Coaches Course — Level 1 Online", es: "The Gymnastics Course - en línea : Español",
  fr: "The Gymnastics Course - en ligne : Français", it: "The Gymnastics Course - online : Italiano",
  de: "The Coaches Course Level 2 - online : Deutsch",
};

const TEXT = {
  en: {
    subject: "Your BirdBox online course has moved",
    hi: (n) => `Hi ${n},`, hiNoName: "Hi,",
    p1: "Your BirdBox online course now lives on our own website, birdboxcoaching.com, instead of BirdBox Academy. Your course:",
    button: "Open my course",
    p2: "The first tap sets up your account on the new site. The link is personal to you and works for 30 days — every tap logs you straight in. Once you are in, set a password under “Set or change your password” so you can log in any time at birdboxcoaching.com/learn.",
    p3: (d) => `BirdBox Academy will stay open until ${d}, so there is no rush — but after that date your course will only be available on the new site, so please make the switch before then. Progress from the old academy does not carry across, so the course starts from the beginning here. We think you will enjoy the new home for your course.`,
    p4: "Any questions, just reply to this email.",
  },
  es: {
    subject: "Tu curso online de BirdBox se ha trasladado",
    hi: (n) => `Hola ${n}:`, hiNoName: "Hola:",
    p1: "Tu curso online de BirdBox ahora está en nuestra propia web, birdboxcoaching.com, en lugar de BirdBox Academy. Tu curso:",
    button: "Abrir mi curso",
    p2: "Al pulsarlo por primera vez se crea tu cuenta en la nueva web. El enlace es personal y funciona durante 30 días: cada vez que lo pulses entrarás directamente. Una vez dentro, crea una contraseña en «Set or change your password» para poder entrar cuando quieras en birdboxcoaching.com/learn.",
    p3: (d) => `BirdBox Academy seguirá abierta hasta el ${d}, así que no hay prisa; a partir de esa fecha tu curso solo estará disponible en la nueva web, por lo que te pedimos que te pases antes. El progreso de la antigua academia no se traslada, así que el curso empieza desde el principio aquí. Esperamos que disfrutes del nuevo hogar de tu curso.`,
    p4: "Si tienes cualquier pregunta, responde a este correo.",
  },
  fr: {
    subject: "Votre cours en ligne BirdBox a déménagé",
    hi: (n) => `Bonjour ${n},`, hiNoName: "Bonjour,",
    p1: "Votre cours en ligne BirdBox se trouve désormais sur notre propre site, birdboxcoaching.com, et non plus sur BirdBox Academy. Votre cours :",
    button: "Ouvrir mon cours",
    p2: "Le premier clic crée votre compte sur le nouveau site. Le lien vous est personnel et fonctionne pendant 30 jours : chaque clic vous connecte directement. Une fois connecté, créez un mot de passe dans « Set or change your password » pour pouvoir vous connecter à tout moment sur birdboxcoaching.com/learn.",
    p3: (d) => `BirdBox Academy restera ouverte jusqu’au ${d}, rien ne presse donc — mais après cette date, votre cours ne sera disponible que sur le nouveau site : pensez à faire le changement d’ici là. La progression de l’ancienne académie n’est pas transférée, le cours reprend donc depuis le début ici. Nous espérons que vous apprécierez ce nouvel espace.`,
    p4: "Pour toute question, répondez simplement à cet e-mail.",
  },
  it: {
    subject: "Il tuo corso online BirdBox si è trasferito",
    hi: (n) => `Ciao ${n},`, hiNoName: "Ciao,",
    p1: "Il tuo corso online BirdBox ora si trova sul nostro sito, birdboxcoaching.com, invece che su BirdBox Academy. Il tuo corso:",
    button: "Apri il mio corso",
    p2: "Il primo clic crea il tuo account sul nuovo sito. Il link è personale e funziona per 30 giorni: ogni clic ti fa accedere direttamente. Una volta dentro, imposta una password in «Set or change your password» per accedere quando vuoi su birdboxcoaching.com/learn.",
    p3: (d) => `BirdBox Academy resterà aperta fino al ${d}, quindi nessuna fretta; dopo quella data il tuo corso sarà disponibile solo sul nuovo sito, per cui ti chiediamo di passare prima. I progressi della vecchia accademia non vengono trasferiti, quindi il corso riparte dall’inizio qui. Speriamo che la nuova casa del tuo corso ti piaccia.`,
    p4: "Per qualsiasi domanda, rispondi semplicemente a questa email.",
  },
  de: {
    subject: "Dein BirdBox Online-Kurs ist umgezogen",
    hi: (n) => `Hallo ${n},`, hiNoName: "Hallo,",
    p1: "Dein BirdBox Online-Kurs befindet sich jetzt auf unserer eigenen Website, birdboxcoaching.com, statt auf der BirdBox Academy. Dein Kurs:",
    button: "Meinen Kurs öffnen",
    p2: "Beim ersten Klick wird dein Konto auf der neuen Website eingerichtet. Der Link ist persönlich und 30 Tage gültig – jeder Klick meldet dich direkt an. Lege danach unter „Set or change your password“ ein Passwort fest, damit du dich jederzeit auf birdboxcoaching.com/learn anmelden kannst.",
    p3: (d) => `Die BirdBox Academy bleibt bis zum ${d} geöffnet – es eilt also nicht. Danach ist dein Kurs nur noch auf der neuen Website verfügbar, bitte wechsle also bis dahin. Der Fortschritt aus der alten Academy wird nicht übernommen, daher beginnt der Kurs hier von vorn. Wir hoffen, dir gefällt das neue Zuhause deines Kurses.`,
    p4: "Bei Fragen antworte einfach auf diese E-Mail.",
  },
};
