# German edition: give the last movement on each page extra write-in lines down to the bottom,
# then back off one line wherever a movement got pushed to a later page.
import json, os, re, subprocess, sys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); T = os.path.dirname(HERE)
D = sys.argv[1]; X = os.path.join(HERE, "extra-lines-de.json")
sys.path.insert(0, HERE); from exercises_de import EX_DE as EX_PT
norm = lambda t: re.sub(r"[^a-z0-9à-ÿß]+", " ", t.lower()).strip()
def build(scale="0.3"):
    subprocess.run(["python3", f"{HERE}/build_html_de.py", f"{T}/manual-de.html"], check=True, capture_output=True)
    subprocess.run([f"{HERE}/pdf.sh", "manual-de.html", "out/tgc-l1-manual-de.pdf", "web"], check=True)
    subprocess.run(["rm", "-rf", f"{D}/fitde"]); subprocess.run([f"{D}/tools/pdfx", f"{T}/out/tgc-l1-manual-de.pdf", f"{D}/fitde", scale], capture_output=True)
    t = open(f"{D}/fitde/text.txt").read()
    P = {int(m.group(1)): norm(m.group(2)) for m in re.finditer(r"=== PAGE (\d+) ===\n(.*?)(?==== PAGE|\Z)", t, re.S)}
    cur = min(k for k, v in P.items() if "nutze die notizfelder" in v)
    where = {}
    for i, (title, _) in enumerate(EX_PT, 1):
        tt = norm(title)[:25]
        while cur in P and tt not in P[cur]: cur += 1
        where[i] = cur
    return where, len(P)
json.dump({}, open(X, "w")); base, nbase = build("1.0")
last = {}
for i, pg in base.items(): last[pg] = i
extra = {}; LINE = 7.8 / 25.4 * 72
for pg, i in sorted(last.items()):
    im = Image.open(f"{D}/fitde/p{pg:02d}.png").convert("L"); W, H = im.size; s = W / 595.28
    limit = int((841.89 - 22 / 25.4 * 72) * s); y = limit - 1; px = im.load()
    while y > 0 and all(px[x, y] > 235 for x in range(0, W, 2)): y -= 1
    n = int(((limit - y) / s - 14) // LINE)
    if n > 0: extra[str(i)] = n
json.dump(extra, open(X, "w")); print("first guess", extra)
for it in range(15):
    w, n = build()
    bad = [i for i in w if w[i] != base[i]]
    print("round", it, "pages", n, "moved", bad[:5])
    if not bad: break
    j = bad[0] - 1
    while j > 0 and extra.get(str(j), 0) == 0: j -= 1
    if j == 0: break
    extra[str(j)] -= 1; json.dump(extra, open(X, "w"))
print(json.dumps(extra))
