import sys
from PIL import Image
sys.setrecursionlimit(10**6)
def boxes(path,top=0.09,s=4,minpx=150):
    im=Image.open(path).convert('L'); W,H=im.size
    sm=im.resize((W//s,H//s)); w,h=sm.size; px=sm.load()
    y0=int(h*top)
    m=[[px[x,y]<235 for x in range(w)] for y in range(h)]
    seen=[[False]*w for _ in range(h)]; out=[]
    for y in range(y0,h):
        for x in range(w):
            if m[y][x] and not seen[y][x]:
                st=[(x,y)];seen[y][x]=True;x1=x2=x;y1=y2=y;n=0
                while st:
                    cx,cy=st.pop();n+=1
                    x1=min(x1,cx);x2=max(x2,cx);y1=min(y1,cy);y2=max(y2,cy)
                    for nx,ny in ((cx+1,cy),(cx-1,cy),(cx,cy+1),(cx,cy-1)):
                        if y0<=ny<h and 0<=nx<w and m[ny][nx] and not seen[ny][nx]:
                            seen[ny][nx]=True;st.append((nx,ny))
                bw,bh=(x2-x1+1)*s,(y2-y1+1)*s
                if bw>minpx and bh>minpx and n>0.6*(x2-x1+1)*(y2-y1+1): out.append((x1*s,y1*s,x2*s+s,y2*s+s))
    return sorted(out,key=lambda b:(b[1]//60,b[0]))
if __name__=='__main__':
    for p in sys.argv[1:]: print(p,boxes(p))
