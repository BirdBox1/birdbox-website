# Handover: Spanish TCC Level 1 Online

Written 27 Oct 2026, at the end of the session that built the Spanish version of
The Coaches Course (TCC) Level 1 Online and put it on sale.

---

## Paste this into the new chat

> I'm carrying on from a previous chat. Read `HANDOVER-Spanish-TCC-online.md` in
> the root of the birdbox-website repo (on `main`, or on branch
> `claude/portal-note-saving-kq2muz`) before doing anything. It covers the Spanish
> TCC Level 1 online course: the course, the Spanish portfolio, YouTube uploads
> with Nico, and the English/Español checkout, which is live. Then tell me in a
> few lines where things stand and what you'd do next from its numbered list.
> Don't change anything live until I say so.

---

## 1. Purpose

The goal was to sell The Coaches Course Level 1 Online in Spanish alongside
English, with a Spanish buyer getting a fully Spanish experience:

- the course (Rise 360 / SCORM, hosted on our own site),
- the dubbed videos (YouTube, uploaded by Nico),
- the learner portfolio,
- and the checkout.

Choosing Spanish had to be "clear and obvious" for buyers.

## 2. Current state (checked 27 Oct 2026)

**Live and working**

- **Sales page:** `https://birdboxcoaching.com/tcc/online-level-1/`
  - The chip says "2 Languages / English / Español".
  - The Language section is headed "Available In English And Spanish".
  - The FAQ is updated to match.
- **Checkout, step 1:** "Choose your course language", with two large buttons:
  - **English**: "The whole course in English"
  - **Español**: "Todo el curso en español"
- **Choosing Español:** the whole buy box switches to Spanish. That covers:
  - the steps, price notes and VAT wording (IVA),
  - the button ("Continuar al pago seguro") and the help text,
  - the country names (España, Francia…).
- **Stripe page in Spanish:** the payment page opens with locale `es`, and the
  course description and terms checkbox are in Spanish.
- **Preselection:** Español is chosen automatically for Spanish-language
  browsers, and for any link ending `?lang=es`, e.g.
  `https://birdboxcoaching.com/tcc/online-level-1/?lang=es` (use this in Spanish
  emails and posts).
- **Enrolment:** a buyer who picks Español is enrolled in the on-site course
  `tcc-l1-es`. A buyer who picks English gets `tcc-l1-en` (LearnWorlds id
  `bbcdlevel1`).
  - Both are on-site courses: they are hosted on our site and opened from
    `/learn/`, not given in LearnWorlds.
  - On 27 Oct, `tcc-l1-es` already had **31 enrolments**.
- **Prices:** the same in both languages. They are set per brand and level in
  `course_prices`.
- **The Gymnastics Course (TGC):** the same language buttons now show on its
  checkout, with four languages (English, Español, Français, Italiano).
  - The box text is translated for Spanish only.
  - French and Italian buyers get Stripe's own page in their language, but our
    text stays in English.
- **Spanish portfolio:** `/learn/portfolio/es/` (`learn/portfolio/es/index.html`).
  - Its tool links have the form
    `https://birdboxcoaching.com/learn/portfolio/es/?tool=X`.
  - The imagery exercise has dubbed Spanish audio: `learn/portfolio/es/imagery-es.mp3`.

**Not yet confirmed by the user**

