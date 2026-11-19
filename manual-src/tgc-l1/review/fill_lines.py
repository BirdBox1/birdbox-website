# Work out how many extra write-in lines the last movement on each page needs to reach the bottom.
# usage: fill_lines.py <pdf> <page text.txt> <rendered page dir at scale 1.0> -> writes review/extra-lines.json (adds to existing)
import sys, json, re, os, glob
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exercises import EX
pdf, txt, imgdir = sys.argv[1:4]
pages = {int(m.group(1)): m.group(2).lower() for m in re.finditer(r"=== PAGE (\d+) ===\n(.*?)(?==== PAGE|\Z)", open(txt).read(), re.S)}
norm = lambda t: re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()
P = {k: norm(v) for k, v in pages.items()}
start = min(k for k, v in P.items() if "showcase key positions" in v)
cur, where = start, {}
for i, (kind, title, src, b) in enumerate(EX, 1):
    t = norm(title.split(" - ")[0].split(" – ")[0])
    while cur in P and t not in P[cur]: cur += 1
    where[i] = cur
last = {}
for i, pg in where.items(): last[pg] = i
X = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extra-lines.json")
extra = {int(k): v for k, v in json.load(open(X)).items()} if os.path.exists(X) else {}
LINE = 7.8 / 25.4 * 72
for pg, i in sorted(last.items()):
    im = Image.open(f"{imgdir}/p{pg:02d}.png").convert("L"); W, H = im.size; s = W / 595.28
    limit = int((841.89 - 22 / 25.4 * 72) * s)
    y = limit - 1
    px = im.load()
    while y > 0 and all(px[x, y] > 235 for x in range(0, W, 2)): y -= 1
    free = (limit - y) / s
    n = int((free - 14) // LINE)
    if n > 0: extra[i] = extra.get(i, 0) + n
    print(f"page {pg}: last movement {i} {EX[i-1][1][:30]!r}, free {free/72*25.4:.0f} mm -> +{max(n,0)} lines")
json.dump(extra, open(X, "w"))
