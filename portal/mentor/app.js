// Mentor portal (being built, admins only): shell, routing, pages. Review studio lives in studio.js.
// Still runs on the example data in data.js. Opens once gate.js confirms an admin is signed in.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(t){const d=document.createElement("div");d.className="toast";d.textContent=t;document.body.append(d);setTimeout(()=>d.remove(),2400)}
const initials = (n) => n.split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
const avColour = (id) => ["#2f7fd0","#b0418f","#d1632b","#2f8f6b","#6a5acd","#8a6d1f","#c0392b","#1f7a8c"][[...id].reduce((a,c)=>a+c.charCodeAt(0),0)%8];
const av = (m, size) => `<span class="av" style="background:${avColour(m.id)}${size?`;width:${size}px;height:${size}px`:""}">${initials(m.name)}</span>`;
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const DATES = [23,24,25,26,27,28,29];
const fmt = (min) => `${String(Math.floor(min/60)).padStart(2,"0")}:${String(min%60).padStart(2,"0")}`;

let ME = "nathan";
const isAdmin = () => MENTORS[ME].admin;
const mine = () => MENTEES.filter(m => m.mentor === ME);
const menteeById = (id) => MENTEES.find(m => m.id === id);
// b.day = days from Mon 23 Nov (the example week); b.date is set for calls booked further ahead.
const callLabel = (b) => { if (b.date) { const [y,mo,d]=b.date.split("-").map(Number); const dt=new Date(Date.UTC(y,mo-1,d)); return `${dt.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"}).replace(",","")} · ${fmt(b.start)}`; } return `${DAYS[b.day]} ${DATES[b.day]} Nov · ${fmt(b.start)}`; };
const nextCall = (m) => { const b = BOOKINGS.filter(b=>b.mentee===m.id).sort((a,b)=>a.day-b.day||a.start-b.start)[0]; return b ? callLabel(b) : null; };
const videosFor = (m) => VIDEOS.filter(v => v.mentee === m.id);
function flags(m){
  const f=[];
  if(VIDEOS.some(v=>v.mentee===m.id&&v.status!=="sent")) f.push(["Video to review","warn","review"]);
  if(m.unread) f.push([`${m.unread} message${m.unread>1?"s":""}`,"acc","messages"]);
  if(!nextCall(m)) f.push(["No call booked","warn","calendar"]);
  if(m.pay==="failed") f.push(["Payment failed","bad",""]);
  if(!m.path.some(p=>p.status==="now")) f.push(["No focus set","warn","path"]);
  return f;
}

// ---------------- routing ----------------
const ROUTES = {};
function go(hash){ location.hash = hash; }
function route(){
  const [r, arg] = (location.hash.slice(1) || "today").split("/");
  if(r.startsWith("a-") && !isAdmin()){ go("today"); return; }
  document.querySelectorAll(".nav a").forEach(a=>a.classList.toggle("on", a.dataset.r===r || (r==="mentee"&&a.dataset.r==="mentees")));
  $("app").classList.toggle("compact", r==="review");
  const main=$("main"); main.scrollTop=0;
  (ROUTES[r]||ROUTES.today)(main, arg);
  counts();
}
window.addEventListener("hashchange", route);

function counts(){
  const ms = mine();
  $("ct-mentees").textContent = ms.length;
  const rv = VIDEOS.filter(v=>v.status!=="sent" && (menteeById(v.mentee).mentor===ME)).length;
  $("ct-review").textContent = rv || ""; $("ct-review").classList.toggle("hidden", !rv);
  const un = ms.reduce((n,m)=>n+m.unread,0);
  $("ct-msg").textContent = un || ""; $("ct-msg").classList.toggle("hidden", !un);
  const ua = MENTEES.filter(m=>!m.mentor).length;
  $("ct-alloc").textContent = ua || ""; $("ct-alloc").classList.toggle("hidden", !ua);
  $("ct-content").textContent = CONTENT_REQUESTS.length;
  $("nav-admin").classList.toggle("hidden", !isAdmin());
  $("rolepill").className = "rolepill " + (isAdmin()?"admin":"coach");
  $("rolepill").textContent = isAdmin()?"Admin":"Coach";
  $("roletext").textContent = isAdmin()?"sees everything":"sees own mentees only";
}
$("as").onchange = () => { ME = $("as").value; route(); toast(isAdmin()?"Admin view: every mentor, plus admin pages":"Coach view: only "+MENTORS[ME].short+"'s mentees, no admin pages"); };

