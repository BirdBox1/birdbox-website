// Review studio: one video, one timeline. Tools: Feedback (comments, voice notes, screen recordings with
// selfie camera), Analyse (drawing), Check sheet, Combined (direction + everything). Send opens a review of
// exactly what the mentee will receive, with a tick for each part. The mentee's page is ROUTES.learner.
const TYPE_LABEL = {comment:"Comment", draw:"Drawing", check:"Check sheet", voice:"Voice note", screen:"Screen recording"};
const TYPE_COL = {comment:"var(--c-comment)", draw:"var(--c-draw)", check:"var(--c-check)", voice:"var(--c-voice)", screen:"var(--c-screen)"};
const TYPE_HEX = {comment:"#2f7fd0", draw:"#e0a21a", check:"#1f8a54", voice:"#c2410c", screen:"#9b6cf0"};
const COLOURS = ["#FF3B30","#FFD426","#32D2E0","#FFFFFF"];
let SV = {id:null, mode:"feedback", drawOn:false, tool:"line", colour:COLOURS[0], shapes:[], temp:null,
  filter:{comment:1,draw:1,check:1,voice:1,screen:1}, sec:0, speed:1, selfie:true, rec:null, voice:null, edit:null};
const fmtT = (s) => { s=Math.max(0,s||0); const m=Math.floor(s/60), r=Math.floor(s%60); return `${m}:${String(r).padStart(2,"0")}`; };
const uid = () => Math.random().toString(36).slice(2,9);
function ensure(v){
  v.items=v.items||[]; v.scores=v.scores||{}; v.hv=v.hv||{}; v.secNotes=v.secNotes||{}; v.pins=v.pins||{};
  v.summary=v.summary??""; Object.keys(v.pins).forEach(k=>{if(!Array.isArray(v.pins[k]))v.pins[k]=[v.pins[k]]}); v.actions=v.actions||["","",""]; v.topic=v.topic??""; v.clip=v.clip||null;
  v.include=v.include||{clip:1,comment:1,draw:1,voice:1,screen:1,sheet:1,direction:1,guide:1};
  return v;
}
const firstName = (m) => m.name.split(" ")[0];
const hasSheet = (v) => Object.keys(v.scores).length || Object.values(v.hv).some(Boolean) || Object.keys(v.pins).length;

// ---------- shared drawing ----------
function drawShapes(ctx, W, H, shapes, k=1){
  shapes.forEach(s=>{
    ctx.strokeStyle=s.colour; ctx.fillStyle=s.colour; ctx.lineWidth=3*k; ctx.lineCap="round"; ctx.lineJoin="round";
    const P=s.pts.map(([x,y])=>[x*W,y*H]);
    if(s.tool==="free"){ctx.beginPath();P.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke()}
    if((s.tool==="line"||s.tool==="arrow")&&P.length>1){ctx.beginPath();ctx.moveTo(...P[0]);ctx.lineTo(...P[1]);ctx.stroke();
      if(s.tool==="arrow"){const a=Math.atan2(P[1][1]-P[0][1],P[1][0]-P[0][0]),L=16*k;ctx.beginPath();ctx.moveTo(...P[1]);ctx.lineTo(P[1][0]-L*Math.cos(a-.45),P[1][1]-L*Math.sin(a-.45));ctx.lineTo(P[1][0]-L*Math.cos(a+.45),P[1][1]-L*Math.sin(a+.45));ctx.closePath();ctx.fill()}}
    if(s.tool==="angle"){ctx.beginPath();P.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();P.forEach(p=>{ctx.beginPath();ctx.arc(...p,5*k,0,7);ctx.fill()});
      if(P.length===3){const a1=Math.atan2(P[0][1]-P[1][1],P[0][0]-P[1][0]),a2=Math.atan2(P[2][1]-P[1][1],P[2][0]-P[1][0]);let d=Math.abs(a1-a2)*180/Math.PI;if(d>180)d=360-d;
        ctx.beginPath();ctx.arc(P[1][0],P[1][1],28*k,Math.min(a1,a2),Math.max(a1,a2),Math.abs(a1-a2)>Math.PI);ctx.stroke();
        ctx.font=`700 ${16*k}px ui-sans-serif`;const tx=`${Math.round(d)}°`;const w=ctx.measureText(tx).width;ctx.fillStyle="rgba(0,0,0,.7)";ctx.fillRect(P[1][0]+14*k,P[1][1]-30*k,w+12*k,24*k);ctx.fillStyle=s.colour;ctx.fillText(tx,P[1][0]+20*k,P[1][1]-12*k)}}
  });
}
// draw a video into a box the way object-fit:contain does
function drawContain(ctx, vid, W, H){ const vr=(vid.videoWidth/vid.videoHeight)||16/9; let w=W,h=W/vr; if(h>H){h=H;w=H*vr} try{ctx.drawImage(vid,(W-w)/2,(H-h)/2,w,h)}catch(e){} }
// play a recording with its trim and cuts
function applyEdit(el, ed){ if(!ed) return; el.addEventListener("loadedmetadata",()=>{ if(ed.a) el.currentTime=ed.a; });
  el.addEventListener("timeupdate",()=>{ const t=el.currentTime; if(ed.a&&t<ed.a-.05) el.currentTime=ed.a; const c=(ed.cuts||[]).find(([x,y])=>t>=x&&t<y); if(c) el.currentTime=c[1]; if(ed.b&&t>=ed.b){ el.pause(); el.currentTime=ed.a||0; } }); }
const editedLength = (ed, dur) => ed ? Math.max(0,((ed.b||dur)-(ed.a||0)) - (ed.cuts||[]).reduce((n,[x,y])=>n+(y-x),0)) : dur;

// The local test server can't stream part of a file, so there each video loads whole once. Netlify streams normally.
const BLOBS={};
async function loadVideo(vid,src){ if(!["localhost","127.0.0.1"].includes(location.hostname)){ vid.src=src; return; } if(!BLOBS[src]){ try{ const b=await (await fetch(src)).blob(); BLOBS[src]=URL.createObjectURL(b); }catch(e){ BLOBS[src]=src; } } if(document.body.contains(vid)) vid.src=BLOBS[src]; }

