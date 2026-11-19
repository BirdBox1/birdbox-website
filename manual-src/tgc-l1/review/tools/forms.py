import re,sys,zlib
exec(open(sys.argv[2]).read().split('# pages in order')[0].replace("open(sys.argv[1],'rb')","open(sys.argv[1],'rb')"))
def walkform(n,depth=0,M=(1,0,0,1,0,0)):
    v=objs[n]; hd=v.split(b'stream')[0]
    sub=re.search(rb'/Subtype\s*/(\w+)',hd)
    if sub and sub.group(1)==b'Image':
        w=re.search(rb'/Width (\d+)',hd).group(1).decode();h=re.search(rb'/Height (\d+)',hd).group(1).decode()
        f=re.findall(rb'/Filter\s*/?\[?\s*/(\w+)',hd); print('  '*depth+f'IMG {n} {w}x{h} {f}'); return
    r=dictbody(hd,b'Resources'); xo=dictbody(r,b'XObject') if r else None
    names=dict((a.decode(),int(b)) for a,b in re.findall(rb'/(\w+)\s+(\d+) 0 R',xo or b''))
    c=stream(v)
    bb=re.search(rb'/BBox\s*\[(.*?)\]',hd)
    print('  '*depth+f'FORM {n} bbox {bb.group(1).decode() if bb else ""} ops={len(c)} text={c.count(b"Tj")+c.count(b"TJ")}')
    for m in re.finditer(rb'([-\d\.]+) ([-\d\.]+) ([-\d\.]+) ([-\d\.]+) ([-\d\.]+) ([-\d\.]+) cm\s*/(\w+) Do',c):
        nm=m.group(7).decode()
        if nm in names: print('  '*(depth+1)+'at',[round(float(x)) for x in m.groups()[:6]]); walkform(names[nm],depth+1)
for n in map(int,sys.argv[3:]): walkform(n)