// ---------------- TODAY ----------------
ROUTES.today = (el) => {
  const ms = mine();
  const today = BOOKINGS.filter(b=>b.mentor===ME && b.day===0).sort((a,b)=>a.start-b.start);
  const todo = [];
  VIDEOS.filter(v=>v.status!=="sent" && menteeById(v.mentee).mentor===ME).forEach(v=>{const m=menteeById(v.mentee);todo.push({ic:"▶",bg:"var(--warn-soft)",fg:"var(--warn)",t:`Review ${m.name.split(" ")[0]}'s video`,s:`${esc(v.title)} · sent ${v.sent}${v.status==="draft"?" · draft started":""}`,go:`review/${v.id}`,m})});
  if(typeof GUIDES!=="undefined") GUIDES.filter(g=>g.status==="submitted"&&ms.some(m=>m.id===g.owner)).forEach(g=>{const m=menteeById(g.owner);todo.push({ic:"☷",bg:"#efeafc",fg:"#6a3fd6",t:`Review ${m.name.split(" ")[0]}'s lesson guide`,s:`${esc(g.title)} · sent ${g.sent}`,go:`mentee/${m.id}/guides`,m})});
  ms.filter(m=>m.unread).forEach(m=>todo.push({ic:"✉",bg:"var(--accent-soft)",fg:"#1d5fa3",t:`Reply to ${m.name.split(" ")[0]}`,s:`${m.unread} unread`,go:`messages/${m.id}`,m}));
  ms.filter(m=>!m.path.some(p=>p.status==="now")).forEach(m=>todo.push({ic:"☰",bg:"var(--rule2)",fg:"var(--muted)",t:`Set ${m.name.split(" ")[0]}'s next focus`,s:"Nothing assigned this week",go:`mentee/${m.id}/path`,m}));
  ms.filter(m=>!nextCall(m)&&!m.stage).forEach(m=>todo.push({ic:"▦",bg:"var(--warn-soft)",fg:"var(--warn)",t:`${m.name.split(" ")[0]} hasn't booked a call`,s:"Send a nudge or book for them",go:`mentee/${m.id}`,m}));
  ms.filter(m=>m.pay==="failed").forEach(m=>todo.push({ic:"€",bg:"var(--bad-soft)",fg:"var(--bad)",t:`${m.name.split(" ")[0]}'s payment failed`,s:"Stripe is retrying. Nothing for you to do unless they ask.",go:`mentee/${m.id}`,m}));
  (window.TODO_HOOKS||[]).forEach((f)=>f(todo, ms));
  const done = ms.flatMap(m=>m.path.filter(p=>p.status==="done"&&p.reflection).map(p=>({m,p}))).slice(0,3);
  el.innerHTML = `<div class="page">
    <div class="ph"><div><div class="eyebrow">${TODAY_LABEL}</div><h1>Morning, ${esc(MENTORS[ME].short)}</h1><p>${today.length} call${today.length===1?"":"s"} today · ${todo.length} thing${todo.length===1?"":"s"} to do · ${ms.length} of ${MENTORS[ME].cap} places filled</p></div>
      <div class="row"><button class="btn" onclick="go('calendar')">▦ Availability</button><button class="btn pri" onclick="go('review')">▶ Open review studio</button></div></div>
    <div class="grid g2">
      <div class="stack" style="gap:16px">
        <div class="card"><div class="pad" style="padding-bottom:6px"><h2 class="sec">To do</h2></div>
          ${todo.length?todo.map(x=>`<div class="todo" onclick="go('${x.go}')"><span class="ic" style="background:${x.bg};color:${x.fg}">${x.ic}</span><div><b>${esc(x.t)}</b><div class="small muted">${x.s}</div></div><span class="row">${av(x.m,24)}<span class="muted">›</span></span></div>`).join(""):`<div class="empty">All clear. Nice work.</div>`}
        </div>
        <div class="card"><div class="pad" style="padding-bottom:6px"><h2 class="sec">What your mentees said</h2></div>
          ${done.length?done.map(({m,p})=>`<div class="todo" onclick="go('mentee/${m.id}/path')">${av(m,28)}<div><b>${esc(m.name.split(" ")[0])} finished “${esc(p.topic)}”</b><div class="small muted">“${esc(p.reflection)}”</div></div><span class="muted">›</span></div>`).join(""):`<div class="empty">Reflections from finished pieces show here.</div>`}
        </div>
      </div>
      <div class="stack" style="gap:16px">
        <div class="card"><div class="pad" style="padding-bottom:6px"><h2 class="sec">Today's calls</h2></div>
          <div class="agenda">${today.length?today.map((b,i)=>{const m=menteeById(b.mentee);return `<div class="slot ${i===0?"now":""}"><div class="tm">${fmt(b.start)}<small>${b.len} min</small></div><div class="row">${av(m,28)}<div><b>${esc(m.name)}</b><div class="small muted">${b.kind==="open"?"Opening call":"Weekly call"} · focus: ${esc((m.path.find(p=>p.status==="now")||{}).topic||"none set")}</div></div></div><div class="row"><button class="btn sm" onclick="go('mentee/${m.id}')">Prep</button><button class="btn sm pri" onclick="toast('Opens the call room (Whereby) in a new tab')">Join</button></div></div>`}).join(""):`<div class="empty">No calls today.</div>`}</div>
        </div>
        <div class="card pad"><h2 class="sec">This cycle</h2>
          <div class="stack">${ms.map(m=>`<div class="row between" style="cursor:pointer" onclick="go('mentee/${m.id}')"><div class="row">${av(m,26)}<div><b style="font-size:13px">${esc(m.name)}</b> <span class="tag ${m.brand}">${m.brand.toUpperCase()}</span><div class="small muted">Cycle ${m.cycle} · week ${m.week} of 4</div></div></div><div class="cyc" style="width:90px">${[1,2,3,4].map(w=>`<span class="${w<m.week?"d":w===m.week?"n":""}"></span>`).join("")}</div></div>`).join("")}</div>
        </div>
      </div>
    </div>
    <p class="small muted" style="margin-top:20px">Shortcuts: <kbd>⌘K</kbd> search · <kbd>g</kbd> then <kbd>t</kbd> today · <kbd>m</kbd> mentees · <kbd>r</kbd> review · <kbd>c</kbd> calendar · <kbd>i</kbd> messages</p>
  </div>`;
};

// ---------------- MENTEES ----------------
let menteeScope = "mine";
ROUTES.mentees = (el) => {
  const list = (isAdmin() && menteeScope==="all") ? MENTEES.filter(m=>m.mentor) : mine();
  el.innerHTML = `<div class="page">
    <div class="ph"><div><h1>${isAdmin()&&menteeScope==="all"?"All mentees":"My mentees"}</h1><p>${list.length} active${isAdmin()&&menteeScope!=="all"?` · ${MENTORS[ME].cap - list.length} places free`:""}</p></div>
      ${isAdmin()?`<div class="seg"><button class="${menteeScope==="mine"?"on":""}" onclick="menteeScope='mine';route()">Mine</button><button class="${menteeScope==="all"?"on":""}" onclick="menteeScope='all';route()">All mentors</button></div>`:""}</div>
    <div class="card"><table><thead><tr><th>Mentee</th><th>Course</th>${isAdmin()&&menteeScope==="all"?"<th>Mentor</th>":""}<th>Cycle</th><th>Next call</th><th>This week's focus</th><th>Needs</th></tr></thead><tbody>
    ${list.map(m=>{const f=flags(m);const now=m.path.find(p=>p.status==="now");return `<tr class="click" onclick="go('mentee/${m.id}')"><td><div class="row">${av(m)}<div><b>${esc(m.name)}</b><div class="small muted">${esc(m.gym)}</div></div></div></td><td><span class="tag ${m.brand}">${m.brand.toUpperCase()}</span></td>${isAdmin()&&menteeScope==="all"?`<td>${esc(MENTORS[m.mentor].short)}</td>`:""}<td><div class="small">${m.cycle} · wk ${m.week}</div><div class="cyc" style="width:70px;margin-top:3px">${[1,2,3,4].map(w=>`<span class="${w<m.week?"d":w===m.week?"n":""}"></span>`).join("")}</div></td><td class="small">${nextCall(m)||'<span class="muted">Not booked</span>'}</td><td class="small">${now?esc(now.topic):'<span class="muted">—</span>'}</td><td><div class="row wrap" style="gap:4px">${f.length?f.map(x=>`<span class="chip ${x[1]}">${x[0]}</span>`).join(""):'<span class="chip good">Up to date</span>'}</div></td></tr>`}).join("")}
    </tbody></table></div></div>`;
};