// ================= STUDIO =================
ROUTES.review = (el, id) => {
  const vids = VIDEOS.filter(v => isAdmin() || menteeById(v.mentee).mentor===ME);
  const pending = vids.filter(v=>v.status!=="sent");
  const v = ensure(VIDEOS.find(x=>x.id===id) || pending[0] || vids[0] || {});
  if(!v.id){ el.innerHTML=`<div class="page"><div class="card empty">No videos to review.</div></div>`; return; }
  if(SV.id!==v.id){ SV.id=v.id; SV.shapes=[]; SV.temp=null; SV.sec=0; SV.edit=null; }
  const m = menteeById(v.mentee);
  el.innerHTML = `<div class="page full"><div class="studio">
    <div class="queue"><div class="qh">To review · ${pending.length}</div>
      ${vids.map(x=>{const mm=menteeById(x.mentee);return `<div class="qi ${x.id===v.id?"on":""}" onclick="go('review/${x.id}')"><span class="st" style="color:${x.status==="sent"?"#7fd6a8":x.status==="draft"?"#8cbcf0":"#f0b86a"}">${x.status==="sent"?"Sent":x.status==="draft"?"Draft":"New"}</span><b>${esc(mm.name)}</b><span>${esc(x.title)}</span><span>${x.sent}${isAdmin()&&mm.mentor!==ME?" · "+esc(MENTORS[mm.mentor].short):""}</span></div>`}).join("")}
    </div>
    <div class="stage">
      <div class="stagebar">${av(m,30)}<div style="flex:1;min-width:160px"><h3>${esc(v.title)}</h3><div style="font-size:12px;color:#8b939b">${esc(m.name)} · <span class="tag ${m.brand}">${m.brand.toUpperCase()}</span> · sent ${v.sent}</div></div>
        <select class="qsel" onchange="go('review/'+this.value)">${vids.map(x=>`<option value="${x.id}" ${x.id===v.id?"selected":""}>${x.status==="sent"?"✓":x.status==="draft"?"✎":"●"} ${esc(menteeById(x.mentee).name)}: ${esc(x.title)}</option>`).join("")}</select>
        <button class="cb" id="srec-top" onclick="SV.rec?stopScreen():startScreen()" title="Record the screen and your voice while you play, pause and draw">${SV.rec?"■ Stop recording":"🎥 Screen record"}</button></div>
      <div id="recbar"></div>
      <div class="vbox" id="vbox"><video id="vid" preload="auto" playsinline></video><canvas id="cv"></canvas><span class="flash" id="flash">0:00</span><span class="tool-hint hidden" id="thint"></span><video id="selfie" class="selfie hidden" muted playsinline></video></div>
      <div class="controls">
        <button class="cb" id="c-back" title="Back one frame ( , )">◀︎|</button>
        <button class="cb" id="c-play" title="Play / pause (space)" style="min-width:60px">▶ Play</button>
        <button class="cb" id="c-fwd" title="Forward one frame ( . )">|▶︎</button>
        <span class="time" id="c-time">0:00 / 0:00</span>
        <span style="flex:1"></span>
        ${[.25,.5,1].map(s=>`<button class="cb spd ${SV.speed===s?"on":""}" data-s="${s}">${s===1?"1×":s===.5?"½×":"¼×"}</button>`).join("")}
        <span style="width:6px"></span>
        <button class="cb ${SV.drawOn?"draw-on":""}" id="c-draw" title="Draw on the frame (d)">✎ Draw</button>
        ${COLOURS.map(c=>`<button class="sw ${SV.colour===c?"on":""}" data-c="${c}" style="background:${c}"></button>`).join("")}
        <button class="cb" title="Clear the drawing" onclick="SV.shapes=[];SV.temp=null;_studioDraw()">⌫</button>
        <button class="cb" title="Choose which part of the clip ${esc(firstName(m))} sees" onclick="SV.edit='clip';setMode('feedback')">✂ Trim clip</button>
      </div>
      <div class="tline" id="tline"><div class="track"></div><div class="prog" id="prog"></div><div id="cliparea"></div><div id="marks"></div><div class="head" id="head"></div></div>
      <div class="mfilter">${Object.keys(TYPE_LABEL).map(k=>`<button class="${SV.filter[k]?"":"off"}" data-f="${k}"><i style="background:${TYPE_COL[k]}"></i>${TYPE_LABEL[k]} <span id="fc-${k}"></span></button>`).join("")}</div>
      <div class="vnote"><b>${esc(firstName(m))} asked:</b> “${esc(v.note)}”</div>
      <div class="kb"><span><kbd>space</kbd> play</span><span><kbd>,</kbd> <kbd>.</kbd> frame</span><span><kbd>←</kbd> <kbd>→</kbd> 5 s</span><span><kbd>c</kbd> comment here</span><span><kbd>d</kbd> draw</span><span><kbd>1</kbd>–<kbd>4</kbd> switch tool</span></div>
    </div>
    <div class="panel">
      <div class="modes" style="--nm:${v.guide?5:4}">${[["feedback","Feedback","text · voice · screen"],["analyse","Analyse","draw · angles"],["sheet","Check sheet",SHEETS[v.sheet].short],...(v.guide?[["guide","Lesson guide","their plan"]]:[]),["report","Combined","direction + all"]].map(([k,a,b],i)=>`<button class="${SV.mode===k?"on":""}" data-mode="${k}">${a}<small>${i+1} · ${b}</small></button>`).join("")}</div>
      <div class="pbody" id="pbody"></div>
      <div class="pfoot"><span style="font-size:12px;color:#8b939b;flex:1" id="pcount"></span><button class="cb" id="p-draft">Save draft</button><button class="btn pri" id="p-send">Review &amp; send ›</button></div>
    </div>
  </div></div>`;
  wireStudio(v, m);
};

function wireStudio(v, m){
  const vid=$("vid"), cv=$("cv"), ctx=cv.getContext("2d");
  loadVideo(vid, v.src);
  vid.playbackRate=SV.speed;
  const size=()=>{const r=cv.getBoundingClientRect();if(!r.width)return;cv.width=r.width*devicePixelRatio;cv.height=r.height*devicePixelRatio;draw()};
  new ResizeObserver(size).observe(cv);
  const shown=()=>{
    if(SV.shapes.length||SV.temp) return [...SV.shapes,...(SV.temp?[SV.temp]:[])];
    if(!vid.paused) return [];
    const it=v.items.find(i=>i.type==="draw"&&Math.abs(i.t-vid.currentTime)<0.2&&SV.filter.draw); return it?it.shapes:[];
  };
  function draw(){ ctx.clearRect(0,0,cv.width,cv.height); drawShapes(ctx,cv.width,cv.height,shown(),devicePixelRatio); }
  window._studioDraw=draw;
  const norm=(e)=>{const r=cv.getBoundingClientRect();return [(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]};
  let down=false;
  cv.onpointerdown=(e)=>{ if(!SV.drawOn) { vid.paused?vid.play():vid.pause(); return; } if(!SV.rec) vid.pause(); const p=norm(e);
    if(SV.tool==="angle"){ if(!SV.temp){SV.temp={tool:"angle",colour:SV.colour,pts:[p]}} else {SV.temp.pts.push(p); if(SV.temp.pts.length===3){SV.shapes.push(SV.temp);SV.temp=null}} draw(); hint(); return; }
    down=true; SV.temp={tool:SV.tool,colour:SV.colour,pts:[p,p]}; cv.setPointerCapture(e.pointerId); draw(); };
  cv.onpointermove=(e)=>{ if(!down||!SV.temp)return; const p=norm(e); if(SV.temp.tool==="free")SV.temp.pts.push(p); else SV.temp.pts[1]=p; draw(); };
  cv.onpointerup=()=>{ if(!down)return; down=false; if(SV.temp){SV.shapes.push(SV.temp);SV.temp=null} draw(); if(SV.mode==="analyse")renderPanel(); };
  function hint(){const h=$("thint");if(!SV.drawOn){h.classList.add("hidden");return}h.classList.remove("hidden");h.textContent=SV.tool==="angle"?(SV.temp?`Angle: tap point ${SV.temp.pts.length+1} of 3`:"Angle: tap 3 points (end, joint, end)"):({line:"Line: drag",arrow:"Arrow: drag",free:"Free: draw"})[SV.tool]}
  window._studioHint=hint; hint();

  const upd=()=>{const d=vid.duration||0,t=vid.currentTime;$("c-time").textContent=`${fmtT(t)} / ${fmtT(d)}`;$("flash").textContent=fmtT(t)+(SV.speed!==1?` · ${SV.speed}×`:"");
    const pc=d?t/d*100:0;$("prog").style.width=pc+"%";$("head").style.left=pc+"%";$("c-play").textContent=vid.paused?"▶ Play":"❚❚ Pause";draw();
    if(SV.edit==="clip") clipEditorTick();};
  // while recording, drawings stay up when you press play (like programming feedback)
  vid.ontimeupdate=upd; vid.onplay=()=>{if(!SV.rec){SV.shapes=[];SV.temp=null}upd()}; vid.onpause=upd; vid.onseeked=upd; vid.onloadedmetadata=()=>{upd();marks()};
  $("c-play").onclick=()=>vid.paused?vid.play():vid.pause();
  $("c-back").onclick=()=>{vid.pause();vid.currentTime=Math.max(0,vid.currentTime-1/30)};
  $("c-fwd").onclick=()=>{vid.pause();vid.currentTime=vid.currentTime+1/30};
  document.querySelectorAll(".spd").forEach(b=>b.onclick=()=>{SV.speed=+b.dataset.s;vid.playbackRate=SV.speed;document.querySelectorAll(".spd").forEach(x=>x.classList.toggle("on",x===b));upd()});
  $("c-draw").onclick=()=>toggleDraw();
  document.querySelectorAll(".sw").forEach(b=>b.onclick=()=>{SV.colour=b.dataset.c;document.querySelectorAll(".sw").forEach(x=>x.classList.toggle("on",x===b));if(!SV.drawOn)toggleDraw()});
  const tl=$("tline"); tl.onclick=(e)=>{if(e.target.classList.contains("mk"))return;const r=tl.getBoundingClientRect();vid.currentTime=(e.clientX-r.left)/r.width*(vid.duration||0)};
  document.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{SV.filter[b.dataset.f]^=1;b.classList.toggle("off",!SV.filter[b.dataset.f]);marks();renderPanel()});
  document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>setMode(b.dataset.mode));

  function marks(){
    const d=vid.duration||1; const counts={comment:0,draw:0,check:0,voice:0,screen:0};
    const all=allMoments(v);
    all.forEach(i=>counts[i.type]++);
    Object.keys(counts).forEach(k=>{const el=$("fc-"+k);if(el)el.textContent=counts[k]||""});
    $("marks").innerHTML=all.filter(i=>SV.filter[i.type]).map(i=>`<span class="mk ${i.type} ${i.type==="check"||i.type==="voice"?"r2":""}" style="left:${i.t/d*100}%" title="${fmtT(i.t)} · ${esc(TYPE_LABEL[i.type])}: ${esc(i.text)}" data-t="${i.t}"></span>`).join("");
    $("marks").querySelectorAll(".mk").forEach(k=>k.onclick=(e)=>{e.stopPropagation();vid.pause();vid.currentTime=+k.dataset.t});
    $("cliparea").innerHTML=v.clip?`<div style="position:absolute;top:16px;height:10px;left:${v.clip.a/d*100}%;width:${(v.clip.b-v.clip.a)/d*100}%;border:2px solid #ffd426;border-radius:4px;pointer-events:none"></div>`:"";
    const n=all.length; $("pcount").textContent=`${n} moment${n===1?"":"s"} · ${Object.keys(v.scores).length} scores`;
  }
  window._studioMarks=marks;

  $("p-draft").onclick=()=>{v.status=v.status==="sent"?"sent":"draft";toast("Draft saved. Pick up where you left off any time.");route()};
  $("p-send").onclick=()=>openReview();
  window._studio={v,m,vid}; renderPanel(); marks();
  if(SV.rec){ SV.rec=null; } // a recording can't survive leaving the page
}

// every moment on the timeline, including check sheet items linked to a moment
function allMoments(v){
  const sheet=SHEETS[v.sheet];
  const pins=Object.entries(v.pins).flatMap(([k,ts])=>{const [sk,it]=k.split(/:(.+)/);const sec=sheet.sections.find(s=>s.key===sk);if(!sec)return [];return ts.map((t,n)=>({t,type:"check",key:k,text:`${sec.name} · ${it}${ts.length>1?` (${n+1} of ${ts.length})`:""}${v.scores[k]?": "+v.scores[k]+"/10":v.hv[it]?": "+v.hv[it]:""}`}))});
  return [...v.items,...pins].sort((a,b)=>a.t-b.t);
}

function setMode(k){SV.mode=k;document.querySelectorAll("[data-mode]").forEach(b=>b.classList.toggle("on",b.dataset.mode===k));if(k==="analyse"&&!SV.drawOn)toggleDraw();renderPanel()}
function toggleDraw(){SV.drawOn=!SV.drawOn;SV.temp=null;$("c-draw").classList.toggle("draw-on",SV.drawOn);$("vbox").classList.toggle("drawing",SV.drawOn);if(SV.drawOn&&!SV.rec)window._studio.vid.pause();window._studioHint();window._studioDraw();if(SV.mode==="analyse")renderPanel()}
function addItem(type,text,extra={}){const {v,vid}=window._studio;const it={id:uid(),t:vid.currentTime,type,text,...extra};v.items.push(it);v.items.sort((a,b)=>a.t-b.t);if(v.status==="new")v.status="draft";window._studioMarks();renderPanel();return it}
function seek(t){const {vid}=window._studio;vid.pause();vid.currentTime=t}
function delItem(id){const {v}=window._studio;v.items=v.items.filter(i=>i.id!==id);if(SV.edit===id)SV.edit=null;window._studioMarks();renderPanel()}

function itemRow(i){
  const media = i.type==="voice" ? (i.src?`<div class="media"><audio controls src="${i.src}"></audio></div>`:"")
    : i.type==="screen" ? `<div class="media">${i.src?`<video controls playsinline src="${i.src}" data-ed="${i.id}"></video>`:`<div style="font-size:12px;color:#8b939b;padding:6px">Recording (simulated here: no camera or mic in this browser)</div>`}<div class="edrow"><button class="cb" onclick="event.stopPropagation();SV.edit='${i.id}';setMode('feedback')">✂ Trim and cut</button><span style="font-size:11px;color:#8b939b;align-self:center">${fmtT(editedLength(i.edit,i.dur))} after edits</span></div></div>` : "";
  return `<div class="fitem" onclick="seek(${i.t})"><span class="at" style="color:${TYPE_COL[i.type]}">${fmtT(i.t)}</span><div><span class="ty">${TYPE_LABEL[i.type]}</span><span class="tx">${esc(i.text)}</span>${i.img?`<img class="snapimg" src="${i.img}">`:""}${media}</div>${i.id?`<button class="x" onclick="event.stopPropagation();delItem('${i.id}')" title="Remove">✕</button>`:"<span></span>"}</div>`;
}
function wireMedia(root){ const {v}=window._studio; root.querySelectorAll("video[data-ed]").forEach(el=>{const it=v.items.find(i=>i.id===el.dataset.ed);if(it)applyEdit(el,it.edit)}); root.querySelectorAll(".media").forEach(x=>x.onclick=(e)=>e.stopPropagation()); }

// ---------------- panel ----------------
function renderPanel(){
  const {v,m,vid}=window._studio; const pb=$("pbody"); const sheet=SHEETS[v.sheet];
  if(SV.mode==="feedback"){
    if(SV.edit){ renderEditor(pb); return; }
    const list=v.items.filter(i=>["comment","voice","screen"].includes(i.type)&&SV.filter[i.type]);
    pb.innerHTML=`<div class="stack" style="gap:8px"><textarea class="din" id="cin" placeholder="Comment at ${fmtT(vid.currentTime)}… (Enter to add, Shift+Enter for a new line)"></textarea>
      <button class="btn pri sm" id="cadd" style="justify-self:start">Add comment at <span id="cat">${fmtT(vid.currentTime)}</span></button>
      <div style="height:4px"></div>
      ${SV.voice?`<div class="rec"><i></i>Recording voice note <b id="vct">0:00</b><button class="cb" style="margin-left:auto" onclick="stopVoice()">Stop</button></div>`:""}
      <div class="recrow"><button class="cb" onclick="SV.voice?stopVoice():startVoice()" ${SV.rec?"disabled":""}>🎙 ${SV.voice?"Stop voice note":"Voice note"}</button><button class="cb ${SV.rec?"draw-on":""}" onclick="SV.rec?stopScreen():startScreen()" ${SV.voice?"disabled":""}>🎥 ${SV.rec?"Stop recording":"Screen record"}</button></div>
      <label class="toggle"><input type="checkbox" ${SV.selfie?"checked":""} onchange="SV.selfie=this.checked" ${SV.rec?"disabled":""}> Selfie camera in the corner of screen recordings</label>
      <p style="font-size:11px;color:#6f7880;margin:0">Screen record captures the video, your drawings, your voice and (if on) your face. Play, pause, scrub and draw while it runs, then trim and cut it before sending.</p>
      <div style="margin-top:6px">${list.length?list.map(itemRow).join(""):`<p style="color:#8b939b;font-size:13px">Pause where something happens and write what you see, or talk it through with a voice note or screen recording. Each one sits on the timeline at that moment.</p>`}</div></div>`;
    const ci=$("cin"); const add=()=>{const t=ci.value.trim();if(!t)return;addItem("comment",t);setTimeout(()=>$("cin")&&$("cin").focus(),0)};
    $("cadd").onclick=add; ci.onkeydown=(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();add()}if(e.key==="Escape")ci.blur()};
    ci.onfocus=()=>{if(!SV.rec)vid.pause()};
    vid.addEventListener("timeupdate",()=>{const c=$("cat");if(c)c.textContent=fmtT(vid.currentTime)});
    wireMedia(pb);
  }
  if(SV.mode==="analyse"){
    const draws=v.items.filter(i=>i.type==="draw");
    pb.innerHTML=`<div class="dpanel"><div class="grp"><b>Tool</b><div class="tools">${[["line","╱","Line"],["arrow","➚","Arrow"],["angle","∠","Angle"],["free","✎","Free"]].map(([k,ic,l])=>`<button class="${SV.tool===k?"on":""}" data-tool="${k}"><span>${ic}</span>${l}</button>`).join("")}</div></div>
      <div class="grp"><b>On this frame</b><div class="row" style="gap:6px"><button class="cb" onclick="SV.shapes.pop();_studioDraw();renderPanel()">↶ Undo</button><button class="cb" onclick="SV.shapes=[];SV.temp=null;_studioDraw();renderPanel()">Clear</button><span style="font-size:12px;color:#8b939b">${SV.shapes.length} mark${SV.shapes.length===1?"":"s"}</span></div>
        <input class="din" id="dnote" placeholder="What the drawing shows, e.g. hips behind the bar at the catch">
        <button class="btn pri sm" id="dsave" ${SV.shapes.length?"":"disabled style='opacity:.5'"}>Save frame to timeline at ${fmtT(vid.currentTime)}</button></div>
      <div class="grp"><b>Body tracking</b><button class="cb" onclick="toast('Uses the TGC coaches-eye engine (MediaPipe): tap the links, then track the rep')">✦ Track the links (TGC coaches eye)</button><span style="font-size:11px;color:#6f7880">The same engine as kip-eye, push-eye and headpath, for TGC videos.</span></div>
      <div class="grp"><b>Saved drawings</b>${draws.length?draws.map(itemRow).join(""):`<span style="font-size:12px;color:#8b939b">Pause, draw, then save the frame. It shows on the timeline and in the feedback.</span>`}</div></div>`;
    pb.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>{SV.tool=b.dataset.tool;SV.temp=null;if(!SV.drawOn)toggleDraw();renderPanel();window._studioHint()});
    $("dsave").onclick=()=>{if(!SV.shapes.length)return;const img=snapshot();addItem("draw",$("dnote").value.trim()||"Drawing",{shapes:SV.shapes.slice(),img});SV.shapes=[];window._studioDraw();toast("Frame saved to the timeline")};
  }
  if(SV.mode==="sheet"){
    const sec=sheet.sections[SV.sec];
    const avg=(s)=>{const vals=s.items.map(it=>v.scores[s.key+":"+it]).filter(Boolean);return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null};
    pb.innerHTML=`<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8b939b;margin-bottom:6px">Choose a check sheet</div>
      <div class="secchips" style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #24282d">${Object.entries(SHEETS).map(([k,s])=>`<button class="${k===v.sheet&&v.include.sheet?"on":""}" data-sheet="${k}">${esc(s.short)}</button>`).join("")}<button class="${!v.include.sheet?"on":""}" data-sheet="">None</button></div>
      ${v.include.sheet?`<div style="font-size:14px;font-weight:600;margin-bottom:8px">${esc(sheet.name)}</div>`:""}
      ${!v.include.sheet?`<p style="font-size:13px;color:#8b939b">No check sheet will be sent with this feedback. Tap one above to complete it.</p>`:`
      <div class="secchips">${sheet.sections.map((s,i)=>{const a=avg(s);return `<button class="${i===SV.sec?"on":""}" data-sec="${i}">${s.name}${a?` <em>${a.toFixed(1)}</em>`:""}</button>`}).join("")}</div>
      ${sec.desc?`<p style="font-size:12px;color:#8b939b;margin:0 0 8px">${esc(sec.desc)}</p>`:""}
      ${sec.hv?"":`<div class="avg">Section average<div class="bar"><i style="width:${(avg(sec)||0)*10}%"></i></div><b>${avg(sec)?avg(sec).toFixed(1):"–"}</b></div>`}
      ${sec.items.map(it=>{const k=sec.key+":"+it;const pins=(v.pins[k]||[]).slice().sort((a,b)=>a-b);return `<div class="citem"><div class="top"><span>${esc(it)}${pins.length?` <span style="font-size:11px;color:#7fd6a8">· seen ${pins.length}×</span>`:""}</span><button class="pin" data-pin="${esc(k)}" title="Add the current moment in the video. Add as many as you like.">📍 Link moment</button></div>
        ${pins.length?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${pins.map(t=>`<span class="pin on" style="cursor:pointer;display:inline-flex;gap:6px" data-go="${t}">▶ ${fmtT(t)}<b data-unpin="${esc(k)}" data-t="${t}" title="Remove" style="font-weight:400">✕</b></span>`).join("")}</div>`:""}
        ${sec.hv?`<div class="hv">${["Seen","Partly","Not seen"].map(o=>`<button class="${v.hv[it]===o?"on":""}" data-hv="${esc(it)}" data-o="${o}">${o}</button>`).join("")}</div>`:`<div class="scale">${[1,2,3,4,5,6,7,8,9,10].map(n=>`<button class="${v.scores[k]===n?"on":v.scores[k]>n?"in":""}" data-sc="${esc(k)}" data-n="${n}">${n}</button>`).join("")}</div>`}</div>`}).join("")}
      <div style="margin-top:12px"><textarea class="din" id="secnote" placeholder="${sec.hv?"Where, and what happened?":"Comments: what led to these scores?"}">${esc(v.secNotes[sec.key]||"")}</textarea></div>
      <div class="row between" style="margin-top:10px"><button class="cb" ${SV.sec===0?"disabled":""} onclick="SV.sec--;renderPanel()">‹ Previous</button><button class="cb" ${SV.sec===sheet.sections.length-1?"disabled":""} onclick="SV.sec++;renderPanel()">Next section ›</button></div>`}`;
    pb.querySelectorAll("[data-sheet]").forEach(b=>b.onclick=()=>{const k=b.dataset.sheet;if(!k){v.include.sheet=0}else{v.include.sheet=1;v.sheet=k;SV.sec=0}route()});
    if(!v.include.sheet) return;
    pb.querySelectorAll("[data-sec]").forEach(b=>b.onclick=()=>{SV.sec=+b.dataset.sec;renderPanel()});
    pb.querySelectorAll("[data-sc]").forEach(b=>b.onclick=()=>{const k=b.dataset.sc,n=+b.dataset.n;if(v.scores[k]===n)delete v.scores[k];else v.scores[k]=n;if(v.status==="new")v.status="draft";window._studioMarks();renderPanel()});
    pb.querySelectorAll("[data-hv]").forEach(b=>b.onclick=()=>{const k=b.dataset.hv;v.hv[k]=v.hv[k]===b.dataset.o?undefined:b.dataset.o;window._studioMarks();renderPanel()});
    pb.querySelectorAll("[data-pin]").forEach(b=>b.onclick=()=>{const k=b.dataset.pin;const a=v.pins[k]||(v.pins[k]=[]);const t=vid.currentTime;if(a.some(x=>Math.abs(x-t)<.3)){toast("Already linked at "+fmtT(t));return}a.push(t);if(v.status==="new")v.status="draft";window._studioMarks();renderPanel()});
    pb.querySelectorAll("[data-go]").forEach(b=>b.onclick=(e)=>{if(e.target.dataset.unpin)return;seek(+b.dataset.go)});
    pb.querySelectorAll("[data-unpin]").forEach(b=>b.onclick=(e)=>{e.stopPropagation();const k=b.dataset.unpin;v.pins[k]=(v.pins[k]||[]).filter(x=>x!==+b.dataset.t);if(!v.pins[k].length)delete v.pins[k];window._studioMarks();renderPanel()});
    $("secnote").oninput=(e)=>{v.secNotes[sec.key]=e.target.value};
  }
  if(SV.mode==="guide"){
    const g=GUIDES.find(x=>x.id===v.guide);
    pb.innerHTML=`<div class="row between" style="margin-bottom:8px"><span style="font-size:12px;color:#8b939b">${esc(firstName(m))} planned this session before filming. Compare the plan with what happened, and add a note to any section.</span></div>
      <button class="cb" style="width:100%;margin-bottom:10px" onclick="openGuideModal('${g.id}',true)">⤢ Open full page</button><div id="gview"></div>`;
    LG.renderGuide($("gview"), g, {stack:true, notes:"edit", onChange:()=>{}});
    if(!SV.filter.guide) SV.filter.guide=1;
    if(v.status==="new") v.status="draft";
    return;
  }
  if(SV.mode==="report"){
    const timeline=allMoments(v).filter(i=>SV.filter[i.type]);
    const topics=Object.entries(BANK).flatMap(([k,b])=>b.rows.map(r=>[k,r[0]])).filter(([k,t])=>madeFor(k,t).length);
    pb.innerHTML=`<div class="rep"><p style="font-size:12px;color:#8b939b;margin:0">The direction goes at the top of ${esc(firstName(m))}'s feedback page, above the video and every moment.</p>
      <h4>What I want you to take from this</h4><textarea class="din" id="sum" style="min-height:90px" placeholder="The one or two things that matter most">${esc(v.summary)}</textarea>
      <button class="cb" style="margin-top:6px" onclick="document.getElementById('sum').value=draftSummary();window._studio.v.summary=document.getElementById('sum').value;toast('Drafted from your comments and scores. Edit before sending.')">✦ Draft from my notes</button>
      <h4>Actions for this week</h4><div class="stack" style="gap:6px">${v.actions.map((a,i)=>`<input class="din" data-act="${i}" value="${esc(a)}" placeholder="${["e.g. One cue, one athlete, then move","e.g. Name every athlete in the first 10 minutes","e.g. Film Thursday's class"][i]}">`).join("")}</div>
      <h4>Next focus from the topic bank</h4><select class="din" id="topicsel"><option value="">None this time</option>${topics.map(([k,t])=>`<option value="${k}|${esc(t)}" ${v.topic===k+"|"+t?"selected":""}>${BANK[k].label} · ${esc(t)}</option>`).join("")}</select>
      <h4>On the timeline · ${timeline.length}</h4>${timeline.length?timeline.map(itemRow).join(""):`<p style="font-size:12px;color:#8b939b">Nothing yet. Use Feedback, Analyse or Check sheet.</p>`}</div>`;
    $("sum").oninput=(e)=>{v.summary=e.target.value};
    pb.querySelectorAll("[data-act]").forEach(i=>i.oninput=()=>{v.actions[+i.dataset.act]=i.value});
    $("topicsel").onchange=(e)=>{v.topic=e.target.value};
    wireMedia(pb);
  }
}
function draftSummary(){const {v,m}=window._studio;const c=v.items.filter(i=>i.type==="comment").map(i=>i.text);const top=Object.entries(v.scores).sort((a,b)=>b[1]-a[1]);
  return `${firstName(m)}, great video to work from.\n\nWhat's working: ${c[0]||(top[0]?top[0][0].split(":")[1]+" stood out":"your energy with the group")}.\n\nThe one thing for this week: ${top.length>1?top[top.length-1][0].split(":")[1].toLowerCase():"shorter cues"}. Watch the moments I've marked, then try it in your next class.`}
function snapshot(){const {vid}=window._studio;const cv=$("cv");const W=480,H=Math.round(480*cv.height/cv.width);const c=document.createElement("canvas");c.width=W;c.height=H;const x=c.getContext("2d");x.fillStyle="#000";x.fillRect(0,0,W,H);
  drawContain(x,vid,W,H);x.drawImage(cv,0,0,W,H);try{return c.toDataURL("image/jpeg",.7)}catch(e){return null}}

// ---------------- trim + cut editor (screen recordings and the clip itself) ----------------
let ED={mark:null};
function renderEditor(pb){
  const {v,vid}=window._studio;
  const isClip = SV.edit==="clip";
  const it = isClip ? null : v.items.find(i=>i.id===SV.edit);
  if(!isClip && !it){ SV.edit=null; renderPanel(); return; }
  const dur = isClip ? (vid.duration||0) : (it.dur||0);
  const ed = isClip ? (v.clip || (v.clip={a:0,b:dur,cuts:[]})) : (it.edit || (it.edit={a:0,b:dur,cuts:[]}));
  if(!ed.b) ed.b=dur;
  const pct=(t)=>dur?t/dur*100:0;
  pb.innerHTML=`<div class="stack" style="gap:8px">
    <div class="row between"><b style="font-size:14px">${isClip?"Trim the clip":"Trim and cut your recording"}</b><button class="cb" id="ed-done">Done</button></div>
    <p style="font-size:12px;color:#8b939b;margin:0">${isClip?`Choose the part of the video ${esc(firstName(window._studio.m))} sees. Play it in the main player and set the start and end.`:`Set where it starts and ends, and cut out any middle bits. Nothing is lost: you can undo.`}</p>
    ${isClip?"":(it.src?`<div class="media"><video id="edv" playsinline src="${it.src}"></video></div>`:`<div class="media" style="font-size:12px;color:#8b939b">Simulated recording (${fmtT(dur)}). Real recordings play here.</div>`)}
    <div class="trim" id="edtrim"><div class="keep" style="left:${pct(ed.a)}%;width:${pct(ed.b-ed.a)}%"></div>${ed.cuts.map(([x,y])=>`<div class="cut" style="left:${pct(x)}%;width:${pct(y-x)}%"></div>`).join("")}${ED.mark!=null?`<div class="mark" style="left:${pct(ED.mark)}%"></div>`:""}<div class="ph2" id="edph"></div></div>
    <div class="row between" style="font-size:12px;color:#8b939b"><span>Start ${fmtT(ed.a)}</span><span id="edt">0:00</span><span>End ${fmtT(ed.b)}</span></div>
    <div class="edrow">${isClip||!it.src?"":`<button class="cb" id="ed-play">▶ Play</button>`}<button class="cb" id="ed-a">⇤ Start here</button><button class="cb" id="ed-b">End here ⇥</button>
      <button class="cb" id="ed-cut">${ED.mark==null?"✂ Mark cut start":"✂ Cut to here"}</button><button class="cb" id="ed-undo" ${ed.cuts.length?"":"disabled"}>↶ Undo cut</button><button class="cb" id="ed-reset">Reset</button></div>
    <p style="font-size:12px;color:#aab2ba;margin:0">${ed.cuts.length} cut${ed.cuts.length===1?"":"s"} · ${fmtT(editedLength(ed,dur))} after edits (was ${fmtT(dur)})</p></div>`;
  const player = isClip ? vid : $("edv");
  const cur = () => player ? player.currentTime : 0;
  const tick=()=>{const t=cur();const ph=$("edph");if(ph)ph.style.left=pct(t)+"%";const e=$("edt");if(e)e.textContent=fmtT(t)};
  window.clipEditorTick=tick;
  if(player && !isClip){ applyEdit(player, ed); player.ontimeupdate=tick; $("ed-play").onclick=()=>{player.paused?player.play():player.pause()}; player.onplay=()=>$("ed-play").textContent="❚❚ Pause"; player.onpause=()=>$("ed-play").textContent="▶ Play"; }
  $("edtrim").onclick=(e)=>{const r=$("edtrim").getBoundingClientRect();const t=(e.clientX-r.left)/r.width*dur;if(player)player.currentTime=t;else ED.fake=t;tick()};
  const at=()=>player?cur():(ED.fake||0);
  $("ed-a").onclick=()=>{ed.a=Math.min(at(),ed.b-0.5);renderEditor(pb)};
  $("ed-b").onclick=()=>{ed.b=Math.max(at(),ed.a+0.5);renderEditor(pb)};
  $("ed-cut").onclick=()=>{const t=at();if(ED.mark==null){ED.mark=t;toast("Now move to where the cut ends and press Cut to here")}else{const x=Math.min(ED.mark,t),y=Math.max(ED.mark,t);if(y-x>0.2)ed.cuts.push([x,y]);ED.mark=null}renderEditor(pb)};
  $("ed-undo").onclick=()=>{ed.cuts.pop();renderEditor(pb)};
  $("ed-reset").onclick=()=>{ed.a=0;ed.b=dur;ed.cuts=[];ED.mark=null;renderEditor(pb)};
  $("ed-done").onclick=()=>{SV.edit=null;ED.mark=null;window.clipEditorTick=()=>{};window._studioMarks();renderPanel();toast(isClip?"Clip trimmed":"Edits saved")};
  tick();
}
window.clipEditorTick=()=>{};

// ---------------- voice notes ----------------
async function startVoice(){
  const {vid}=window._studio; if(!SV.rec) vid.pause();
  SV.voice={start:Date.now(), t:vid.currentTime, chunks:[]};
  try{ const s=await navigator.mediaDevices.getUserMedia({audio:true}); SV.voice.stream=s; const r=new MediaRecorder(s); SV.voice.r=r; r.ondataavailable=e=>SV.voice&&SV.voice.chunks.push(e.data); r.start(); }
  catch(e){ SV.voice.fake=true; }
  renderPanel(); SV.voice.iv=setInterval(()=>{const e=$("vct");if(e&&SV.voice)e.textContent=fmtT((Date.now()-SV.voice.start)/1000)},250);
}
function stopVoice(){
  const V=SV.voice; if(!V)return; clearInterval(V.iv); const dur=(Date.now()-V.start)/1000; SV.voice=null;
  const finish=(src)=>{const {v}=window._studio;v.items.push({id:uid(),t:V.t,type:"voice",text:`Voice note · ${fmtT(Math.max(1,dur))}`,src,dur});v.items.sort((a,b)=>a.t-b.t);if(v.status==="new")v.status="draft";window._studioMarks();renderPanel()};
  if(V.r){ V.r.onstop=()=>{V.stream.getTracks().forEach(t=>t.stop());finish(URL.createObjectURL(new Blob(V.chunks,{type:V.r.mimeType||"audio/webm"})))}; V.r.stop(); }
  else { finish(null); toast("No microphone in this browser, so the voice note is simulated"); }
}

// ---------------- screen recording (video + drawings + voice + selfie) ----------------
async function startScreen(){
  const {vid}=window._studio; const cv=$("cv");
  const R={start:Date.now(), t:vid.currentTime, chunks:[]}; SV.rec=R;
  let stream=null;
  try{ stream=await navigator.mediaDevices.getUserMedia({audio:true, video:SV.selfie?{width:480,height:480,facingMode:"user"}:false}); }
  catch(e){ try{ stream=await navigator.mediaDevices.getUserMedia({audio:true}); }catch(e2){ stream=null; } }
  R.stream=stream;
  const selfieOn = stream && stream.getVideoTracks().length;
  const sv=$("selfie"); if(selfieOn){ sv.srcObject=stream; sv.classList.remove("hidden"); sv.play().catch(()=>{}); }
  if(stream && window.MediaRecorder && HTMLCanvasElement.prototype.captureStream){
    const W=1280, H=Math.round(1280*(cv.height/cv.width||9/16)); const comp=document.createElement("canvas"); comp.width=W; comp.height=H; const x=comp.getContext("2d");
    const frame=()=>{ if(SV.rec!==R) return; x.fillStyle="#000"; x.fillRect(0,0,W,H); drawContain(x,vid,W,H); try{x.drawImage(cv,0,0,W,H)}catch(e){}
      if(selfieOn){ const d=Math.round(H*.26), cx=W-d/2-24, cy=H-d/2-24; x.save(); x.beginPath(); x.arc(cx,cy,d/2,0,7); x.clip(); const s=Math.min(sv.videoWidth,sv.videoHeight)||1; x.translate(cx+d/2,cy-d/2); x.scale(-1,1); try{x.drawImage(sv,(sv.videoWidth-s)/2,(sv.videoHeight-s)/2,s,s,0,0,d,d)}catch(e){} x.restore(); x.strokeStyle="#fff"; x.lineWidth=5; x.beginPath(); x.arc(cx,cy,d/2,0,7); x.stroke(); }
      R.raf=requestAnimationFrame(frame); };
    frame();
    const out=comp.captureStream(30); stream.getAudioTracks().forEach(t=>out.addTrack(t));
    const mime=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm","video/mp4"].find(t=>MediaRecorder.isTypeSupported(t))||"";
    try{ R.r=new MediaRecorder(out, mime?{mimeType:mime}:{}); R.r.ondataavailable=e=>e.data.size&&R.chunks.push(e.data); R.r.start(500); }catch(e){ R.r=null; }
  }
  if(!R.r) R.fake=true;
  $("recbar").innerHTML=`<div class="recbar"><i></i><span>Recording${selfieOn?" with your camera":""}${R.fake?" (simulated: no camera or mic here)":""}. Play, pause, scrub and draw, and talk it through.</span><b id="rct" style="margin-left:auto">0:00</b><button class="cb" onclick="stopScreen()">■ Stop</button><button class="cb" onclick="stopScreen(true)">Discard</button></div>`;
  $("srec-top").textContent="■ Stop recording";
  R.iv=setInterval(()=>{const e=$("rct");if(e)e.textContent=fmtT((Date.now()-R.start)/1000)},250);
  if(!SV.drawOn) toggleDraw();
  renderPanel();
}
function stopScreen(discard){
  const R=SV.rec; if(!R)return; SV.rec=null; clearInterval(R.iv); cancelAnimationFrame(R.raf);
  const dur=(Date.now()-R.start)/1000;
  const cleanup=()=>{ if(R.stream) R.stream.getTracks().forEach(t=>t.stop()); const sv=$("selfie"); if(sv){sv.srcObject=null;sv.classList.add("hidden")} const rb=$("recbar"); if(rb) rb.innerHTML=""; const tb=$("srec-top"); if(tb) tb.textContent="🎥 Screen record"; };
  const finish=(src)=>{ cleanup(); if(discard){ toast("Recording discarded"); renderPanel(); return; }
    const {v}=window._studio; const it={id:uid(),t:R.t,type:"screen",text:`Screen recording · ${fmtT(Math.max(1,dur))}`,src,dur,edit:{a:0,b:dur,cuts:[]}};
    v.items.push(it); v.items.sort((a,b)=>a.t-b.t); if(v.status==="new")v.status="draft"; SV.edit=it.id; SV.mode="feedback";
    document.querySelectorAll("[data-mode]").forEach(b=>b.classList.toggle("on",b.dataset.mode==="feedback")); window._studioMarks(); renderPanel();
    toast("Recording added. Trim or cut it, then press Done."); };
  if(R.r){ R.r.onstop=()=>finish(URL.createObjectURL(new Blob(R.chunks,{type:R.r.mimeType||"video/webm"}))); R.r.stop(); } else finish(null);
}

// ---------------- review before sending ----------------
function parts(v){
  const c=(t)=>v.items.filter(i=>i.type===t).length;
  const sc=Object.keys(v.scores).length+Object.values(v.hv).filter(Boolean).length+Object.keys(v.pins).filter(k=>!v.scores[k]).length;
  return [
    ["direction","Direction for the week", v.summary||v.actions.some(Boolean)||v.topic ? `${v.actions.filter(Boolean).length} actions${v.topic?" · next focus set":""}` : null],
    ["clip","Their video", v.clip?`trimmed to ${fmtT(v.clip.a)}–${fmtT(v.clip.b)}`:"full clip"],
    ["comment","Written comments", c("comment")||null],
    ["draw","Drawings on frames", c("draw")||null],
    ["voice","Voice notes", c("voice")||null],
    ["screen","Screen recordings", c("screen")||null],
    ...(v.guide?[["guide","Notes on their lesson guide", (()=>{const g=GUIDES.find(x=>x.id===v.guide);const n=Object.values(g.notes||{}).filter(Boolean).length;return n?n+" section note"+(n>1?"s":""):null})()]]:[]),
    ["sheet",SHEETS[v.sheet].name, v.include.sheet&&sc?`${sc} items marked${Object.values(v.pins).flat().length?" · "+Object.values(v.pins).flat().length+" moments linked":""}`:null],
  ];
}
function openReview(){
  const {v,m}=window._studio;
  const ps=parts(v); const any=ps.some(([k,,n])=>n&&k!=="clip");
  if(!any){ toast("Add a comment, recording, drawing, score or direction first"); return; }
  const div=document.createElement("div"); div.className="modal2"; div.id="review";
  const render=()=>{
    div.innerHTML=`<div class="box"><div class="lside">
      <div><div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8b939b">Before you send</div><h3>Review ${esc(firstName(m))}'s feedback</h3></div>
      <p style="font-size:12px;color:#8b939b;margin:0">On the right is exactly what ${esc(firstName(m))} will see in their Mentorship tab. Untick anything you don't want to send.</p>
      <div class="inc">${ps.map(([k,l,n])=>`<label class="${!n&&k!=="clip"?"off":""}"><input type="checkbox" data-inc="${k}" ${v.include[k]&&(n||k==="clip")?"checked":""} ${!n&&k!=="clip"?"disabled":""}><span>${l}</span><small>${n||"none"}</small></label>`).join("")}</div>
      <div style="margin-top:auto;display:flex;flex-direction:column;gap:8px">
        <label class="toggle"><input type="checkbox" checked id="rv-email"> Email ${esc(firstName(m))} that their feedback is ready</label>
        ${v.topic?`<label class="toggle"><input type="checkbox" checked id="rv-focus"> Make “${esc(v.topic.split("|")[1])}” their focus this week</label>`:""}
        <button class="btn pri" id="rv-send" style="justify-content:center;padding:11px">Send to ${esc(firstName(m))}</button>
        <button class="cb" id="rv-back">‹ Back to editing</button></div></div>
      <div class="rside"><div class="prevlab">What ${esc(firstName(m))} sees</div><div class="phoneframe">${menteeFeedbackHTML(v,{preview:true})}</div></div></div>`;
    div.querySelectorAll("[data-inc]").forEach(c=>c.onchange=()=>{v.include[c.dataset.inc]=c.checked?1:0;render()});
    $("rv-back").onclick=()=>div.remove();
    $("rv-send").onclick=()=>{ const focus=$("rv-focus")?.checked; send(v,m,focus); div.remove(); };
    wireFeedback(div.querySelector(".fb"), v);
  };
  document.body.append(div); render();
}
function send(v,m,focus){
  v.status="sent"; v.sentOn=TODAY_LABEL.slice(4); v.sentBy=ME;
  m.events.push([v.sentOn,"Video feedback sent: "+v.title,"good"]);
  if(focus&&v.topic){ const [bank,topic]=v.topic.split("|"); m.path.forEach(p=>{if(p.status==="now")p.status="done"}); m.path.push({bank,topic,media:madeFor(bank,topic)[0]||"Article",focus:v.actions.find(Boolean)||"From your video feedback",status:"now",date:v.sentOn}); }
  toast(`Sent. ${firstName(m)} has their feedback page and an email.`);
  const next=VIDEOS.find(x=>x.status!=="sent"&&(isAdmin()||menteeById(x.mentee).mentor===ME)); go(next?"review/"+next.id:"learner/"+v.id);
}

// ================= WHAT THE MENTEE RECEIVES =================
function menteeFeedbackHTML(v, opt={}){
  ensure(v); const m=menteeById(v.mentee); const mentor=MENTORS[v.sentBy||m.mentor||ME]; const inc=v.include; const sheet=SHEETS[v.sheet];
  const moments=allMoments(v).filter(i=> (i.type==="check" ? inc.sheet : inc[i.type]));
  const acts=v.actions.filter(Boolean);
  const topic=v.topic?v.topic.split("|"):null;
  const secs=sheet.sections.map(s=>{const vals=s.items.map(it=>v.scores[s.key+":"+it]).filter(Boolean);return {s,a:vals.length?vals.reduce((x,y)=>x+y,0)/vals.length:null}});
  const showSheet = inc.sheet && (Object.keys(v.scores).length||Object.values(v.hv).some(Boolean)||Object.values(v.pins).flat().length);
  return `<div class="fb"><div class="in">
    <div><div class="eb">Mentorship · cycle ${m.cycle}, week ${m.week} · ${opt.preview?"preview":"from "+esc(mentor.name)}</div><h1>Your video feedback</h1><div style="color:#9a928c;font-size:13px;margin-top:4px">“${esc(v.title)}” · ${esc(mentor.name)}${v.sentOn?" · "+esc(v.sentOn):""}</div></div>
    ${inc.direction&&(v.summary||acts.length||topic)?`<div class="cardl dir"><h2>Your direction this week</h2>${v.summary?`<p>${esc(v.summary)}</p>`:""}
      ${acts.length?`<div>${acts.map((a,i)=>`<label class="act"><input type="checkbox" data-act="${i}"><span>${esc(a)}</span></label>`).join("")}</div>`:""}
      ${topic?`<div class="topic"><span style="font-size:22px">☰</span><div style="flex:1"><span style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#9a928c">Your next focus</span><b>${esc(topic[1])}</b><span style="font-size:12px;color:#9a928c">${madeFor(topic[0],topic[1]).join(" · ")}</span></div><button class="lb gh">Open</button></div>`:""}</div>`:""}
    <div class="cardl"><h2>Your video ${moments.length?`· ${moments.length} moment${moments.length===1?"":"s"} marked`:""}</h2>
      ${inc.clip?`<div class="vw"><video class="fbv" playsinline controls></video><canvas class="fbc"></canvas><div class="cap fbcap"></div></div>
      <div class="tl2"><div class="tr"></div><div class="pg fbpg"></div>${""}<div class="fbmk"></div></div>`:`<p style="color:#9a928c;font-size:13px">Your video isn't included this time.</p>`}
      <div style="margin-top:6px">${moments.length?moments.map((i,n)=>`<div class="mo" data-n="${n}" data-t="${i.t}"><span class="at" style="color:${TYPE_HEX[i.type]}">${fmtT(i.t)}</span><div><span class="ty">${TYPE_LABEL[i.type]}</span>${esc(i.text)}
        ${i.type==="draw"&&i.img?`<img src="${i.img}">`:""}
        ${i.type==="voice"?(i.src?`<audio controls src="${i.src}" style="width:100%;margin-top:6px"></audio>`:`<div style="font-size:12px;color:#9a928c">▶ play voice note</div>`):""}
        ${i.type==="screen"?(i.src?`<video controls playsinline src="${i.src}" data-ed="${i.id}" style="width:100%;border-radius:6px;margin-top:6px"></video>`:`<div style="font-size:12px;color:#9a928c">▶ play recording (${fmtT(editedLength(i.edit,i.dur))})</div>`):""}
      </div></div>`).join(""):`<p style="color:#9a928c;font-size:13px">No moments marked.</p>`}</div></div>
    ${showSheet?`<div class="cardl"><h2>${esc(sheet.name)}</h2>
      ${secs.filter(x=>!x.s.hv).map(x=>`<div class="sc"><span>${x.s.name}</span><div class="bar"><i style="width:${(x.a||0)*10}%"></i></div><b>${x.a?x.a.toFixed(1):"–"}</b></div>`).join("")}
      ${sheet.sections.map(s=>{const rows=s.items.filter(it=>v.scores[s.key+":"+it]||v.hv[it]||(v.pins[s.key+":"+it]||[]).length);if(!rows.length&&!v.secNotes[s.key])return "";return `<details ${s.key==="comm"?"open":""}><summary>${s.name}</summary>${rows.map(it=>{const k=s.key+":"+it;return `<div class="it"><span>${esc(it)}</span><span>${v.scores[k]?v.scores[k]+"/10":v.hv[it]?esc(v.hv[it]):(v.pins[k]||[]).length+"× seen"}${(v.pins[k]||[]).slice().sort((a,b)=>a-b).map(t=>` <a data-seek="${t}">▶ ${fmtT(t)}</a>`).join("")}</span></div>`}).join("")}${v.secNotes[s.key]?`<div class="it" style="color:#9a928c">“${esc(v.secNotes[s.key])}”</div>`:""}</details>`}).join("")}</div>`:""}
    ${v.guide&&inc.guide&&Object.values((GUIDES.find(x=>x.id===v.guide)||{}).notes||{}).some(Boolean)?`<div class="cardl"><h2>Your lesson guide · with ${esc(mentor.short)}'s notes</h2><div class="fbguide" data-g="${v.guide}"></div></div>`:""}
    <div class="cardl"><h2>Reply to ${esc(mentor.short)}</h2><div class="reply"><input placeholder="Thanks! A question about 0:40…"><button class="lb">Send</button></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="lb gh">✓ Got it</button><button class="lb gh">🎥 Send a new video</button></div></div>
  </div></div>`;
}
function wireFeedback(root, v){
  if(!root) return; ensure(v);
  root.querySelectorAll(".fbguide").forEach(el=>{const g=GUIDES.find(x=>x.id===el.dataset.g); if(g) LG.renderGuide(el,g,{stack:true,notes:"view"});});
  const vid=root.querySelector(".fbv"); const cvs=root.querySelector(".fbc"); const cap=root.querySelector(".fbcap");
  root.querySelectorAll("video[data-ed]").forEach(el=>{const it=v.items.find(i=>i.id===el.dataset.ed);if(it)applyEdit(el,it.edit)});
  if(!vid) return;
  loadVideo(vid, v.src); if(v.clip) applyEdit(vid, v.clip);
  const inc=v.include; const moments=allMoments(v).filter(i=>(i.type==="check"?inc.sheet:inc[i.type]));
  const ctx=cvs.getContext("2d");
  const show=()=>{ const r=cvs.getBoundingClientRect(); if(!r.width) return; cvs.width=r.width*devicePixelRatio; cvs.height=r.height*devicePixelRatio; ctx.clearRect(0,0,cvs.width,cvs.height);
    const t=vid.currentTime; const near=moments.find(i=>Math.abs(i.t-t)<0.35);
    if(near&&near.type==="draw"&&vid.paused) drawShapes(ctx,cvs.width,cvs.height,near.shapes||[],devicePixelRatio);
    if(near&&near.type!=="draw"){cap.style.display="block";cap.innerHTML=`<b style="color:${TYPE_HEX[near.type]}">${fmtT(near.t)}</b> ${esc(near.text)}`} else cap.style.display="none";
    root.querySelectorAll(".mo").forEach(e=>e.classList.toggle("on",near&&+e.dataset.t===near.t));
    const pg=root.querySelector(".fbpg"); if(pg&&vid.duration) pg.style.width=(t/vid.duration*100)+"%"; };
  vid.addEventListener("timeupdate",show); vid.addEventListener("seeked",show); vid.addEventListener("pause",show);
  vid.addEventListener("loadedmetadata",()=>{ const d=vid.duration||1; root.querySelector(".fbmk").innerHTML=moments.map(i=>`<span class="mk" style="left:${i.t/d*100}%;background:${TYPE_HEX[i.type]}" data-t="${i.t}" title="${esc(i.text)}"></span>`).join(""); root.querySelectorAll(".fbmk .mk").forEach(k=>k.onclick=()=>jump(+k.dataset.t)); show(); });
  const jump=(t)=>{vid.pause();vid.currentTime=t;root.querySelector(".vw").scrollIntoView({block:"nearest",behavior:"smooth"})};
  root.querySelectorAll(".mo").forEach(e=>e.onclick=(ev)=>{if(ev.target.closest("audio,video"))return;jump(+e.dataset.t)});
  root.querySelectorAll("[data-seek]").forEach(a=>a.onclick=()=>jump(+a.dataset.seek));
}

ROUTES.learner = (el, id) => {
  const v = VIDEOS.find(x=>x.id===id) || VIDEOS.find(x=>x.status==="sent") || VIDEOS.find(x=>ensure(x).items.length) || VIDEOS[0];
  ensure(v); const m=menteeById(v.mentee);
  el.innerHTML = `<div style="background:#ffd84d;color:#16181b;font-size:12px;padding:6px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>Mentee's view</b> · ${esc(m.name)}'s Mentorship tab in BirdBox Learn
      <select style="margin-left:auto;font-size:12px" onchange="go('learner/'+this.value)">${VIDEOS.map(x=>`<option value="${x.id}" ${x.id===v.id?"selected":""}>${esc(menteeById(x.mentee).name)} · ${esc(x.title)} (${x.status})</option>`).join("")}</select>
      <button onclick="go('review/${v.id}')" style="font-size:12px">‹ Back to the studio</button></div>
    ${v.status==="sent"?"":`<div style="background:#2a2212;color:#f0cf8a;font-size:12px;padding:8px 14px">Not sent yet, so this shows the draft as it stands.</div>`}
    ${menteeFeedbackHTML(v)}`;
  wireFeedback(el.querySelector(".fb"), v);
};

window.studioKey=(e)=>{
  const S=window._studio; if(!S||!document.getElementById("vid")||document.getElementById("review"))return false; const vid=S.vid;
  if(e.key===" "){e.preventDefault();vid.paused?vid.play():vid.pause();return true}
  if(e.key===","){vid.pause();vid.currentTime=Math.max(0,vid.currentTime-1/30);return true}
  if(e.key==="."){vid.pause();vid.currentTime+=1/30;return true}
  if(e.key==="ArrowLeft"){vid.currentTime=Math.max(0,vid.currentTime-5);return true}
  if(e.key==="ArrowRight"){vid.currentTime+=5;return true}
  if(e.key==="d"){toggleDraw();return true}
  if(e.key==="c"){setMode("feedback");if(!SV.rec)vid.pause();setTimeout(()=>$("cin")&&$("cin").focus(),0);e.preventDefault();return true}
  const ms=["feedback","analyse","sheet",...(S.v.guide?["guide"]:[]),"report"]; if(/^[1-5]$/.test(e.key)&&ms[+e.key-1]){setMode(ms[+e.key-1]);return true}
  if(e.key==="z"&&(e.metaKey||e.ctrlKey)){SV.shapes.pop();window._studioDraw();return true}
  return false;
};

// full lesson guide in a pop-up, with mentor notes
function openGuideModal(id, notes){
  const g=GUIDES.find(x=>x.id===id); const m=menteeById(g.owner);
  const d=document.createElement("div"); d.className="lgmodal"; d.id="lgm";
  const draw=()=>{ d.innerHTML=`<div class="inner"><div class="bar2"><b>${esc(m.name)}'s lesson guide · ${g.status==="reviewed"?"reviewed":"sent "+esc(g.sent||"")}</b>
      ${notes?`<button class="btn sm" id="lg-ok" style="background:#1f8a54;border-color:#1f8a54;color:#fff">✓ Reviewed: ready to coach</button>`:""}<button class="btn sm" id="lg-pdf">⤓ PDF</button><button class="btn sm" id="lg-x">Close</button></div><div id="lgfull"></div></div>`;
    LG.renderGuide(d.querySelector("#lgfull"), g, {notes:notes?"edit":"view"});
    d.querySelector("#lg-x").onclick=()=>{d.remove(); if(location.hash.startsWith("#review")) renderPanel(); else route();};
    d.querySelector("#lg-pdf").onclick=()=>window.open("lesson-guide.html?print="+g.id,"_blank");
    const ok=d.querySelector("#lg-ok"); if(ok) ok.onclick=()=>{g.status="reviewed";toast(`${firstName(m)} has your notes and can go and coach it.`);d.remove();route()};
  };
  document.body.append(d); draw();
}
