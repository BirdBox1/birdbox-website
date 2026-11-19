# Build the data for the review page: highlight boxes on old and new pages, and new->old page map.
# usage: review_data.py <old.pdf> <old_text.txt> <new.pdf> <new_text.txt> <ocr_extra.json> <out.json>
import sys, json, re, subprocess
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from changes import C, PAGES
old_pdf, old_txt, new_pdf, new_txt, ocr_json, out = sys.argv[1:7]
LOC = "/private/tmp/claude-501/-Users-nathanbird-Developer-birdbox-website/9081dd31-8db8-42b9-8279-34580ad539ce/scratchpad/tools/locate"

def frags(s):
    s = re.sub(r"\((twice|.*?places?.*?|twice, .*?)\)", "", s)
    s = re.sub(r"^(Cover|Cover photo|Heading)\s*:?\s*", "", s)
    parts = [p.strip(" '‘’\"“”.") for p in re.split(r" … | / ", s)]
    return [p for p in parts if len(p) > 3]

oq, nq = [], []
for c in C:
    show = c["show"] if c["show"] is not None else c["now"]
    seek = c["seek"] if c["seek"] is not None else c["proposed"]
    oq.append({"id": c["id"], "q": frags(show) if show else []})
    nq.append({"id": c["id"], "q": frags(seek) if seek else []})
json.dump(oq, open("/tmp/oq.json", "w")); json.dump(nq, open("/tmp/nq.json", "w"))
ob = json.loads(subprocess.check_output([LOC, old_pdf, "/tmp/oq.json"]))
nb = json.loads(subprocess.check_output([LOC, new_pdf, "/tmp/nq.json"]))

def pages(t):
    d = {}
    for m in re.finditer(r"=== PAGE (\d+) ===\n(.*?)(?==== PAGE|\Z)", open(t).read(), re.S):
        d[int(m.group(1))] = m.group(2)
    return d
OT, NT = pages(old_txt), pages(new_txt)
for k, v in json.load(open(ocr_json)).items():
    OT[int(k)] = OT.get(int(k), "") + "\n" + v
def sh(t):
    w = re.findall(r"[a-z0-9]+", t.lower())
    return {" ".join(w[i:i+3]) for i in range(len(w) - 2)}
OS = {p: sh(t) for p, t in OT.items()}
PMAP = {}
for p, t in NT.items():
    s = sh(t)
    sc = {o: len(s & os_) for o, os_ in OS.items()}
    best = max(sc.values()) if sc else 0
    PMAP[p] = sorted(o for o, v in sc.items() if best >= 4 and v >= max(4, 0.5 * best))
PMAP[1] = [1]; PMAP[2] = []; PMAP[3] = []

CH = []
for c in C:
    o = ob.get(c["id"], []); n = nb.get(c["id"], [])
    op = int(o[0][0]) if o else None
    np_ = int(n[0][0]) if n else None
    fn, fo = PAGES.get(c["id"], (None, None))
    np_ = fn or np_; op = fo or op
    CH.append(dict(id=c["id"], type=c["type"], now=c["now"], proposed=c["proposed"], note=c["note"],
                   np=np_, op=op, nh=[r[1:] for r in n if np_ and int(r[0]) == np_],
                   oh=[r[1:] for r in o if op and int(r[0]) == op]))
json.dump({"CH": CH, "PMAP": PMAP, "NPAGES": len(NT)}, open(out, "w"))
for c in CH:
    if not c["np"] or not c["op"]:
        print("check", c["id"], "np", c["np"], "op", c["op"], c["now"][:50])
print("PMAP", PMAP)