// ---------------- MENTEE PROFILE ----------------
ROUTES.mentee = (el, id) => {
  const parts = location.hash.slice(1).split("/"); const tab = parts[2] || "overview";
  const m = menteeById(id); if(!m){ go("mentees"); return; }
  if(!isAdmin() && m.mentor!==ME){ el.innerHTML=`<div class="page"><div class="empty">This mentee belongs to another mentor.</div></div>`; return; }
  const now = m.path.find(p=>p.status==="now");
  const T = {overview:"Overview",path:"Learning path",guides:"Lesson guides",reviews:"Video reviews",calls:"Calls",plan:"Development plan",notes:"Private notes"};
  let body = "";
  if(tab==="overview") body = `<div class="grid g2"><div class="stack" style="gap:16px">
      <div class="card pad"><h2 class="sec">Goal</h2><p style="margin:0;font-size:15px">${esc(m.goal||"Set in the opening call")}</p></div>
      <div class="card pad"><div class="row between"><h2 class="sec" style="margin:0">This week's focus</h2><button class="btn sm" onclick="go('mentee/${m.id}/path')">Change</button></div>
        ${now?`<div style="margin-top:10px"><b style="font-size:15px">${esc(now.topic)}</b> <span class="chip">${esc(now.media)}</span><p class="muted" style="margin:6px 0 0">${esc(now.focus)}</p></div>`:`<p class="muted">Nothing set. <a href="#mentee/${m.id}/path">Pick from the topic bank</a></p>`}</div>
      <div class="card pad"><h2 class="sec">Timeline</h2><div class="tl">${(m.events.length?m.events:[["—","Nothing yet"]]).slice().reverse().map(e=>`<div class="ev"><span class="d">${esc(e[0])}</span><span class="dot" style="background:var(--${e[2]==="good"?"good":e[2]==="bad"?"bad":e[2]==="warn"?"warn":"accent"})"></span><span>${esc(e[1])}</span></div>`).join("")}</div></div>
    </div><div class="stack" style="gap:16px">
      <div class="card pad"><h2 class="sec">Quick actions</h2><div class="stack" style="gap:8px">
        <button class="btn" onclick="go('messages/${m.id}')">✉ Message ${esc(m.name.split(" ")[0])}</button>
        <button class="btn" onclick="go('review')">▶ Review a video</button>
        <button class="btn" onclick="go('mentee/${m.id}/path')">☰ Give a topic</button>
        <button class="btn" onclick="toast('Sends ${esc(m.name.split(" ")[0])} a link to book from your open times')">▦ Ask to book a call</button></div></div>
      <div class="card pad"><h2 class="sec">Details</h2><dl class="kv"><dt>Course</dt><dd><span class="tag ${m.brand}">${m.brand.toUpperCase()}</span> Essentials</dd><dt>Gym</dt><dd>${esc(m.gym)}</dd><dt>Joined</dt><dd>${esc(m.joined)}</dd><dt>Mentor</dt><dd>${esc(m.mentor?MENTORS[m.mentor].name:"Not assigned")}</dd><dt>Next call</dt><dd>${nextCall(m)||"Not booked"}</dd><dt>Payment</dt><dd>${m.pay==="paid"?'<span class="chip good">Paid</span>':'<span class="chip bad">Failed · Stripe retrying</span>'}${isAdmin()?"":' <span class="small muted">(admin handles)</span>'}</dd></dl></div>
    </div></div>`;
  if(tab==="path") body = pathTab(m);
  if(tab==="reviews"){ const vs=videosFor(m); body = `<div class="card">${vs.length?`<table><thead><tr><th>Video</th><th>Sent</th><th>Sheet</th><th>Status</th><th></th></tr></thead><tbody>${vs.map(v=>`<tr class="click" onclick="go('review/${v.id}')"><td><b>${esc(v.title)}</b><div class="small muted">“${esc(v.note)}”</div></td><td>${v.sent}</td><td class="small">${SHEETS[v.sheet].short}</td><td>${v.status==="sent"?'<span class="chip good">Sent</span>':v.status==="draft"?'<span class="chip acc">Draft</span>':'<span class="chip warn">To review</span>'}</td><td><button class="btn sm">Open ›</button></td></tr>`).join("")}</tbody></table>`:`<div class="empty">No videos yet.</div>`}</div>`; }
  if(tab==="calls") body = `<div class="card"><table><thead><tr><th>Date</th><th>Call</th><th>Recording</th><th>Notes</th></tr></thead><tbody>
      ${nextCall(m)?`<tr><td>${nextCall(m)}</td><td>Weekly call</td><td><label class="small"><input type="checkbox"> Record</label></td><td class="muted small">Upcoming</td></tr>`:""}
      ${m.id==="sam"?`<tr><td>19 Nov</td><td>Weekly call 1 · 30 min</td><td class="small muted">Not recorded</td><td class="small">Cues getting shorter. New focus: Feedback.</td></tr><tr><td>15 Nov</td><td>Opening call · 58 min</td><td><span class="chip good">Recorded + transcript</span></td><td class="small">Plan drafted from transcript, published 16 Nov.</td></tr>`:`<tr><td colspan="4" class="muted">Past calls show here with notes.</td></tr>`}
    </tbody></table></div>`;
  if(tab==="plan") body = `<div class="card pad"><div class="row between wrap"><h2 class="sec" style="margin:0">Development plan</h2><div class="row"><span class="small muted">${m.planSent?"Published · "+esc(m.name.split(" ")[0])+" can see it":"Not published"}</span><button class="btn sm" onclick="toast('Draft written from the opening call transcript')">✦ Draft from transcript</button></div></div>
      <textarea class="in" id="planbox" style="min-height:320px;margin-top:12px;font-size:14px">${esc(m.plan)}</textarea>
      <div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn pri" onclick="menteeById('${m.id}').plan=$('planbox').value;menteeById('${m.id}').planSent=true;toast('Published. ${esc(m.name.split(" ")[0])} has been told.')">Publish to ${esc(m.name.split(" ")[0])}</button></div></div>`;
  if(tab==="guides"){ const gs=(typeof GUIDES!=="undefined"?GUIDES:[]).filter(g=>g.owner===m.id); body = `<div class="row between" style="margin-bottom:12px"><span class="muted">Plans ${esc(m.name.split(" ")[0])} sends before filming. Not every time: ask when it helps.</span><button class="btn" onclick="toast('${esc(m.name.split(" ")[0])} is asked for a lesson guide before their next video (email + Learn).')">✉ Ask for a lesson guide</button></div>
    <div class="card">${gs.length?`<table><thead><tr><th>Session</th><th>Sent</th><th>Timeline</th><th>Status</th><th></th></tr></thead><tbody>${gs.map(g=>`<tr class="click" onclick="openGuideModal('${g.id}',true)"><td><b>${esc(g.title)}</b><div class="small muted">${LG.BRANDS[g.brand].short} · ${g.length} min · ${g.timeline.length} parts</div></td><td>${esc(g.sent||"")}</td><td style="width:260px">${LG.timelineSVG(g)}</td><td>${g.status==="reviewed"?'<span class="chip good">Reviewed</span>':'<span class="chip warn">To review</span>'}</td><td><button class="btn sm">Open ›</button></td></tr>`).join("")}</tbody></table>`:`<div class="empty">No lesson guides yet.</div>`}</div>`; }
  if(tab==="notes") body = `<div class="card pad"><h2 class="sec">Private notes <span class="chip">only mentors and admin see these</span></h2><textarea class="in" style="min-height:200px" oninput="menteeById('${m.id}').notes=this.value">${esc(m.notes)}</textarea></div>`;
  el.innerHTML = `<div class="page">
    <div class="small"><a href="#mentees" style="color:var(--muted);text-decoration:none">‹ ${isAdmin()&&m.mentor!==ME?"All mentees":"My mentees"}</a></div>
    <div class="prof-h" style="margin-top:10px">${av(m)}<div style="flex:1"><h1 style="margin:0;font-size:24px">${esc(m.name)} <span class="tag ${m.brand}" style="vertical-align:4px">${m.brand.toUpperCase()}</span></h1><div class="muted">${esc(m.gym)} · cycle ${m.cycle}, week ${m.week} of 4 · next call ${nextCall(m)||"not booked"}</div></div>
      <div class="row wrap">${flags(m).map(x=>`<span class="chip ${x[1]}">${x[0]}</span>`).join("")}</div></div>
    <div class="tabs">${Object.entries(T).map(([k,v])=>`<button class="${k===tab?"on":""}" onclick="go('mentee/${m.id}/${k}')">${v}</button>`).join("")}</div>
    ${body}</div>`;
};

