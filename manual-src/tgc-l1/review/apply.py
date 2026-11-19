# Apply approved changes to the original-wording manual.
# usage: apply.py <in.html> <out.html> <decisions.json | "preview">
# decisions.json: {"g011": {"status": "approved"}, "g015": {"status": "changed", "text": "..."}, ...}
import sys, json, re
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from changes import C
from diagrams import pyramid, mda

src, out, dec = sys.argv[1], sys.argv[2], sys.argv[3]
h = open(src).read()
if dec == "preview":
    decisions = {c["id"]: {"status": "approved"} for c in C if c["proposed"]}
else:
    decisions = json.load(open(dec))

ORDER = ["g016", "g039"]  # must run before g013 (PDF -> manual) and g037 (colons)
todo = sorted(C, key=lambda c: (0 if c["id"] in ORDER else 1))
log = []
for c in todo:
    d = decisions.get(c["id"])
    if not d or d["status"] not in ("approved", "changed"):
        continue
    cid = c["id"]
    repl = d["text"] if d["status"] == "changed" and c["find"] else c["repl"]
    if cid == "g038":
        for a, b in [("Tuck Hollow", "Tuck hollow"), ("One Leg Straight Hollow", "One leg straight hollow"),
                     ("Full Hollow", "Full hollow"), ("Supported Arch", "Supported arch"), ("Full Arch", "Full arch")]:
            h = h.replace(f"<h3>{a}", f"<h3>{b}")
        log.append(cid); continue
    if cid == "g039":
        h = h.replace("<h3>Low ring pass-out:</h3>", "<h3>Low ring pass-out – arm out wide:</h3>", 1)
        h = h.replace("<h3>Low ring pass-out:</h3>", "<h3>Low ring pass-out – arm out front:</h3>", 1)
        log.append(cid); continue
    if cid == "g044":
        h = h.replace("frontload", "front-load").replace("front loading", "front-loading"); log.append(cid); continue
    if cid == "g050" and d["status"] == "changed":
        h = h.replace('alt="The TGC coaching team, 2026"></figure>', f'alt="The TGC coaching team, 2026"><figcaption>{d["text"]}</figcaption></figure>', 1)
        log.append(cid + " caption"); continue
    if not c["find"]:
        log.append(cid + " (nothing to replace)"); continue
    repl = repl.replace("@@PYRAMID@@", pyramid()).replace("@@MDA@@", mda())
    if c["all"] == "re":
        h, n = re.subn(c["find"], repl, h)
    elif c["all"]:
        n = h.count(c["find"]); h = h.replace(c["find"], repl)
    else:
        n = h.count(c["find"])
        if n != 1:
            print("!! ", cid, "found", n, "times:", c["find"][:60]);
        h = h.replace(c["find"], repl, 1)
    if n == 0:
        print("!! ", cid, "not found")
    log.append(f"{cid} x{n}")
open(out, "w").write(h)
print("applied:", ", ".join(log))
