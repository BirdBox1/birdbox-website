import re,sys,zlib
from PIL import Image
src=open(sys.argv[2]).read().split('# pages in order')[0]
exec(src)
out=sys.argv[3]
for n in map(int,sys.argv[4:]):
    v=objs[n]; hd=v.split(b'stream')[0]
    w=int(re.search(rb'/Width (\d+)',hd).group(1));h=int(re.search(rb'/Height (\d+)',hd).group(1))
    bpc=int(re.search(rb'/BitsPerComponent (\d+)',hd).group(1))
    cs=re.search(rb'/ColorSpace\s*(/\w+|\d+ 0 R|\[[^\]]*\])',hd).group(1)
    if cs.endswith(b'R'): cs=objs[int(cs.split()[0])][:200]
    data=stream(v)
    mode='RGB' if b'RGB' in cs or b'ICC' in cs and len(data)>=w*h*3 else ('CMYK' if b'CMYK' in cs or len(data)>=w*h*4 else 'L')
    if b'ICCBased' in cs: 
        ncomp=len(data)//(w*h); mode={1:'L',3:'RGB',4:'CMYK'}[ncomp]
    im=Image.frombytes(mode,(w,h),data[:w*h*len(mode)])
    sm=re.search(rb'/SMask (\d+) 0 R',hd)
    im=im.convert('RGB')
    if sm:
        sv=objs[int(sm.group(1))]; sh=sv.split(b'stream')[0]
        sw=int(re.search(rb'/Width (\d+)',sh).group(1));shh=int(re.search(rb'/Height (\d+)',sh).group(1))
        a=Image.frombytes('L',(sw,shh),stream(sv)[:sw*shh]).resize((w,h)); im.putalpha(a)
        im.save(f'{out}/f{n}.png')
    else: im.save(f'{out}/f{n}.png')
    print(n,w,h,mode,cs[:40],bool(sm))