function pathTab(m){
  const order={now:0,next:1,done:2};
  const list=m.path.map((p,i)=>({...p,i})).sort((a,b)=>order[a.status]-order[b.status]);
  return `<div class="grid g2"><div class="card">
    <div class="pad" style="padding-bottom:4px"><h2 class="sec">${esc(m.name.split(" ")[0])}'s path</h2></div>
    ${list.length?list.map(p=>`<div class="todo" style="grid-template-columns:70px 1fr auto;cursor:default"><span class="chip ${p.status==="now"?"acc":p.status==="done"?"good":"warn"}">${p.status==="now"?"Now":p.status==="next"?"Up next":"Done"}</span><div><b>${esc(p.topic)}</b> <span class="small muted">· ${esc(p.media)} · ${esc(BANK[p.bank].label)}${p.date?" · "+esc(p.date):""}</span><div class="small muted">Focus: ${esc(p.focus)}</div>${p.reflection?`<div class="small" style="color:var(--good)">${esc(m.name.split(" ")[0])} wrote: “${esc(p.reflection)}”</div>`:""}</div>
      <div class="row">${p.status==="next"?`<button class="btn sm" onclick="giveNow('${m.id}',${p.i})">Give now</button>`:""}${p.status!=="done"?`<button class="btn sm ghost" onclick="menteeById('${m.id}').path.splice(${p.i},1);route()">✕</button>`:""}</div></div>`).join(""):`<div class="empty">Nothing given yet.</div>`}
  </div><div class="card pad"><h2 class="sec">Give a topic</h2><p class="small muted" style="margin-top:0">Pick from the topic bank. Any tab works on any pathway.</p>
    <button class="btn pri" onclick="pickFor='${m.id}';go('topics')">Open topic bank for ${esc(m.name.split(" ")[0])} ›</button></div></div>`;
}
function giveNow(mid,i){const m=menteeById(mid);m.path.forEach(p=>{if(p.status==="now")p.status="done"});m.path[i].status="now";m.path[i].date=TODAY_LABEL.slice(4);route();toast("Given. "+m.name.split(" ")[0]+" has been told.")}

