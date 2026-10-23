# share-source/render.py
#
# Makes the 1200 x 630 link-preview pictures in /share/ (what WhatsApp,
# iMessage, Facebook and the rest show when a page is shared).
#
#   1. Edit cards.json: one entry per picture (page, course, photo, words).
#   2. Serve the site folder on port 8767 (python3 -m http.server 8767).
#   3. python3 share-source/render.py            all of them
#      python3 share-source/render.py tgc tcc    just these
#
# Needs Google Chrome and Pillow. A page's <meta property="og:image">
# points at its picture; the seminar, blog and coach pages get theirs
# from netlify/edge-functions/share-meta.js.
import json, os, subprocess, sys, urllib.parse
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT = os.path.join(ROOT, "share")
os.makedirs(OUT, exist_ok=True)

cards = json.load(open(os.path.join(HERE, "cards.json")))
only = set(sys.argv[1:])
for c in cards:
    if only and c["file"] not in only:
        continue
    frag = urllib.parse.quote(json.dumps({k: c[k] for k in ("brand", "photo", "kick", "title", "sub")}))
    png = os.path.join(HERE, c["file"] + ".png")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1200,630",
                    "--force-device-scale-factor=1", "--virtual-time-budget=4000",
                    "--screenshot=" + png, "http://localhost:8767/share-source/template.html?" + c["file"] + "#" + frag],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    Image.open(png).convert("RGB").crop((0, 0, 1200, 630)).save(os.path.join(OUT, c["file"] + ".jpg"), quality=86, optimize=True)
    print(c["file"])
