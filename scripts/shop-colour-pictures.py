"""Work out, for every shop product, which gallery picture shows each colour.

Reads Ecwid's public storefront data and Printful's public catalogue colours,
looks at each picture's pixels, and writes map.json:
  { productId: { colourName: originalImageFileId, ... }, ... }
plus a contact sheet per product for checking by eye.

Usage: put the shop's product IDs in ids.json next to this script (a JSON
list), run it with Pillow + NumPy available, check the sheets/ pictures, then
rebuild shop/colour-pictures.js from map.json. Don't commit map.json, ids.json
or sheets/.
"""
import json, os, sys, io, urllib.request
import numpy as np
from PIL import Image, ImageDraw

OUT = os.path.dirname(os.path.abspath(__file__))
IDS = json.load(open(os.path.join(OUT, 'ids.json')))
API = 'https://eu-fra4-storefront-api.ecwid.com/storefront/api/v1/140532633/catalog/product'

def post(pid):
    body = json.dumps({"productIdentifier": {"type": "PUBLISHED", "productId": pid},
                       "urlParams": {"urlType": "HASH_BASED", "baseUrl": "", "canonicalBaseUrl": "",
                                     "isCleanUrls": False, "isCanonicalUrlsEnabled": False}}).encode()
    req = urllib.request.Request(API, data=body, headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=30))

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    return urllib.request.urlopen(req, timeout=30).read()

# colour name -> (hex1, hex2) from Printful's catalogue
COL = {}
for cat in (71, 162, 380, 411, 252):
    r = json.loads(get(f'https://api.printful.com/products/{cat}'))['result']
    for v in r['variants']:
        names = {v['color'], v['color'].replace(' Triblend', '')}
        for n in names:
            COL.setdefault(n.strip(), (v.get('color_code'), v.get('color_code2')))

def hx(h):
    h = h.lstrip('#'); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], float)

def feats(img):
    a = np.asarray(img.convert('RGB').resize((80, 80)), float)
    bgc = np.median(np.concatenate([a[:4].reshape(-1,3), a[-4:].reshape(-1,3)]), 0)
    px = a.reshape(-1, 3)
    garment = np.linalg.norm(px - bgc, axis=1) > 18
    if garment.mean() < 0.05:   # white garment on white background
        garment = np.linalg.norm(px - bgc, axis=1) > 6
    g = px[garment] if garment.any() else px
    med = np.median(g, 0)
    logo = garment & (np.linalg.norm(px - med, axis=1) > 70)
    light = garment & (px.min(1) > 175)          # white/light mesh or panel
    return dict(med=med, logo=logo.reshape(80, 80), light=light.mean(), gshare=garment.mean())

def lab(c):
    c = c / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    X = c @ np.array([0.4124, 0.3576, 0.1805]); Y = c @ np.array([0.2126, 0.7152, 0.0722]); Z = c @ np.array([0.0193, 0.1192, 0.9505])
    f = lambda t: np.where(t > 0.008856, np.cbrt(t), 7.787 * t + 16 / 116)
    fx, fy, fz = f(X / 0.9505), f(Y), f(Z / 1.089)
    return np.array([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)])

def cdist(f, c1, c2):
    d = np.linalg.norm(lab(f['med']) - lab(hx(c1)))
    if c2:  # two-tone: expect a share of light pixels if the second colour is light
        light2 = hx(c2).min() > 175
        d += 25 * (0 if (f['light'] > 0.08) == light2 else 1)
    return d

def iou(a, b):
    u = (a | b).sum()
    return (a & b).sum() / u if u else 0

result, report = {}, []
for pid in IDS:
    try:
        j = post(pid)
    except Exception as e:
        report.append(f'{pid}: fetch failed {e}'); continue
    name = j.get('name')
    try:
        choices = [c['choiceName'] for c in j['defaultOptionsOverrides']['pricesOverrides']['optionsChoicesWithModifiersAndTaxes'][0]['choices']]
    except Exception:
        report.append(f'{pid} {name}: no colour option'); continue
    media = j['defaultOptionsOverrides']['variationOverrides']['mediaItems']
    imgs = []
    for m in media:
        try:
            im = Image.open(io.BytesIO(get(m['image160pxUrl'])))
            imgs.append((m, feats(im), im.convert('RGB')))
        except Exception:
            pass
    known = [c for c in choices if c in COL and COL[c][0]]
    if len(known) < 2:
        report.append(f'{pid} {name}: <2 known colours {choices}'); continue
    main = imgs[0][1]
    view = np.array([iou(f['logo'], main['logo']) for _, f, _ in imgs])
    D = np.array([[cdist(f, *COL[c]) for c in known] for _, f, _ in imgs])
    # prefer pictures in the same view as the main picture
    D = D + 30 * (view < 0.45 * view.max())[:, None]
    chosen, used = {}, set()
    pairs = sorted((D[i, ci] + 1e-3 * i, i, ci) for i in range(len(imgs)) for ci in range(len(known)))
    for d, i, ci in pairs:
        if ci in chosen or i in used: continue
        chosen[ci] = i; used.add(i)
    S = -D
    mp, sheet = {}, []
    for ci, c in enumerate(known):
        i = chosen.get(ci)
        if i is not None and D[i, ci] < 60:
            fid = imgs[i][0]['image800pxUrl'].rsplit('/', 1)[1].split('.')[0]
            mp[c] = fid; sheet.append((c, imgs[i][2]))
        else:
            sheet.append((c, None))
    result[str(pid)] = mp
    report.append(f'{pid} {name}: {len(mp)}/{len(choices)} colours matched')
    # contact sheet
    W = 120; cs = Image.new('RGB', (W * len(sheet), W + 22), 'white'); d = ImageDraw.Draw(cs)
    for k, (c, im) in enumerate(sheet):
        if im: cs.paste(im.resize((W, W)), (k * W, 22))
        d.text((k * W + 2, 4), c[:18], fill='black')
    os.makedirs(os.path.join(OUT, 'sheets'), exist_ok=True)
    cs.save(os.path.join(OUT, 'sheets', f'{pid}.png'))

json.dump(result, open(os.path.join(OUT, 'map.json'), 'w'), indent=0)
print('\n'.join(report))