// ---------------- CALENDAR + AVAILABILITY ----------------
const SLOT0 = 6*60, SLOTS = 30; // 06:00 to 21:00, 30-min slots
const AVAIL = {};
function defaultAvail(){const s=new Set();for(let d=0;d<5;d++){[[7,9],[12,13],[18,20]].forEach(([a,b])=>{for(let t=a*60;t<b*60;t+=30)s.add(d+"-"+(t-SLOT0)/30)})}return s}
Object.keys(MENTORS).forEach(k=>AVAIL[k]=defaultAvail());
const BLOCKED = {nathan:new Set([5,6])};
const CALSET = {wk:30, open:60, buffer:10, notice:12, maxday:4};
let calMentor = null, paintMode = null, calWeek = 0;
ROUTES.calendar = (el) => {
  const who = (isAdmin() && calMentor) || ME;
  const av_ = AVAIL[who], blk = BLOCKED[who] || (BLOCKED[who]=new Set());
  const bks = BOOKINGS.filter(b=>b.mentor===who);
  const hours = av_.size/2;
  let grid = `<div class="hd"></div>` + DAYS.map((d,i)=>`<div class="hd ${i===0&&calWeek===0?"today":""}" style="cursor:pointer" title="Click to block or unblock the whole day" data-blockday="${i}">${d}<small>${DATES[i]+calWeek*7>30?(DATES[i]+calWeek*7-30)+" Dec":(DATES[i]+calWeek*7)+" Nov"}${blk.has(i)?" · off":""}</small></div>`).join("");
  for(let s=0;s<SLOTS;s++){
    const t=SLOT0+s*30;
    grid += `<div class="t">${t%60===0?fmt(t):""}</div>`;
    for(let d=0;d<7;d++){
      const k=d+"-"+s; const on=av_.has(k)&&!blk.has(d); const top=on&&!av_.has(d+"-"+(s-1));
      const evs = calWeek===0 ? bks.filter(b=>b.day===d&&b.start===t) : [];
      grid += `<div class="c ${t%60===0?"hr":""} ${on?"av":""} ${top?"top":""} ${blk.has(d)?"blk":""}" data-k="${k}">${evs.map(b=>{const m=menteeById(b.mentee);return `<div class="ev ${b.kind}" style="top:1px;height:${b.len/30*18-2}px" onclick="event.stopPropagation();go('mentee/${m.id}')">${fmt(b.start)} ${esc(m.name.split(" ")[0])}</div>`}).join("")}</div>`;
    }
  }
  // what a mentee would be offered
  const offers=[]; for(let d=0;d<7&&offers.length<8;d++){ if(blk.has(d))continue; for(let s=0;s<SLOTS&&offers.length<8;s++){ const t=SLOT0+s*30; if(!av_.has(d+"-"+s))continue; if(calWeek===0&&d===0&&t<18*60)continue; if(bks.some(b=>b.day===d&&Math.abs(b.start-t)<30+CALSET.buffer))continue; offers.push(`${DAYS[d]} ${fmt(t)}`);} }
  el.innerHTML = `<div class="page">
    <div class="ph"><div><h1>Calendar &amp; availability</h1><p>Drag across the grid to paint the times mentees can book. Drag over painted times to clear them. Click a day name to take the whole day off.</p></div>
      <div class="row wrap">${isAdmin()?`<select class="in" style="width:auto" onchange="calMentor=this.value;route()">${Object.entries(MENTORS).map(([k,v])=>`<option value="${k}" ${k===who?"selected":""}>${v.name}${k===ME?" (me)":""}</option>`).join("")}</select>`:""}
      <div class="seg"><button onclick="calWeek=Math.max(0,calWeek-1);route()">‹</button><button class="on">${calWeek===0?"This week":"+"+calWeek+" wk"}</button><button onclick="calWeek++;route()">›</button></div></div></div>
    <div class="cal-wrap">
      <div class="card"><div class="pad row between wrap" style="padding:10px 14px;border-bottom:1px solid var(--rule)"><div class="legend"><span><i style="background:#e7f1fb;border:1px solid #9cc4ec"></i>Open to book</span><span><i style="background:var(--accent)"></i>Weekly call</span><span><i style="background:var(--good)"></i>Opening call</span><span><i style="background:#ebe8e2"></i>Day off</span></div><span class="small muted">${hours} h open a week · ${bks.length} booked</span></div>
        <div class="calscroll"><div class="cal" id="cal">${grid}</div></div></div>
      <div class="stack" style="gap:16px">
        <div class="card pad"><h2 class="sec">Booking rules${isAdmin()&&who!==ME?" · "+esc(MENTORS[who].short):""}</h2>
          <div class="stack" style="gap:10px">
            <label class="row between"><span>Weekly call</span><select class="in" style="width:110px" onchange="CALSET.wk=+this.value"><option ${CALSET.wk===30?"selected":""} value="30">30 min</option><option value="45">45 min</option></select></label>
            <label class="row between"><span>Opening call</span><select class="in" style="width:110px"><option>60 min</option><option>45 min</option></select></label>
            <label class="row between"><span>Gap between calls</span><select class="in" style="width:110px" onchange="CALSET.buffer=+this.value;route()">${[0,10,15].map(v=>`<option value="${v}" ${CALSET.buffer===v?"selected":""}>${v} min</option>`).join("")}</select></label>
            <label class="row between"><span>Least notice</span><select class="in" style="width:110px"><option>12 hours</option><option>24 hours</option><option>48 hours</option></select></label>
            <label class="row between"><span>Most calls a day</span><select class="in" style="width:110px"><option>3</option><option selected>4</option><option>6</option></select></label>
            <label class="row between"><span>Time zone</span><span class="small muted">Europe/Dublin · mentees see their own</span></label>
            <label class="row" style="gap:8px"><input type="checkbox" checked> <span>Hide times I'm busy in Google Calendar</span></label>
          </div></div>
        <div class="card pad"><h2 class="sec">What a mentee sees</h2><p class="small muted" style="margin-top:0">Next open 30-minute slots, in their time zone:</p>
          <div class="bookprev">${offers.length?offers.map(o=>`<button onclick="toast('Mentee view: booking ${o}')">${o}</button>`).join(""):'<span class="small muted">No open times. Paint some on the grid.</span>'}</div></div>
      </div>
    </div></div>`;
  // painting
  const cal=$("cal");
  // drag paints the whole rectangle from where you pressed to where you are
  let anchor=null;
  const cellAt=(k)=>cal.querySelector(`[data-k="${k}"]`);
  const fillRect=(k)=>{const [d0,s0]=anchor.split("-").map(Number),[d1,s1]=k.split("-").map(Number);
    for(let d=Math.min(d0,d1);d<=Math.max(d0,d1);d++)for(let s=Math.min(s0,s1);s<=Math.max(s0,s1);s++){const kk=d+"-"+s;if(paintMode==="add")av_.add(kk);else av_.delete(kk);const c=cellAt(kk);if(c)c.classList.toggle("av",paintMode==="add")}};
  cal.addEventListener("mousedown",(e)=>{const c=e.target.closest(".c");if(!c||e.target.closest(".ev"))return;anchor=c.dataset.k;paintMode=av_.has(anchor)?"del":"add";fillRect(anchor);e.preventDefault()});
  cal.addEventListener("mousemove",(e)=>{if(!paintMode||!anchor)return;const c=e.target.closest(".c");if(c&&c.dataset.k)fillRect(c.dataset.k)});
  cal.querySelectorAll("[data-blockday]").forEach(h=>h.onclick=()=>{const d=+h.dataset.blockday;blk.has(d)?blk.delete(d):blk.add(d);route()});
};
window.addEventListener("mouseup",()=>{if(paintMode){paintMode=null;if(location.hash.startsWith("#calendar"))route()}});