- Seeing the Stripe payment page in Spanish (a click on "Continuar al pago
  seguro" shows it; it can be closed without paying).
- A full test enrolment in Spanish, end to end. The 31 enrolments suggest the
  flow works, but nobody checked them in this chat.

## 3. How it works (technical)

**Language list.** The table `online_products` (Supabase project
`yvdmazpxtpuvidlcifnq`, "BirdBox Registration") decides which languages a
course is sold in. One row per brand, level and language:

| brand | level | language | label | lw_course_id | sort |
|---|---|---|---|---|---|
| tcc | 1 | en | The Coaches Course Level 1 Online (English) | bbcdlevel1 | 1 |
| tcc | 1 | es | The Coaches Course Level 1 Online (Español) | tcc-l1-es | 2 |
| tgc | 1 | en / es / fr / it | The Gymnastics Course … | the-gymnastics-course-l1-… | 1–4 |

**Course link.** `learn_courses`: the row for slug `tcc-l1-es` has
`lw_course_id = 'tcc-l1-es'`, `on_site = true` and `active = true`.
`netlify/functions/learnworlds.mjs` (`mirrorToLearn`, `isOnSite`) matches
`lw_course_id` to `learn_courses`. When every match is on-site, the buyer goes
into `learn_enrolments` and LearnWorlds is skipped. The id `tcc-l1-es` is ours,
not a real LearnWorlds id; that is fine because the course is on-site.

**Switching it on.** Spanish was switched on on 15 Oct 2026 by running this
directly on the database (it is not a migration file):

```sql
update learn_courses set lw_course_id = 'tcc-l1-es', on_site = true where slug = 'tcc-l1-es';
insert into online_products (brand, level, language, label, lw_course_id, sort)
values ('tcc', '1', 'es', 'The Coaches Course Level 1 Online (Español)', 'tcc-l1-es', 2);
```

**Code**

- **`online-buy.js`**: the buy box on both sales pages.
  - `LANG_NAME` and `LANG_NOTE` hold the button text.
  - `startLanguage()` picks the starting language: `?lang=` first, then the
    browser language, then the first in the list.
  - `WORDS.en` and `WORDS.es` hold all the box text, read through `W()`.
  - `countries()` names the countries in the chosen language.
  - The language buttons only appear when a course has more than one language.
    With one language it shows "Your course: …".
- **`netlify/functions/online-checkout.mjs`**: the API behind the buy box.
  - GET returns `{currency, country, prices, languages, months, vat, on_site}`.
  - POST creates the Stripe Checkout session.
  - `stripeWords(language)` sets the Stripe `locale` (es, fr, it, de or pt, else
    auto) and gives Spanish text for the description and terms. It is used in
    both the normal checkout and the 50%-offer checkout.
- **`tcc/online-level-1/index.html`**: the sales page text.

**Testing.** Supabase storage and birdboxcoaching.com are blocked from the cloud
sandbox, so the checkout was tested locally with Playwright against a mocked
API:

- serve the repo with `python3 -m http.server 8767`;
- launch Chromium with `executablePath: '/opt/pw-browsers/chromium'`;
- mock `online-checkout` with `route()`.

## 4. Decisions and why

1. **Lift names stay in English** in the Spanish material (snatch, not
   "arrancada"; clean, etc.). The user corrected this: these are CrossFit
   movement names that Spanish-speaking coaches use in English.
2. **Acronyms are kept as they are**: R.A.M.P, D.R.O.M, N.A.M.S.E.T.
3. **Separate Spanish portfolio, no language dropdown.** The user preferred
   that the portfolio language follows the course. The Spanish course links to
   `/learn/portfolio/es/`, and the English course links to the English one.
4. **Language is step 1 of the checkout, as big buttons in each language's own
   words.** The user asked that it be "clear and obvious" for buyers to pick
   and access Spanish. A dropdown was judged too easy to miss.
5. **The button notes avoid the word "portfolio".** The first wording was
   "Course, videos and portfolio in …", but TGC has no portfolio. It was changed
   to "The whole course in …" (PR #28).
6. **The whole box and the Stripe page follow the chosen language.** The user
   asked whether a Spanish buyer sees the rest of the payment information in
   Spanish (PR #29). Only Spanish text was written; other languages fall back
   to English text, with Stripe's own page in their language.
7. **Same price for every language.** Prices are per brand and level, and no
   per-language pricing was asked for.
8. **Spanish was switched on only after the user's go-ahead.** It goes live
   instantly and enrols buyers, so I asked first. The user showed the page
   still offering only English, which was taken as the go-ahead.
9. **YouTube uploads were batched through Nico.** YouTube has a daily thumbnail
   limit with no workaround.
10. **Videos must not be "Made for kids".** The user's first uploads were set
    that way, which turns off comments and other features. Change them to
    "not made for kids".

## 5. Files, branches, PRs, URLs

**Repo:** `BirdBox1/birdbox-website`. The working branch is
`claude/portal-note-saving-kq2muz`. All of its earlier work is merged into
`main`; this handover file was committed on top of the latest `main`.

| PR | What | State |
|---|---|---|
| #21 | Portal participant list fix (JS ended up inside CSS) | merged |
| #22 | Spanish portfolio `/learn/portfolio/es/` | merged |
| #27 | Spanish imagery audio, plus English/Español checkout buttons and sales page text | merged |
| #28 | Language button notes that fit every course (no "portfolio") | merged |
| #29 | Whole checkout and Stripe page in Spanish when Español is chosen | merged |

**Key files:** `online-buy.js`, `netlify/functions/online-checkout.mjs`,
`netlify/functions/learnworlds.mjs`, `tcc/online-level-1/index.html`,
`tgc/online-level-1/index.html`, `learn/portfolio/es/index.html`,
`learn/portfolio/es/imagery-es.mp3`.

**URLs**

- Sales page: https://birdboxcoaching.com/tcc/online-level-1/ (Spanish
  preselected: append `?lang=es`)
- Spanish portfolio: https://birdboxcoaching.com/learn/portfolio/es/
- Learner area: https://birdboxcoaching.com/learn/
- Netlify site: `warm-beijinho-9a5b1c` (id
  `b1a75cca-9d7b-4b55-9763-1a39785df32a`), primary domain birdboxcoaching.com
- Supabase project: `yvdmazpxtpuvidlcifnq`
- Google Sheet for Nico: "TCC Nivel 1 Español – YouTube uploads (Nico)", id
  `1C6qcp3A_fpzLCjMAOB9SL6aPtEeiZN0BFNXIe7jSw6Y`

**Thumbnails.** About 70 YouTube thumbnails were made: black background, the
TCC logo and an Oswald title. Titles follow the pattern
"Title | TCC Nivel 1 Online". The renderer script and the image files lived in
the old session's temporary scratchpad and are **not** in the repo. Rebuild
them if more are needed; the style is above.

## 6. People

- **Nathan Bird** (info@birdboxcoaching.com): owner and the user of this chat.
  Merges the PRs and uploads the courses in the portal.
- **Nico**: uploads the Spanish videos to YouTube. Works from the Google Sheet
  above, and received a zip with the videos and thumbnails (18 new thumbnails
  plus 9 that were missing, mainly the "Maximum Motor Potential" ones).
- **London attendees (13)**: an earlier correction email was sent to them. This
  is done and unrelated to the Spanish work.

## 7. Open questions

1. Has the Spanish Stripe page been seen and checked in a real checkout?
2. Are the 31 `tcc-l1-es` enrolments real buyers, or test or migrated
   enrolments? Can they open the course?
3. **Spanish exam check.** The user asked for a check of the Spanish exam
   against the English one. This needs both SCORM export zips, which were never
   provided.
4. Should the Spanish portfolio's calculators use English lift names (snatch,
   clean…) to match decision 1? This was offered, not done.
5. In the portfolio, should "cuatro vías" become "cuatro estilos"? Should back
   squat and air squat be named in English or Spanish? Both were offered, not
   done.
6. Should French and Italian (TGC) get translated box text, like Spanish?
7. Have all the YouTube videos been changed from "Made for kids" to "not made
   for kids"?

## 8. Next steps

1. **Check a Spanish purchase end to end.** Open
   `/tcc/online-level-1/?lang=es`, click "Continuar al pago seguro" and
   confirm the Stripe page is in Spanish. Then do one real or test enrolment
   and check that `tcc-l1-es` opens in `/learn/` for that account.
2. **Look at the 31 Spanish enrolments** in `learn_enrolments` (course
   `tcc-l1-es`): their source, and whether they paid.
3. **Exam check:** ask the user for the English and Spanish SCORM export zips,
   then compare the questions and answers.
4. **Spanish portfolio wording:** apply open questions 4 and 5 once the user
   decides.
5. **Welcome emails in Spanish (not done).** The emails a Spanish buyer gets
   after paying (the `stripe-webhook` and `online-welcome` flow) are still in
   English. Ask whether they should be translated.
6. **Optional:** translate the buy box into French and Italian for TGC by
   adding `WORDS.fr` and `WORDS.it` in `online-buy.js`, and their Stripe text in
   `stripeWords()`.
7. **Older items still open:**
   - remind the user about Stripe Adaptive Pricing (currently turned off on
     purpose in `online-checkout.mjs`);
   - clean up old test data.
8. **Other languages.** French, German, Italian and Brazilian Portuguese
   versions of TCC are "being rebuilt". To sell one:
   - upload the course in the portal;
   - set its `learn_courses` `lw_course_id` and `on_site = true`;
   - insert an `online_products` row;
   - update the TCC sales page text.
