# Loop: build the preview, check every movement stays on its baseline page; where one got pushed,
# take a line off the movement before it. Stops when the layout matches the baseline.
import json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); T = os.path.dirname(HERE)
D = sys.argv[1]; X = os.path.join(HERE, "extra-lines.json")
sys.path.insert(0, HERE); from exercises import EX
def build():
    subprocess.run(["python3", f"{HERE}/build_html.py", f"{T}/manual.html"], check=True, capture_output=True)
    subprocess.run(["python3", f"{HERE}/apply.py", f"{T}/manual.html", f"{T}/_preview-proposed.html", "preview"], check=True, capture_output=True)
    subprocess.run([f"{HERE}/pdf.sh", "_preview-proposed.html", "out/_preview-proposed.pdf"], check=True)
    subprocess.run(["rm", "-rf", f"{D}/fitchk"]); subprocess.run([f"{D}/tools/pdfx", f"{T}/out/_preview-proposed.pdf", f"{D}/fitchk", "0.3"], capture_output=True)
    t = open(f"{D}/fitchk/text.txt").read()
    P = {int(m.group(1)): re.sub(r"[^a-z0-9]+", " ", m.group(2).lower()) for m in re.finditer(r"=== PAGE (\d+) ===\n(.*?)(?==== PAGE|\Z)", t, re.S)}
    cur = min(k for k, v in P.items() if "showcase key positions" in v); where = {}
    for i, (_, title, _, _) in enumerate(EX, 1):
        tt = re.sub(r"[^a-z0-9]+", " ", title.split(" - ")[0].split(" – ")[0].lower()).strip()
        while cur in P and tt not in P[cur]: cur += 1
        where[i] = cur
    return where, len(P)
extra = json.load(open(X)) if os.path.exists(X) else {}
json.dump({}, open(X, "w")); base, nbase = build()
json.dump(extra, open(X, "w"))
for it in range(12):
    w, n = build()
    bad = [i for i in w if w[i] != base[i]]
    print("round", it, "pages", n, "moved", bad[:5])
    if not bad: break
    i = bad[0]; j = i - 1
    while j > 0 and extra.get(str(j), 0) == 0: j -= 1
    if j == 0: break
    extra[str(j)] -= 1; json.dump(extra, open(X, "w"))
print(json.dumps(extra))
