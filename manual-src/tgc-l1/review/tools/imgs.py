import re,sys,zlib,os
d=open(sys.argv[1],'rb').read(); out=sys.argv[2]; os.makedirs(out,exist_ok=True)
objs={}
for m in re.finditer(rb'(\d+) 0 obj(.*?)endobj',d,re.S):
    objs[int(m.group(1))]=m.group(2)
n=0;stats={}
for k,v in objs.items():
    if b'/Subtype/Image' not in v.replace(b' ',b'') : continue
    hd=v.split(b'stream')[0]
    filt=re.findall(rb'/Filter\s*/?\[?\s*/(\w+)',hd)
    w=re.search(rb'/Width (\d+)',hd); h=re.search(rb'/Height (\d+)',hd)
    key=(filt[0] if filt else b'none').decode()
    stats[key]=stats.get(key,0)+1
    s=v.find(b'stream')+6
    if v[s:s+2]==b'\r\n': s+=2
    elif v[s:s+1]==b'\n': s+=1
    e=v.rfind(b'endstream'); data=v[s:e]
    if key=='DCTDecode':
        open(f'{out}/x{k:05d}_{w.group(1).decode()}x{h.group(1).decode()}.jpg','wb').write(data); n+=1
print(n,stats)
