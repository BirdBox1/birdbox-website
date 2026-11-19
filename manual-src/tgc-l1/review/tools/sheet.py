import sys,glob
from PIL import Image
src,out,a,b=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4])
fs=sorted(glob.glob(src+'/p*.png'))[a-1:b]
w=250;ims=[Image.open(f).convert('RGB') for f in fs];ims=[i.resize((w,int(i.height*w/i.width))) for i in ims];h=max(i.height for i in ims)
cols=5;rows=(len(ims)+cols-1)//cols
s=Image.new('RGB',(cols*(w+6),rows*(h+6)),'#777')
for i,im in enumerate(ims): s.paste(im,((i%cols)*(w+6),(i//cols)*(h+6)))
s.save(out)