// ---------------- MESSAGES ----------------
ROUTES.messages = (el, id) => {
  const ms = isAdmin()&&menteeScope==="all" ? MENTEES.filter(m=>m.mentor) : mine();
  const cur = menteeById(id) || ms[0];
  if(cur) cur.unread = 0;
  const th = cur ? (THREADS[cur.id]||(THREADS[cur.id]=[])) : [];
  el.innerHTML = `<div class="page"><div class="ph"><div><h1>Messages</h1><p>One thread per mentee. They message from their Mentorship tab.</p></div></div>
    <div class="card msgs"><div class="threads">${ms.map(m=>{const t=THREADS[m.id]||[];const last=t[t.length-1];return `<div class="thread ${cur&&m.id===cur.id?"on":""}" onclick="go('messages/${m.id}')">${av(m,30)}<div style="min-width:0;flex:1"><div class="row between"><b style="font-size:13px">${esc(m.name)}</b>${m.unread?`<span class="chip warn">${m.unread}</span>`:`<span class="small muted">${last?last.t:""}</span>`}</div><div class="pv">${last?esc(last.text):"No messages yet"}</div></div></div>`}).join("")}</div>
      <div class="conv">${cur?`<div class="pad row between" style="border-bottom:1px solid var(--rule);padding:10px 16px"><div class="row">${av(cur,28)}<b>${esc(cur.name)}</b> <span class="tag ${cur.brand}">${cur.brand.toUpperCase()}</span></div><button class="btn sm" onclick="go('mentee/${cur.id}')">Profile ›</button></div>
        <div class="bubbles" id="bubs">${th.map(x=>`<div class="bub ${x.who===cur.id?"th":"me"}"><small>${esc(x.who===cur.id?cur.name.split(" ")[0]:MENTORS[x.who]?.short||x.who)} · ${esc(x.t)}</small>${esc(x.text)}</div>`).join("")||'<div class="empty">Say hello.</div>'}</div>
        <div class="composer"><button class="btn" title="Attach a file" onclick="toast('Attach a file or a topic from the bank')">＋</button><input class="in" id="msgin" placeholder="Reply to ${esc(cur.name.split(" ")[0])}… (Enter to send)"><button class="btn pri" id="msggo">Send</button></div>`:`<div class="empty">No mentees yet.</div>`}</div></div></div>`;
  if(cur){ const b=$("bubs"); b.scrollTop=1e6;
    const send=()=>{const v=$("msgin").value.trim();if(!v)return;th.push({who:ME,t:"now",text:v});route();setTimeout(()=>$("msgin").focus(),0)};
    $("msggo").onclick=send; $("msgin").onkeydown=(e)=>{if(e.key==="Enter")send()}; $("msgin").focus(); }
  counts();
};

// ---------------- TOPIC BANK ----------------
let bkTab="tcc", bkQ="", pickFor=null, bkOpen=null;
ROUTES.topics = (el) => {
  const ms = mine();
  const bank=BANK[bkTab]; const q=bkQ.toLowerCase();
  const rows=bank.rows.filter(r=>!q||(r[0]+" "+r[1]+" "+(r[2]||"")).toLowerCase().includes(q));
  const target = menteeById(pickFor);
  el.innerHTML = `<div class="page">
    <div class="ph"><div><h1>Topic bank</h1><p>${Object.values(BANK).reduce((n,b)=>n+b.rows.length,0)} topics. Held separately per course, usable on any pathway.</p></div>
      <div class="row"><span class="small muted">Giving to</span><select class="in" style="width:auto" onchange="pickFor=this.value||null;route()"><option value="">Choose a mentee…</option>${ms.map(m=>`<option value="${m.id}" ${m.id===pickFor?"selected":""}>${esc(m.name)}</option>`).join("")}</select></div></div>
    <div class="row between wrap" style="margin-bottom:12px"><div class="bk-tabs">${Object.entries(BANK).map(([k,b])=>`<button class="${k===bkTab?"on":""}" onclick="bkTab='${k}';bkOpen=null;route()">${b.label} (${b.rows.length})</button>`).join("")}</div>
      <input class="in" id="bkq" style="max-width:320px" placeholder="Search… e.g. feedback, kip, cue" value="${esc(bkQ)}"></div>
    <div class="card">${rows.map(r=>{const made=madeFor(bkTab,r[0]);const k=bkTab+"|"+r[0];const st=target&&target.path.find(p=>p.bank===bkTab&&p.topic===r[0]);return `<div class="trow" style="${bkOpen===k?"background:var(--accent-soft)":""}"><div><b>${esc(r[0])}</b>${st?` <span class="chip ${st.status==="done"?"good":"acc"}">${st.status==="done"?"Done":st.status==="now"?"Now":"Up next"} with ${esc(target.name.split(" ")[0])}</span>`:""}<div class="tc">${esc(r[1])}${r[2]?" · "+esc(r[2]):""}</div></div>
      <div class="mdots" title="${made.length} of 8 media made">${MEDIA.map(x=>`<i class="${made.includes(x)?"y":""}" title="${x}"></i>`).join("")}</div>
      <button class="btn sm" onclick="bkOpen=bkOpen==='${esc(k).replace(/'/g,"\\'")}'?null:'${esc(k).replace(/'/g,"\\'")}';route()">Give ›</button>
      ${bkOpen===k?`<div style="grid-column:1/-1;display:grid;grid-template-columns:200px 200px 1fr auto;gap:8px;margin-top:8px">
        <select class="in" id="g-who">${ms.map(m=>`<option value="${m.id}" ${m.id===pickFor?"selected":""}>${esc(m.name)}</option>`).join("")}</select>
        <select class="in" id="g-media">${MEDIA.map(x=>`<option ${made.includes(x)?"":"disabled"}>${x}${made.includes(x)?"":" · not made"}</option>`).join("")}</select>
        <input class="in" id="g-focus" placeholder="Focus for this week">
        <div class="row"><button class="btn pri" id="g-now">Give now</button><button class="btn" id="g-next">Up next</button></div></div>`:""}</div>`}).join("")||'<div class="empty">No topics match.</div>'}</div></div>`;
  const qi=$("bkq"); qi.oninput=()=>{bkQ=qi.value;const p=qi.selectionStart;route();const n=$("bkq");n.focus();n.setSelectionRange(p,p)};
  if(bkOpen){ const topic=bkOpen.split("|")[1];
    const add=(status)=>{const m=menteeById($("g-who").value);const media=$("g-media").value;const f=$("g-focus").value.trim();if(!f){toast("Add the focus for this week");return}
      if(status==="now")m.path.forEach(p=>{if(p.status==="now")p.status="done"});
      m.path.push({bank:bkTab,topic,media,focus:f,status,date:status==="now"?TODAY_LABEL.slice(4):""});bkOpen=null;route();toast(status==="now"?`Given to ${m.name.split(" ")[0]}. They've been told.`:`Added to ${m.name.split(" ")[0]}'s Up next`)};
    $("g-now").onclick=()=>add("now"); $("g-next").onclick=()=>add("next"); }
};

