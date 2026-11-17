#!/usr/bin/env python3
"""Turn the SimpleCert exports into one row per past certificate.

Reads  data-private/simplecert/{tgc,birdbox}/all.json  (exported 17 Nov 2026)
Writes data-private/simplecert/import.json  and prints a summary.

Rules (Nathan, 17 Nov 2026):
- TGC account: "THE GYMNASTICS COURSE" = TGC Level 1, "Level 2" = TGC Level 2,
  "ADVANCE COURSE CERT" = TGC Advanced (the old course before Level 2).
- BirdBox account: every certificate is BirdBox Coaching Development, now TCC.
  "Birdbox Seminar" = TCC Level 1 live seminar, "BirdBox Online" = TCC Level 1
  online course.
- One certificate per person per course and date. Batches that were never sent
  (UNSENT) were corrected and re-sent, so they only count when the person has
  no other certificate for that course.
- The date is the one printed on the certificate (a re-issue of an old
  certificate keeps its old date). When it cannot be read, or is clearly a
  typo (more than 60 days after the batch was made), the batch date is used.

Run with -I from the repo root:  python3 -I scripts/simplecert-import/build.py <data dir>
"""
import json, os, re, sys
from datetime import date, datetime, timedelta
from collections import Counter, defaultdict

DATA = sys.argv[1] if len(sys.argv) > 1 else "data-private/simplecert"

MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"])}
# typos seen in the merge fields
MONTHS.update({"novemeber": 11, "feburary": 2, "febuary": 2, "sept": 9, "septmber": 9,
               "agust": 8, "augsut": 8, "decmeber": 12, "octobre": 10, "janurary": 1,
               "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8,
               "sep": 9, "oct": 10, "nov": 11, "dec": 12})


def month_of(word):
    if word in MONTHS: return MONTHS[word]
    # misspellings ('Novemebr', 'Decmebr', 'Septemeber'): first three letters
    if len(word) >= 4 and word.isalpha():
        return next((i for m, i in MONTHS.items() if len(m) > 3 and m[:3] == word[:3]), None)
    return None


def parse_date(text, batch_day):
    """'6th October 2019', 'November 5th 2023', '22 February, 2026',
    '30th of June 2024', 'July 12, 2025', '22ed May 2022', '8th December',
    '07-08-2019' (day first) ... -> date or None."""
    t = (text or "").lower().strip()
    m = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", t)
    if m:
        try: return date(int(m[3]), int(m[2]), int(m[1]))
        except ValueError: return None
    t = re.sub(r"(\d)[a-z]{1,2}\b", r"\1", t)   # 6th, 22ed, 15h
    t = re.sub(r"[,.]", " ", t).replace(" of ", " ")
    words = t.split()
    month = next((month_of(w) for w in words if month_of(w)), None)
    nums = [int(w) for w in words if w.isdigit()]
    year = next((n for n in nums if 2015 <= n <= 2030), None)
    day = next((n for n in nums if 1 <= n <= 31 and n != year), None)
    if month and year and not day:
        day = 1   # 'September 2021': the month is what is shown
    if month and day and not year:
        # '8th December' with no year: the year the batch was made
        year = batch_day.year if month <= batch_day.month else batch_day.year - 1
    if not (month and year and day):
        return None
    try:
        return date(year, month, day)
    except ValueError:
        return None


def course_for(account, cert_name):
    n = (cert_name or "").lower()
    if account == "tgc":
        if "advance" in n: return ("tgc", "advanced", "seminar")
        if "level 2" in n: return ("tgc", "2", "seminar")
        return ("tgc", "1", "seminar")
    if "online" in n: return ("tcc", "1", "online")
    return ("tcc", "1", "seminar")


def clean_name(s):
    return re.sub(r"\s+", " ", (s or "")).strip()


rows, skipped = [], Counter()
for account in ("tgc", "birdbox"):
    d = json.load(open(os.path.join(DATA, account, "all.json")))
    for r in d["rows"]:
        meta = r.get("meta") or {}
        printed = meta.get("MERGE_FIELD1") or meta.get("MERGE_FIELD") or ""
        batch_day = datetime.fromisoformat(r["project_created"].replace("Z", "+00:00")).date()
        when = parse_date(printed, batch_day)
        date_source = "printed"
        if not when or when > batch_day + timedelta(days=60) or when < date(2015, 1, 1):
            when, date_source = batch_day, "batch"
        brand, level, kind = course_for(account, r["certificate_name"])
        email = (r.get("email") or "").strip().lower()
        if not email or "@" not in email:
            skipped["no email"] += 1
            continue
        pdf = os.path.join(DATA, account, "pdfs", f"{r['recipient_id']}.pdf")
        has_pdf = os.path.exists(pdf)
        first, last = clean_name(r.get("first_name")), clean_name(r.get("last_name"))
        # "Hannah Owen" / "Owen": the surname typed twice
        if last and first.lower().endswith(" " + last.lower()): first = first[: -len(last) - 1].strip()
        rows.append({
            "source": f"simplecert-{account}",
            "source_id": r["recipient_id"],
            "email": email,
            "participant_name": clean_name(f"{first} {last}"),
            "brand": brand, "level": level, "kind": kind,
            "awarded_on": when.isoformat(),
            "printed_date": printed.strip() or None,
            "date_source": date_source,
            "batch_title": clean_name(r["project_title"]).strip('"'),
            "sent_status": r.get("sent_status"),
            "pdf_path": f"{account}/{r['recipient_id']}.pdf" if has_pdf else None,
        })

# One per person, course and date; UNSENT only when nothing else exists.
by = defaultdict(list)
for x in rows:
    by[(x["email"], x["brand"], x["level"], x["kind"])].append(x)

keep = []
for key, xs in by.items():
    sent = [x for x in xs if x["sent_status"] != "UNSENT"]
    pool = sent or xs
    if len(pool) < len(xs): skipped["unsent duplicate"] += len(xs) - len(pool)
    seen = {}
    for x in sorted(pool, key=lambda x: (x["pdf_path"] is None, -x["source_id"])):
        k = x["awarded_on"]
        # the same course re-sent within a fortnight is the same certificate
        dup = next((d for d in seen if abs((date.fromisoformat(d) - date.fromisoformat(k)).days) <= 14), None)
        if dup:
            skipped["re-sent copy"] += 1
            continue
        seen[k] = x
        keep.append(x)

keep.sort(key=lambda x: (x["source"], x["source_id"]))
json.dump(keep, open(os.path.join(DATA, "import.json"), "w"), ensure_ascii=False, indent=0)

print("source rows", len(rows), "kept", len(keep), dict(skipped))
print("people", len({x["email"] for x in keep}))
print(Counter((x["brand"], x["level"], x["kind"]) for x in keep))
print("dates", Counter(x["date_source"] for x in keep))
print("no pdf", sum(1 for x in keep if not x["pdf_path"]))
print("repeat courses (same person, same course, different dates):",
      sum(1 for k, xs in by.items() if len({x['awarded_on'] for x in keep if (x['email'], x['brand'], x['level'], x['kind']) == k}) > 1))
