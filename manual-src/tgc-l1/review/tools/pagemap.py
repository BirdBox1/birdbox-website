import re,sys,zlib,json
d=open(sys.argv[1],'rb').read()
objs={int(m.group(1)):m.group(2) for m in re.finditer(rb'(\d+) 0 obj(.*?)endobj',d,re.S)}
def stream(v):
    s=v.find(b'stream')+6
    if v[s:s+2]==b'\r\n': s+=2
    elif v[s:s+1]==b'\n': s+=1
    data=v[s:v.rfind(b'endstream')]
    if b'FlateDecode' in v.split(b'stream')[0]:
        try: data=zlib.decompress(data)
        except Exception: data=zlib.decompressobj().decompress(data)
    return data
def ref(v,key):
    m=re.search(rb'/'+key+rb'\s*(\d+) 0 R',v); return int(m.group(1)) if m else None
def dictbody(v,key):
    i=v.find(b'/'+key)
    if i<0: return None
    rest=v[i+len(key)+1:].lstrip()
    m=re.match(rb'(\d+) 0 R',rest)
    if m: return objs[int(m.group(1))]
    depth=0;j=0
    while j<len(rest):
        if rest[j:j+2]==b'<<': depth+=1;j+=2;continue
        if rest[j:j+2]==b'>>':
            depth-=1;j+=2
            if depth==0: return rest[:j]
            continue
        j+=1
    return rest
# pages in order
cat=[v for v in objs.values() if re.search(rb'/Type\s*/Catalog',v)][0]
root=ref(cat,b'Pages')
order=[]
def walk(n):
    v=objs[n]
    if re.search(rb'/Type\s*/Pages',v):
        kids=re.search(rb'/Kids\s*\[(.*?)\]',v,re.S).group(1)
        for k in re.findall(rb'(\d+) 0 R',kids): walk(int(k))
    else: order.append(n)
walk(root)
res={}
for pi,pn in enumerate(order,1):
    v=objs[pn]
    r=dictbody(v,b'Resources'); xo=dictbody(r,b'XObject') if r else None
    names=dict((a.decode(),int(b)) for a,b in re.findall(rb'/(\w+)\s+(\d+) 0 R',xo or b''))
    cs=re.search(rb'/Contents\s*(\d+) 0 R',v)
    content=stream(objs[int(cs.group(1))]) if cs else b''
    items=[]
    # track simple cm before Do
    for m in re.finditer(rb'([-\d\.]+) ([-\d\.]+) ([-\d\.]+) ([-\d\.]+) ([-\d\.]+) ([-\d\.]+) cm\s*/(\w+) Do',content):
        nm=m.group(7).decode(); 
        if nm in names: items.append([names[nm]]+[float(x) for x in m.groups()[:6]])
    res[pi]={'xobjs':names,'draw':items}
json.dump(res,open(sys.argv[2],'w'),indent=0)
for p in res: print(p, len(res[p]['xobjs']), [i[0] for i in res[p]['draw']])