// ---------------- ADMIN ----------------
const adminHead = (t,p,right="") => `<div class="ph"><div><span class="admintag">⚙ Admin only</span><h1 style="margin-top:6px">${t}</h1><p>${p}</p></div>${right}</div>`;
ROUTES["a-overview"] = (el) => {
  const act=MENTEES.filter(m=>m.mentor); const rev=act.reduce((n,m)=>n+PRICE[m.brand].gross,0); const net=act.reduce((n,m)=>n+PRICE[m.brand].net,0);
  el.innerHTML = `<div class="page">${adminHead("Overview","Every mentor and mentee in one place.")}
    <div class="grid g4" style="margin-bottom:16px">
      <div class="card tile"><b>${act.length}</b><span>Active mentees · goal 50</span><div class="bar" style="margin-top:6px"><i style="width:${act.length/50*100}%"></i></div></div>
      <div class="card tile ${MENTEES.some(m=>!m.mentor)?"warn":""}" style="cursor:pointer" onclick="go('a-allocate')"><b>${MENTEES.filter(m=>!m.mentor).length}</b><span>Waiting for a mentor ›</span></div>
      <div class="card tile"><b>€${rev.toLocaleString()}</b><span>Per 4-week cycle (VAT incl.)</span></div>
      <div class="card tile ${act.some(m=>m.pay==="failed")?"warn":""}"><b>${act.filter(m=>m.pay==="failed").length}</b><span>Failed payments</span></div></div>
    <div class="card"><div class="pad" style="padding-bottom:4px"><h2 class="sec">Mentors</h2></div><table><thead><tr><th>Mentor</th><th>Courses</th><th>Places</th><th>Calls this week</th><th>Videos waiting</th><th>Unread</th></tr></thead><tbody>
    ${Object.entries(MENTORS).map(([k,v])=>{const ms=MENTEES.filter(m=>m.mentor===k);const vw=VIDEOS.filter(x=>x.status!=="sent"&&menteeById(x.mentee).mentor===k).length;return `<tr><td><b>${esc(v.name)}</b></td><td>${v.courses.map(c=>`<span class="tag ${c}">${c.toUpperCase()}</span>`).join(" ")}</td><td><div class="row"><div class="bar" style="width:80px"><i style="width:${ms.length/v.cap*100}%"></i></div><span class="small">${ms.length}/${v.cap}</span></div></td><td>${BOOKINGS.filter(b=>b.mentor===k).length}</td><td>${vw?`<span class="chip warn">${vw}</span>`:"0"}</td><td>${ms.reduce((n,m)=>n+m.unread,0)}</td></tr>`}).join("")}
    </tbody></table></div>
    <p class="small muted">After 23% VAT and Stripe fees this cycle: €${net.toFixed(2)} to share · mentors €${(net*.7).toFixed(2)} · BirdBox €${(net*.3).toFixed(2)}</p></div>`;
};
ROUTES["a-allocate"] = (el) => {
  const wait=MENTEES.filter(m=>!m.mentor);
  const suggest=(m)=>Object.entries(MENTORS).filter(([k,v])=>v.courses.includes(m.brand)).map(([k,v])=>({k,free:v.cap-MENTEES.filter(x=>x.mentor===k).length})).filter(x=>x.free>0).sort((a,b)=>b.free-a.free)[0];
  el.innerHTML = `<div class="page">${adminHead("Allocate mentees","New mentees appear here as soon as they pay. Suggested mentor = covers that course and has the most free places.")}
    ${wait.length?`<div class="grid g2">${wait.map(m=>{const s=suggest(m);return `<div class="card pad"><div class="row between"><div class="row">${av(m)}<div><b style="font-size:15px">${esc(m.name)}</b> <span class="tag ${m.brand}">${m.brand.toUpperCase()}</span><div class="small muted">${esc(m.gym)} · paid ${esc(m.joined)}</div></div></div></div>
      <div style="margin:12px 0">${m.level1?`<span class="chip good">✓ ${esc(m.level1)}</span>`:`<span class="chip warn">Level 1 to check</span> <span class="small muted">${esc(m.level1Note)}</span>`}</div>
      <div class="row"><select class="in" id="al-${m.id}">${Object.entries(MENTORS).filter(([k,v])=>v.courses.includes(m.brand)).map(([k,v])=>{const f=v.cap-MENTEES.filter(x=>x.mentor===k).length;return `<option value="${k}" ${s&&s.k===k?"selected":""} ${f<=0?"disabled":""}>${v.name} · ${f} free${s&&s.k===k?" (suggested)":""}</option>`}).join("")}</select><button class="btn adm" onclick="assign('${m.id}')">Assign</button></div></div>`}).join("")}</div>`:`<div class="card empty">Everyone has a mentor.</div>`}</div>`;
};
function assign(id){const m=menteeById(id);const k=$("al-"+id).value;m.mentor=k;m.events.push(["today","Assigned to "+MENTORS[k].name,"acc"]);route();toast(`${m.name} assigned to ${MENTORS[k].name}. Both have been emailed, and ${m.name.split(" ")[0]} can book their opening call.`)}
ROUTES["a-mentors"] = (el) => {
  el.innerHTML = `<div class="page">${adminHead("Mentors","Who mentors which course, and how many places each has.",`<button class="btn adm" onclick="toast('Add a staff member as a mentor')">＋ Add mentor</button>`)}
    <div class="card"><table><thead><tr><th>Mentor</th><th>TCC</th><th>TGC</th><th>Places</th><th>Role</th></tr></thead><tbody>
    ${Object.entries(MENTORS).map(([k,v])=>`<tr><td><b>${esc(v.name)}</b></td>${["tcc","tgc"].map(c=>`<td><input type="checkbox" ${v.courses.includes(c)?"checked":""} onchange="MENTORS['${k}'].courses=this.checked?[...MENTORS['${k}'].courses,'${c}']:MENTORS['${k}'].courses.filter(x=>x!=='${c}')"></td>`).join("")}<td><select class="in" style="width:80px" onchange="MENTORS['${k}'].cap=+this.value">${[3,4,5,6].map(n=>`<option ${n===v.cap?"selected":""}>${n}</option>`).join("")}</select></td><td>${v.admin?'<span class="rolepill admin">Admin</span>':'<span class="chip">Coach</span>'}</td></tr>`).join("")}
    </tbody></table></div></div>`;
};
ROUTES["a-payouts"] = (el) => {
  const rows=Object.entries(MENTORS).map(([k,v])=>{const ms=MENTEES.filter(m=>m.mentor===k);const g=ms.reduce((n,m)=>n+PRICE[m.brand].gross,0),nt=ms.reduce((n,m)=>n+PRICE[m.brand].net,0);return {v,ms,g,nt}}).filter(r=>r.ms.length);
  el.innerHTML = `<div class="page">${adminHead("Payouts","Per 4-week cycle. Mentor gets 70% of what's left after VAT and Stripe fees.",`<button class="btn" onclick="toast('CSV downloaded (test)')">⤓ Export CSV</button>`)}
    <div class="card"><table><thead><tr><th>Mentor</th><th>Mentees</th><th>Paid by mentees</th><th>After VAT + fees</th><th>Mentor 70%</th><th>BirdBox 30%</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td><b>${esc(r.v.name)}</b></td><td class="small">${r.ms.map(m=>esc(m.name.split(" ")[0])+" ("+m.brand.toUpperCase()+")").join(", ")}</td><td>€${r.g.toFixed(2)}</td><td>€${r.nt.toFixed(2)}</td><td><b>€${(r.nt*.7).toFixed(2)}</b></td><td>€${(r.nt*.3).toFixed(2)}</td></tr>`).join("")}
    </tbody></table></div></div>`;
};
ROUTES["a-content"] = (el) => {
  el.innerHTML = `<div class="page">${adminHead("Content requests","Pieces mentors asked for that aren't made yet. Most wanted first: this is the order to build the bank.")}
    <div class="card"><table><thead><tr><th>Topic</th><th>Piece wanted</th><th>Asked by</th><th>Count</th><th></th></tr></thead><tbody>
    ${CONTENT_REQUESTS.slice().sort((a,b)=>b.count-a.count).map((c,i)=>`<tr><td><b>${esc(c.topic)}</b> <span class="small muted">· ${BANK[c.bank].label}</span></td><td>${esc(c.media)}</td><td class="small">${c.by.join(", ")}</td><td><span class="chip ${c.count>1?"warn":""}">${c.count}</span></td><td><button class="btn sm" onclick="toast('Marked as made. Mentors who asked are told.')">Mark made</button></td></tr>`).join("")}
    </tbody></table></div></div>`;
};

// ---------------- command palette + keys ----------------
let palSel=0, palItems=[];
function openPal(){ $("pal").classList.remove("hidden"); $("pal-in").value=""; palRender(); $("pal-in").focus(); }
function closePal(){ $("pal").classList.add("hidden"); }
function palRender(){
  const q=$("pal-in").value.toLowerCase();
  const pages=[["Today","today"],["My mentees","mentees"],["Review studio","review"],["Calendar & availability","calendar"],["Messages","messages"],["Topic bank","topics"],...(isAdmin()?[["Admin: Overview","a-overview"],["Admin: New mentees","a-allocate"],["Admin: Mentors","a-mentors"],["Admin: Payouts","a-payouts"],["Admin: Content requests","a-content"]]:[])];
  const ms=(isAdmin()?MENTEES.filter(m=>m.mentor):mine()).map(m=>[m.name,"mentee/"+m.id,"Mentee"]);
  const tp=Object.entries(BANK).flatMap(([k,b])=>b.rows.map(r=>[r[0],"topics",b.label,k]));
  palItems=[...ms,...pages.map(p=>[p[0],p[1],"Page"]),...tp].filter(x=>!q||x[0].toLowerCase().includes(q)).slice(0,12);
  palSel=Math.min(palSel,palItems.length-1); if(palSel<0)palSel=0;
  $("pal-res").innerHTML=palItems.map((x,i)=>`<div class="it ${i===palSel?"sel":""}" data-i="${i}">${esc(x[0])}<small>${esc(x[2])}</small></div>`).join("")||'<div class="it muted">Nothing found</div>';
  $("pal-res").querySelectorAll("[data-i]").forEach(d=>d.onclick=()=>palGo(+d.dataset.i));
}
function palGo(i){const x=palItems[i];if(!x)return;closePal();if(x[3]){bkTab=x[3];bkQ=x[0]}go(x[1])}
$("open-pal").onclick=openPal;
$("pal").onclick=(e)=>{if(e.target.id==="pal")closePal()};
$("pal-in").oninput=()=>{palSel=0;palRender()};
$("pal-in").onkeydown=(e)=>{if(e.key==="ArrowDown"){palSel++;palRender();e.preventDefault()}if(e.key==="ArrowUp"){palSel=Math.max(0,palSel-1);palRender();e.preventDefault()}if(e.key==="Enter")palGo(palSel);if(e.key==="Escape")closePal()};
let gPending=false;
document.addEventListener("keydown",(e)=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openPal();return}
  const typing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName); if(typing)return;
  if(location.hash.startsWith("#review") && window.studioKey && window.studioKey(e)) return;
  if(e.key==="g"){gPending=true;setTimeout(()=>gPending=false,900);return}
  if(gPending){const map={t:"today",m:"mentees",r:"review",c:"calendar",i:"messages",b:"topics"};if(map[e.key]){go(map[e.key]);gPending=false}}
});

// Starts once gate.js says an admin is signed in. The signed-in person picks the starting "view as".
window.addEventListener("mentor-ready", (e) => {
  const n = String(e.detail?.full_name || "").toLowerCase();
  ME = n.startsWith("michaela") ? "michaela" : n.startsWith("barney") ? "barney" : "nathan";
  MENTORS.barney.admin = true; // Barney is on the build team, so he sees the admin pages too
  $("as").querySelector('option[value="barney"]').textContent = "Barney · build team";
  $("as").value = ME;
  route();
});
// Programming portal: same one-time sign-in handover the portal menu uses.
document.getElementById("to-train").addEventListener("click", (e) => { e.preventDefault(); import("/portal/switch.js").then((m) => m.openTrain(e.currentTarget)); });
