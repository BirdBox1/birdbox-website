// One-page lesson guide (from TCC Level 2, "Implementing interventions in a class environment"), made digital.
// Shared by the coach's page (lesson-guide.html) and the mentor portal (studio, mentee profile, feedback).
// The movement library and session templates are kept separate so TCC box programming can reuse them later.
(function(){
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ROOT = (document.currentScript && document.currentScript.src.replace(/[^/]*$/,"")) || "";

// ---------- brands ----------
const BRANDS = {
  tcc:{name:"The Coaches Course", short:"TCC", logo:"../brand/tcc-mark.png", accent:"#298DE9"},
  tgc:{name:"The Gymnastics Course", short:"TGC", logo:"../brand/tgc-mark.png", accent:"#E0555A"},
  birdbox:{name:"BirdBox Coaching", short:"BirdBox", logo:"../brand/birdbox-mark.png", accent:"#2f7fd0"},
};
const STYLES = {auto:{name:"Autocratic",col:"#14b8a6"}, demo:{name:"Democratic",col:"#e8505b"}, alt:{name:"Alternative",col:"#f2b50f"}};

// ---------- starter library (STARTER SUGGESTIONS: wording to be checked by Nathan) ----------
// Squat, thruster and pull-up entries come from the TCC Level 2 example guides.
const MOVES = {
  "Back squat":   {areas:["Lumbar spine","Knee","Ankle","Hips","Thoracic spine"], pre:["Hips","Posterior chain/hamstrings","Ankle","T-spine/shoulder"], ex:["Plate split squat or Bulgarian split","RDL or good morning","Eccentric calf raise or seated raise","T-spine loaded extension or KB arm bar"],
                   met:{Contact:"Imagine you are an eagle gripping a branch.",Balance:"Stabilise before squatting as if you were standing on a ship in a storm.",Tension:"Try and twist the floor with your feet while bending the bar down.",Smoothness:"Move with fluidity like water running from a tap."}, scale:"Adapt first by changing the volume and intensity if mastery isn't present."},
  "Front squat":  {areas:["Wrist","Thoracic spine","Knee","Ankle","Lumbar spine"], pre:["Thoracic spine","Wrists/lats","Ankle","Hips"], ex:["Banded lat stretch into front rack hold","T-spine loaded extension or KB arm bar","Eccentric calf raise or seated raise","Goblet squat hold"],
                   met:{Contact:"Imagine you are an eagle gripping a branch.",Stillness:"Elbows high like a shelf the bar rests on."}, scale:"Goblet or dumbbell front squat if the rack position isn't there."},
  "Deadlift":     {areas:["Lumbar spine","Hips","Hamstrings","Knee","Grip"], pre:["Posterior chain/hamstrings","Hips","Thoracic spine","Grip"], ex:["RDL or good morning","Banded hip hinge","Dead bug or bird dog","Farmers hold"],
                   met:{Tension:"Pull the slack out of the bar before it leaves the floor.",Contact:"Push the floor away rather than pulling the bar up."}, scale:"Kettlebell or elevated deadlift to keep a neutral spine."},
  "Thruster":     {areas:["Shoulder/scapular","Wrist","Lumbar spine","Knee","Elbow"], pre:["Shoulder/scapular","Thoracic spine","Elbows","Hips/P-chain"], ex:["Shoulder distraction into wall angels","Loaded arm bar into eccentric plate","Banded supination into PVC rotations","Bulgarian squat or DB RDL"],
                   met:{Contact:"Imagine your knuckles are pointing a laser beam to the sky.",Balance:"Feel your belly button get pulled straight to the floor in your thruster.",Tension:"Corkscrew your feet into the floor during your thruster."}, scale:"Reduce the load, or change to dumbbells or a sled."},
  "Pull-up":      {areas:["Shoulder/scapular","Elbow","Wrist","Lumbar spine"], pre:["Shoulder/scapular","Thoracic spine","Elbows","Lats"], ex:["Shoulder distraction into wall angels","Scapular pull-ups","Banded supination into PVC rotations","Ring rows"],
                   met:{Stillness:"Be stable on the pull-up bar like a tree root rather than a branch in the wind.",Smoothness:"Imagine you are a play swing, one movement from one apex to the other."}, scale:"Mastery of one strict pull-up before kipping. Scale reps, jumping, or a mix of contractions."},
  "Push press":   {areas:["Shoulder/scapular","Lumbar spine","Wrist","Thoracic spine"], pre:["Thoracic spine","Shoulder/scapular","Lats","Hips"], ex:["PVC pass-throughs","Wall angels","Dip and hold with a light bar","Dead bug"],
                   met:{Contact:"Punch the ceiling.",Breath:"Imagine your inner core is a pressure jar, fill and hold it."}, scale:"Dumbbells or lighter load to keep the ribs down."},
  "Clean":        {areas:["Wrist","Lumbar spine","Knee","Shoulder/scapular"], pre:["Wrists/lats","Hips","Thoracic spine","Ankle"], ex:["Front rack stretch","Muscle clean","Hang power clean drill","Goblet squat hold"],
                   met:{Smoothness:"Stay close to the bar like a zip.",Contact:"Jump and catch it on a shelf."}, scale:"Hang or dumbbell clean."},
  "Wall ball":    {areas:["Knee","Shoulder/scapular","Lumbar spine","Ankle"], pre:["Hips","Ankle","Thoracic spine","Shoulder/scapular"], ex:["Goblet squat hold","Wall angels","Eccentric calf raise or seated raise","Med ball front squat"],
                   met:{Smoothness:"Squat and throw in one wave."}, scale:"Lighter ball or lower target."},
  "Toes to bar":  {areas:["Shoulder/scapular","Lumbar spine","Grip","Hip flexors"], pre:["Shoulder/scapular","Lats","Hip flexors","Grip"], ex:["Hollow hold","Active hang","Hanging knee raise","Banded lat stretch"],
                   met:{Stillness:"Be stable on the bar like a tree root rather than a branch in the wind."}, scale:"Knees to chest or V-ups."},
  "Rowing":       {areas:["Lumbar spine","Hips","Knee","Shoulder/scapular"], pre:["Posterior chain/hamstrings","Hips","Thoracic spine","Ankle"], ex:["Banded hip hinge","RDL or good morning","Dead bug","Seated calf raise"],
                   met:{Smoothness:"Legs, body, arms like a wave going out and coming back."}, scale:"Bike or ski."},
  "Running":      {areas:["Knee","Ankle","Hips","Lumbar spine"], pre:["Ankle","Hips","Calves","Posterior chain/hamstrings"], ex:["Eccentric calf raise or seated raise","Glute bridge","Single-leg balance","A-skips"],
                   met:{Balance:"Run tall, as if a string is pulling the top of your head."}, scale:"Shorter distance, row or bike."},
  "Box jump":     {areas:["Knee","Ankle","Achilles","Hips"], pre:["Ankle","Hips","Knee","Calves"], ex:["Squat jump and stick","Eccentric calf raise or seated raise","Step-ups","Single-leg balance"],
                   met:{Contact:"Land quiet like a cat."}, scale:"Step-ups or a lower box."},
};
if(window.LG_LIB){ Object.assign(MOVES, window.LG_LIB.MOVES); }
const AREAS = ["Lumbar spine","Knee","Ankle","Hips","Shoulder/scapular","Thoracic spine","Wrist","Elbow","Hamstrings","Grip","Achilles"];
const METAPHOR_KEYS = ["Contact","Balance","Breath","Stillness","Tension","Smoothness"];
const METAPHOR_STOCK = {Breath:"Imagine your inner core is a pressure jar, fill and hold it.", Stillness:"Before you move, imagine there is a motion sensor watching you.", Balance:"Stabilise before you move, as if you were standing on a ship in a storm.", Contact:"Grip the floor like an eagle gripping a branch.", Tension:"Brace like you are about to be pushed.", Smoothness:"Move with fluidity like water running from a tap."};

// Session templates: the shape of the hour. Reusable for box programming.
const TEMPLATES = {
  strength:{name:"Strength", desc:"Warm-up, assess, interventions, retest, build to the lift", tl:[[0,"Introduction","demo"],[2,"General warm-up (RAMP)","demo"],[7,"Movement variations (visual movement assessment)","auto"],[10,"Interventions NAMSET","auto"],[13,"Interventions","demo"],[20,"Retest","auto"],[22,"Loading","alt"],[30,"WOD","demo"],[52,"Equipment away","demo"],[55,"Cool down","demo"]],
    goal:"Intensity through loading, or if not achievable due to mastery, the volume increase with relative intensity.", approach:"Strength: 5x5 - Rest 3-5 min - approx 85%\nHypertrophy: 7x8 - Rest 90-120 s - approx 70%\nMuscle endurance: 10x15 - Rest 30-60 s - below 50%"},
  metcon:{name:"Metcon", desc:"Warm-up, assess, mobility and stability interventions, scaling, heats", tl:[[0,"Introduction","auto"],[2,"Line drill warm-up","auto"],[7,"Visual movement assessment","auto"],[9,"Mobility interventions","demo"],[14,"Stability interventions","auto"],[20,"Movement mastery","auto"],[22,"Scaling","alt"],[30,"Movement prep","auto"],[35,"Workout flow test","auto"],[37,"Final prep break","demo"],[41,"WOD heat 1","auto"],[46,"WOD heat 2","auto"],[52,"Equipment away","auto"],[55,"Cool down","auto"]],
    goal:"Intensity: keep the intended stimulus with the right scaling for each athlete.", approach:""},
  skill:{name:"Skill + short WOD", desc:"Longer skill block, then a short piece", tl:[[0,"Introduction","demo"],[2,"Warm-up","auto"],[8,"Skill assessment","auto"],[12,"Interventions","demo"],[18,"Skill practice","alt"],[32,"Retest","auto"],[35,"Short WOD","auto"],[50,"Equipment away","demo"],[53,"Cool down","demo"]],
    goal:"Quality of movement: mastery before intensity.", approach:""},
};

if(window.LG_LIB){ Object.assign(TEMPLATES, window.LG_LIB.TEMPLATES_MORE); }
// The coach's own words, written once and copied into every guide.
const PROFILE_DEFAULT = { name:"", brand:"tcc",
  definition:"Facilitate a training programme, including personal interventions for the participants. Aiming to increase the understanding and execution of movements in the best possible way. You will connect with and advance your athlete.",
  philosophy:"" };
const STANDING = {
  blue:"Detailed approach, on sets, reps and mastery requirements. Ensure communication is made before the session.",
  yellow:"Social approach, ensure involvement in a group for interventions, allowing them to be heard at times.",
  red:"Get to the point, have them moving and performing an effective warm-up and interventions. Delegate to them when preparing.",
  green:"Make personal connections before or at the beginning of the session. Understand their motivation for the day and how they are feeling. Coach them accordingly.",
  arousal:"Identify who needs increased pressure and who needs increased support. Placement of athletes in relation to the speakers and others needs to be made.",
  competency:"They must find mastery or have a suitable scale to ensure good movement.",
  autonomy:"Bring them into the decision making process regarding sets, reps and load, or use a guided learner coaching style so you help them maintain autonomy but make the right choice.",
  relatedness:"Ideally everyone will be doing the same movement or a variation, only changing the movement as a last option.",
};
const uidg = () => "g"+Math.random().toString(36).slice(2,8);

// Build a full guide from a few choices (the 3-minute route).
function quickBuild({wod, template, moves, profile, from}){
  const P = profile || PROFILE_DEFAULT, T = TEMPLATES[template] || TEMPLATES.strength;
  // take from each movement in turn, so every movement is represented
  const pick = (key, n) => { const lists=moves.map(m=>MOVES[m]?.[key]||[]); const seen=[]; for(let i=0;i<8&&seen.length<n;i++) lists.forEach(l=>{ if(l[i]&&!seen.includes(l[i])&&seen.length<n) seen.push(l[i]); }); while(seen.length<n) seen.push(""); return seen; };
  const met = METAPHOR_KEYS.map(k=>({k, v: (moves.map(m=>MOVES[m]?.met?.[k]).find(Boolean)) || METAPHOR_STOCK[k] || ""}));
  const g = {
    id:uidg(), title:wod||moves.join(" + ")||"New lesson guide", wod:wod||moves.join(" + "), brand:P.brand||"tcc", coach:P.name||"", date:new Date().toISOString().slice(0,10),
    length:60, status:"draft", template,
    definition:P.definition, philosophy:P.philosophy,
    instr:{skill:moves.join(", "), goal:T.goal, session:"Prevention of injury is key. Find the appropriate scaling for each movement.", approach: T.approach || moves.map(m=>MOVES[m]?.scale?`${m}: ${MOVES[m].scale}`:"").filter(Boolean).join("\n")},
    interv:{injury:pick("areas",5), pre:pick("pre",4), exercises:pick("ex",4)},
    lead:{approach:"Transformational", note:"Focus on individual considerations and intellectual stimulation for justification and understanding.", focus:7, growth:"Reward effort and coach away from negative points."},
    athlete:{...STANDING}, metaphors:met,
    timeline:T.tl.map(([min,label,style])=>({min,label:label==="WOD"&&wod?`WOD: ${wod}`:label,style})),
    notes:{}, moves:[...moves],
  };
  if(from){ // keep the standing words from their last guide
    ["athlete","lead"].forEach(k=>g[k]=JSON.parse(JSON.stringify(from[k])));
    g.lead.focus = from.lead.focus;
  }
  return g;
}
function blankGuide(profile){ return quickBuild({wod:"", template:"strength", moves:[], profile}); }

// Transcribed from the TCC Level 2 examples.
const EXAMPLES = {
  backsquat: Object.assign(quickBuild({wod:"5x5 Back Squat", template:"strength", moves:["Back squat"]}), {id:"ex-backsquat", example:true, status:"example", coach:"BirdBox example",
    instr:{skill:"Back Squat With Mastery", goal:"Intensity through loading or if not achievable due to mastery, the volume increase with relative intensity.", session:"If mastery can not be present during the back squat, adapt first by changing the volume and intensity.", approach:"Strength: 5x5 - Rest period: 3-5 minutes - Load: approx 85%\nHypertrophy: 7x8 - Rest period: 90-120s - Load: approx 70%\nMuscle endurance: 10x15 - Rest period: 30-60s - Load below 50%"},
    interv:{injury:["Lumbar spine","Knee","Ankle","Shoulder","Thoracic spine"], pre:["Hips","Posterior chain/hamstrings","Ankle","T-spine/shoulder"], ex:undefined, exercises:["Plate split squat or Bulgarian split","RDL or good morning","Eccentric calf raise or seated raise","T-spine loaded extension or KB arm bar"]},
    lead:{approach:"Transformational", note:"Focus on individual considerations and intellectual stimulation for justification and understanding.", focus:8, growth:"Reward effort and coach away from negative points."},
    metaphors:[{k:"Contact",v:"Imagine you are an eagle gripping a branch."},{k:"Balance",v:"Stabilise before squatting as if you were standing on a ship in a storm."},{k:"Breath",v:"Imagine your inner core is a pressure jar, fill and hold it."},{k:"Stillness",v:"Before you squat, imagine there is a motion sensor watching you."},{k:"Tension",v:"Try and twist the floor with your feet while bending the bar down."},{k:"Smoothness",v:"Move with fluidity like water running from a tap."}],
    timeline:[{min:0,label:"Introduction",style:"demo"},{min:2,label:"SI joint warm-up",style:"demo"},{min:7,label:"Air squat variations (visual movement assessment)",style:"auto"},{min:10,label:"Interventions NAMSET",style:"auto"},{min:13,label:"Interventions",style:"demo"},{min:20,label:"Air squat retest",style:"auto"},{min:22,label:"Back squat loading",style:"alt"},{min:30,label:"WOD: Back squat",style:"demo"},{min:52,label:"Equipment away",style:"demo"},{min:55,label:"Cool down",style:"demo"}]}),
  fran: Object.assign(quickBuild({wod:"Fran: 21-15-9 Thrusters, Pull-ups", template:"metcon", moves:["Thruster","Pull-up"]}), {id:"ex-fran", example:true, status:"example", coach:"BirdBox example",
    instr:{skill:"Upper body & lower body push, then upper body pull.", goal:"Intensity, Fran is a fast workout. Athletes pursuing Rx should be presenting at least a 225lb/102kg thruster as a 1RM.", session:"Prevention of injury is key, and the shoulders are at the highest risk. Additionally finding the appropriate scaling for each movement is vitally important. 5 minute time cap.", approach:"Thruster: can be scaled by reducing the load, changing to alternative equipment, e.g. dumbbells or sled.\nPull-ups: Mastery of one strict pull-up must be present before kipping. Scaling can be reps, jumping, or a combination of contractions/skills."},
    lead:{approach:"Transformational", note:"Focus on individual considerations and intellectual stimulation for justification and understanding.", focus:6, growth:"Reward effort and maintain clear movement standards."}}),
};

// ---------- styles ----------
const CSS = `
.lgs{--ink:#16181b;--mut:#6b7178;--line:#e4e1db;--soft:#f7f6f3;--acc:#298DE9;background:#fff;color:var(--ink);font:12.5px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08),0 10px 30px rgba(0,0,0,.08)}
.lgs .hd{background:#0f1113;color:#fff;display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:center;padding:14px 20px;border-bottom:4px solid var(--acc)}
.lgs .hd img{height:46px;width:auto;display:block}
.lgs .hd .k{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#9aa1a9}
.lgs .hd .wod{font-size:24px;font-weight:800;letter-spacing:-.01em;line-height:1.1;margin-top:2px}
.lgs .hd .wod input{font-size:22px;font-weight:800;background:#1b1e21;border:1px dashed #3a3f45;color:#fff;border-radius:6px;padding:4px 8px;width:100%}
.lgs .hd .rt{text-align:right;font-size:11px;color:#c7cdd3;line-height:1.6}
.lgs .hd .rt b{color:#fff}
.lgs .hd select,.lgs .hd .rt input{background:#1b1e21;border:1px solid #3a3f45;color:#fff;border-radius:4px;padding:2px 4px;font:inherit}
.lgs .phil{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--line);background:var(--soft)}
.lgs .phil>div{padding:9px 20px}
.lgs .phil>div+div{border-left:1px solid var(--line)}
.lgs .body{display:grid;grid-template-columns:1fr 1.45fr 1fr;gap:12px;padding:14px 16px 6px}
.lgs .col{display:flex;flex-direction:column;gap:12px;min-width:0}
.lgs .sec{border:1px solid var(--line);border-radius:8px;padding:10px 12px;position:relative;background:#fff}
.lgs .sec h3{margin:0 0 7px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:8px;color:var(--ink)}
.lgs .sec h3 .n{width:20px;height:20px;border-radius:50%;background:var(--c);color:#fff;display:grid;place-items:center;font-size:11px;letter-spacing:0;flex:none}
.lgs .sec{border-top:3px solid var(--c)}
.lgs .lab{font-size:9.5px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;margin:7px 0 1px}
.lgs .lab:first-of-type{margin-top:0}
.lgs .lab .pf{font-size:9px;letter-spacing:0;text-transform:none;font-weight:600;color:var(--acc);background:color-mix(in srgb,var(--acc) 12%,#fff);border-radius:8px;padding:0 6px;margin-left:4px}
.lgs .val{white-space:pre-wrap}
.lgs .val.empty{color:#b9b6b0}
.lgs ol{margin:0;padding-left:17px}
.lgs ol li{margin:1px 0}
.lgs textarea,.lgs input[type=text],.lgs select{width:100%;font:inherit;color:inherit;border:1px dashed #cfcac1;border-radius:4px;padding:4px 6px;background:#fffdf8;resize:vertical}
.lgs textarea:focus,.lgs input:focus,.lgs select:focus{outline:2px solid color-mix(in srgb,var(--acc) 25%,#fff);border-color:var(--acc);border-style:solid}
.lgs ol input{padding:2px 6px}
.lgs .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.lgs .chips button{font:inherit;font-size:10.5px;border:1px solid var(--line);background:var(--soft);border-radius:10px;padding:0 7px;cursor:pointer;color:var(--mut)}
.lgs .chips button:hover{border-color:var(--acc);color:var(--acc)}
.lgs .pers{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.lgs .pers .p{border-left:3px solid var(--pc);padding:3px 8px;background:color-mix(in srgb,var(--pc) 6%,#fff);border-radius:0 5px 5px 0}
.lgs .pers .p b{color:var(--pc);font-size:10px;letter-spacing:.12em}
.lgs .im{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:2px}
.lgs .im>div{background:var(--soft);border-radius:6px;padding:5px 8px}
.lgs .im b{font-size:10px;letter-spacing:.1em;text-transform:uppercase}
.lgs .lead1{font-size:14px;font-weight:800;color:var(--c)}
.lgs .scale{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--mut);margin-top:3px}
.lgs .scale .tr{flex:1;height:6px;border-radius:3px;background:linear-gradient(90deg,#e4e1db,var(--c));position:relative}
.lgs .scale .tr i{position:absolute;top:-4px;width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid var(--c);transform:translateX(-7px)}
.lgs .scale input{flex:1;accent-color:var(--c)}
.lgs .scale .nn{font-weight:800;color:var(--c);font-size:13px;min-width:18px;text-align:center}
.lgs .met{display:grid;grid-template-columns:70px 1fr;gap:3px 8px;align-items:start}
.lgs .met b{font-size:10.5px;padding-top:2px}
.lgs .tl{margin:6px 16px 14px;border:1px solid var(--line);border-radius:8px;padding:10px 12px 8px;border-top:3px solid #16181b}
.lgs .tl h3{margin:0 0 4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;display:flex;justify-content:space-between}
.lgs .tl h3 span{font-weight:500;letter-spacing:.02em;text-transform:none;color:var(--mut)}
.lgs .tlsvg{width:100%;height:auto;display:block}
.lgs .tlwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px}
.lgs .tlin{min-width:760px}
.lgs .tlz{display:inline-flex;gap:3px;margin-left:8px;vertical-align:1px}
.lgs .tlz .mini{padding:0 7px;line-height:18px}
.lg-tlfull{position:fixed;inset:0;z-index:200;background:rgba(5,6,8,.8);display:flex;align-items:center;justify-content:center;padding:20px}
.lg-tlfull .box{background:#fff;color:#16181b;border-radius:10px;width:min(1600px,100%);padding:14px 16px;font:13px ui-sans-serif,-apple-system,Segoe UI,sans-serif}
.lg-tlfull .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.lg-tlfull .top button{border:1px solid #e4e1db;background:#f7f6f3;border-radius:5px;padding:4px 10px;margin-left:4px;cursor:pointer;font:inherit}
.lg-tlfull .sc{overflow-x:auto}
.lg-tlfull .legend{display:flex;gap:14px;font-size:12px;color:#6b7178;margin-top:6px}
.lg-tlfull .legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px}
.lgs .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:10.5px;color:var(--mut)}
.lgs .legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.lgs .tlrows{display:grid;grid-template-columns:56px 1fr 130px 28px;gap:4px;align-items:center;margin-top:8px}
.lgs .tlrows .h{font-size:9.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.08em}
.lgs .mini,.lgs .tlrows button{background:var(--soft);border:1px solid var(--line);border-radius:4px;font:inherit;font-size:11px;padding:3px 8px;cursor:pointer}
.lgs .ft{display:flex;justify-content:space-between;padding:6px 18px 10px;font-size:9.5px;color:#9a9fa6;letter-spacing:.06em}
.lgs .mnote{margin-top:7px;background:#fff6db;border:1px solid #f0d98a;border-radius:6px;padding:6px 8px;font-size:11.5px;color:#5b4a12}
.lgs .mnote b{display:block;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:#8a6d1f}
.lgs .mnote textarea{background:#fffbea;border-color:#e6cf7a;margin-top:3px}
.lgs .addnote{position:absolute;top:7px;right:8px;font-size:10.5px;border:1px solid #e6cf7a;background:#fff8dc;color:#8a6d1f;border-radius:10px;padding:0 8px;cursor:pointer}
.lgs.stack .body{grid-template-columns:1fr}
.lgs.stack .phil,.lgs.stack .pers,.lgs.stack .im{grid-template-columns:1fr}
.lgs.stack .phil>div+div{border-left:0;border-top:1px solid var(--line)}
.lgs.stack .hd{grid-template-columns:auto 1fr}.lgs.stack .hd .rt{grid-column:1/-1;text-align:left}
@media (max-width:980px){.lgs:not(.print) .body{grid-template-columns:1fr}.lgs:not(.print) .phil,.lgs:not(.print) .pers,.lgs:not(.print) .im{grid-template-columns:1fr}.lgs:not(.print) .hd{grid-template-columns:auto 1fr}.lgs:not(.print) .hd .rt{grid-column:1/-1;text-align:left}}
@media print{
  @page{size:A4 landscape;margin:7mm}
  html,body{background:#fff!important}
  body.lg-printing>*:not(.lg-print){display:none!important}
  body.lg-printing .lg-print{display:block!important;position:static!important;left:auto!important;width:283mm!important}
  .lg-print .lgs{box-shadow:none;border-radius:0;font-size:8px;line-height:1.32;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .lg-print .lgs .hd{padding:7px 12px}.lg-print .lgs .hd img{height:30px}.lg-print .lgs .hd .wod{font-size:17px}
  .lg-print .lgs .phil>div{padding:4px 12px}
  .lg-print .lgs .body{grid-template-columns:1fr 1.45fr 1fr!important;gap:7px;padding:7px 10px 3px}
  .lg-print .lgs .col{gap:7px}.lg-print .lgs .sec{padding:6px 8px}
  .lg-print .lgs .pers{grid-template-columns:1fr 1fr!important}.lg-print .lgs .im{grid-template-columns:repeat(3,1fr)!important}.lg-print .lgs .phil{grid-template-columns:1fr 1fr!important}
  .lg-print .lgs .tl{margin:2px 10px 4px;padding:4px 8px 3px}.lg-print .lgs .tl h3{margin:0}.lg-print .lgs .tlsvg{max-height:33mm}.lg-print .lgs .lab{margin:4px 0 0}.lg-print .lgs .sec h3{margin:0 0 4px}.lg-print .lgs ol li{margin:0}.lg-print .lgs .im>div,.lg-print .lgs .pers .p{padding:2px 6px}
  .lg-print .lgs .ft{padding:2px 12px 4px}
  .lg-print .lgs .addnote,.lg-print .lgs .tlrows,.lg-print .lgs .mini,.lg-print .lgs .chips,.lg-print .lgs .tlz{display:none!important}
  .lg-print .lgs .tlwrap{overflow:visible}.lg-print .lgs .tlin{width:100%!important;min-width:0}
}`;
function ensureCSS(){ if(document.getElementById("lg-css")) return; const s=document.createElement("style"); s.id="lg-css"; s.textContent=CSS; document.head.append(s); }

// ---------- timeline ----------
function timelineSVG(g,z=1){
  const L=g.length||60, W=Math.round(1000*z), H=128, x0=14, x1=W-14, y=66, X=(m)=>x0+(x1-x0)*Math.min(m,L)/L;
  const segs=[...g.timeline].filter(s=>s.min<L).sort((a,b)=>a.min-b.min);
  let svg=`<svg class="tlsvg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif,-apple-system,Segoe UI,sans-serif">`;
  segs.forEach((s,i)=>{ const nx=i<segs.length-1?segs[i+1].min:L; const a=X(s.min), b=X(nx); const col=(STYLES[s.style]||STYLES.auto).col;
    svg+=`<rect x="${a+1}" y="${y-9}" width="${Math.max(1,b-a-2)}" height="18" rx="4" fill="${col}"/>`;
    const up=i%2===0, lvl=Math.floor(i/2)%2; const ly= up ? y-16-lvl*22 : y+28+lvl*22;
    svg+=`<line x1="${a+1}" y1="${up?y-9:y+9}" x2="${a+1}" y2="${up?ly+3:ly-11}" stroke="#9aa1a9" stroke-width="1"/>`;
    const lab=String(s.label||"").length>30?String(s.label).slice(0,29)+"…":String(s.label||"");
    svg+=`<text x="${a+4}" y="${ly}" font-size="12" fill="#16181b" font-weight="600">${esc(lab)}</text>`;
    svg+=`<text x="${a+4}" y="${y+4.5}" font-size="11" fill="#fff" font-weight="800">${s.min}</text>`; });
  svg+=`<text x="${x1}" y="${y+4.5}" font-size="11" fill="#16181b" font-weight="800" text-anchor="end" dx="-2"></text>`;
  return svg+`</svg>`;
}

// ---------- render ----------
const ZOOM={};
function openTimeline(g){ ensureCSS(); const d=document.createElement("div"); d.className="lg-tlfull"; let z=Math.max(1.4,(g.timeline.length/8));
  const draw=()=>{ d.innerHTML=`<div class="box"><div class="top"><b>${esc(g.wod||g.title)} · session timeline</b><span><button data-fz="-1">−</button><button data-fz="1">＋</button><button data-fx>Close</button></span></div><div class="sc"><div style="width:${Math.round(z*100)}%;min-width:100%">${timelineSVG(g,z)}</div></div><div class="legend">${Object.values(STYLES).map(s=>`<span><i style="background:${s.col}"></i>${s.name} coaching</span>`).join("")}</div></div>`;
    d.querySelector("[data-fx]").onclick=()=>d.remove(); d.querySelectorAll("[data-fz]").forEach(b=>b.onclick=()=>{z=Math.min(5,Math.max(1,z+(+b.dataset.fz)*.5));draw()}); };
  d.onclick=(e)=>{if(e.target===d)d.remove()}; document.body.append(d); draw(); }
// opt: {edit, stack, notes:"view"|"edit"|null, onChange(g), profileHint, print}
function renderGuide(el, g, opt={}){
  ensureCSS();
  const E=!!opt.edit, B=BRANDS[g.brand]||BRANDS.tcc;
  const v=(val,path,rows=2,ph="")=>E?`<textarea rows="${rows}" data-p="${path}" placeholder="${esc(ph)}">${esc(val)}</textarea>`:`<div class="val ${val?"":"empty"}">${val?esc(val):"—"}</div>`;
  const vi=(val,path,ph="")=>E?`<input type="text" data-p="${path}" value="${esc(val)}" placeholder="${esc(ph)}">`:`<span class="${val?"":"val empty"}">${val?esc(val):"—"}</span>`;
  const list=(arr,path,ph)=>`<ol>${arr.map((x,i)=>`<li>${vi(x,`${path}.${i}`,ph)}</li>`).join("")}</ol>`;
  const chips=(arr,path,opts)=>E?`<div class="chips">${opts.filter(o=>!arr.includes(o)).slice(0,8).map(o=>`<button data-chip="${path}" data-v="${esc(o)}">＋ ${esc(o)}</button>`).join("")}</div>`:"";
  const note=(sec)=>{const n=(g.notes||{})[sec]; if(opt.notes==="edit") return n!=null?`<div class="mnote"><b>Mentor note</b><textarea rows="2" data-note="${sec}" placeholder="Your note on this section">${esc(n)}</textarea></div>`:`<button class="addnote" data-addnote="${sec}">＋ note</button>`; if(opt.notes==="view"&&n) return `<div class="mnote"><b>Mentor note</b>${esc(n)}</div>`; return "";};
  const pf = opt.profileHint ? `<span class="pf">from your profile</span>` : "";
  const exPool=[...new Set(Object.values(MOVES).flatMap(m=>m.ex))], prePool=[...new Set(Object.values(MOVES).flatMap(m=>m.pre))];
  const sec=(n,title,c,inner,key)=>`<div class="sec" style="--c:${c}"><h3><span class="n">${n}</span>${title}</h3>${inner}${note(key)}</div>`;
  el.innerHTML = `<div class="lgs ${opt.stack?"stack":""} ${opt.print?"print":""}" style="--acc:${B.accent}">
    <div class="hd"><img src="${ROOT}${B.logo}" alt="${B.short}">
      <div><div class="k">One-page lesson guide${E?` · <select data-p="brand">${Object.entries(BRANDS).map(([k,b])=>`<option value="${k}" ${g.brand===k?"selected":""}>${b.short}</option>`).join("")}</select>`:""}</div>
        <div class="wod">${E?`<input type="text" data-p="wod" value="${esc(g.wod)}" placeholder="WOD, e.g. 5x5 Back Squat">`:esc(g.wod||g.title)}</div></div>
      <div class="rt">Coach <b>${E?`<input type="text" data-p="coach" value="${esc(g.coach)}" style="width:120px">`:esc(g.coach||"—")}</b><br>${E?`<input type="text" data-p="date" value="${esc(g.date||"")}" style="width:100px">`:esc(g.date||"")} · ${E?`<select data-p="length" data-num="1">${[30,45,60,75,90].map(n=>`<option ${g.length==n?"selected":""}>${n}</option>`).join("")}</select>`:g.length} min</div></div>
    <div class="phil"><div><div class="lab">Coaching definition ${pf}</div>${v(g.definition,"definition",2)}</div><div><div class="lab">Your coaching philosophy ${pf}</div>${v(g.philosophy,"philosophy",2,"Written once in your profile, then copied into every guide")}</div></div>
    <div class="body">
      <div class="col">
        ${sec(1,"Instructional","#d6334a",`<div class="lab">Skill</div>${v(g.instr.skill,"instr.skill",1)}<div class="lab">Goal</div>${v(g.instr.goal,"instr.goal",2)}<div class="lab">Session considerations</div>${v(g.instr.session,"instr.session",2)}<div class="lab">Approach / scaling</div>${v(g.instr.approach,"instr.approach",3)}`,"instr")}
        ${sec(2,"Interventions","#1f7ae0",`<div class="lab">Common injury prevention considerations</div>${list(g.interv.injury,"interv.injury","area")}${chips(g.interv.injury,"interv.injury",AREAS)}
          <div class="lab">Pre-considered interventions</div>${list(g.interv.pre,"interv.pre","area")}${chips(g.interv.pre,"interv.pre",prePool)}
          <div class="lab">Intervention exercises</div>${list(g.interv.exercises,"interv.exercises","exercise")}${chips(g.interv.exercises,"interv.exercises",exPool)}`,"interv")}
      </div>
      <div class="col">
        ${sec(4,"Athlete considerations","#1b7a45",`<div class="lab">Personality considerations</div><div class="pers">${[["blue","BLUE","#1f7ae0"],["yellow","YELLOW","#c58a00"],["red","RED","#d6334a"],["green","GREEN","#1b7a45"]].map(([k,l,c])=>`<div class="p" style="--pc:${c}"><b>${l}</b>${v(g.athlete[k],"athlete."+k,2)}</div>`).join("")}</div>
          <div class="lab">Arousal levels</div>${v(g.athlete.arousal,"athlete.arousal",2)}
          <div class="lab">Intrinsic motivation</div><div class="im"><div><b style="color:#d6334a">Competency</b>${v(g.athlete.competency,"athlete.competency",3)}</div><div><b style="color:#1b7a45">Autonomy</b>${v(g.athlete.autonomy,"athlete.autonomy",3)}</div><div><b style="color:#1f7ae0">Relatedness</b>${v(g.athlete.relatedness,"athlete.relatedness",3)}</div></div>`,"athlete")}

      </div>
      <div class="col">
        ${sec(5,"Coaching","#6a3fd6",`<div class="lab">Intended metaphors</div><div class="met">${g.metaphors.map((m,i)=>`<b>${E?`<input type="text" data-p="metaphors.${i}.k" value="${esc(m.k)}">`:esc(m.k)}</b>${v(m.v,`metaphors.${i}.v`,2)}`).join("")}</div>${E?`<button class="mini" data-add="metaphor" style="margin-top:6px">＋ Metaphor</button>`:""}`,"coach")}
        ${sec(3,"Leadership","#e0661b",`<div class="lab">Leadership approach</div>${E?`<select data-p="lead.approach">${["Transformational","Autocratic","Democratic","Situational"].map(o=>`<option ${g.lead.approach===o?"selected":""}>${o}</option>`).join("")}</select>`:`<div class="lead1">${esc(g.lead.approach)}</div>`}${v(g.lead.note,"lead.note",2)}
          <div class="lab">Task (1) or athlete (10) focus</div><div class="scale"><span>Task</span>${E?`<input type="range" min="1" max="10" data-p="lead.focus" data-num="1" value="${g.lead.focus}">`:`<div class="tr"><i style="left:${(g.lead.focus-1)/9*100}%"></i></div>`}<span>Athlete</span><span class="nn">${g.lead.focus}</span></div>
          <div class="lab">Growth mindset</div>${v(g.lead.growth,"lead.growth",1)}`,"lead")}
      </div>
    </div>
    <div class="tl"><h3>Session timeline <span>${g.timeline.length} parts · ${g.length} minutes <span class="tlz"><button class="mini" data-z="-1" title="Narrower">−</button><button class="mini" data-z="1" title="Wider">＋</button><button class="mini" data-z="full" title="Open full width">⤢</button></span></span></h3><div class="tlwrap"><div class="tlin" style="width:${Math.round((ZOOM[g.id]||1)*100)}%">${timelineSVG(g,ZOOM[g.id]||1)}</div></div>
      <div class="legend">${Object.values(STYLES).map(s=>`<span><i style="background:${s.col}"></i>${s.name} coaching</span>`).join("")}</div>
      ${E?`<div class="tlrows"><span class="h">Minute</span><span class="h">Part</span><span class="h">Style</span><span></span>${[...g.timeline].map((s,i)=>({...s,i})).sort((a,b)=>a.min-b.min).map(s=>`<input type="text" data-p="timeline.${s.i}.min" data-num="1" value="${s.min}"><input type="text" data-p="timeline.${s.i}.label" value="${esc(s.label)}"><select data-p="timeline.${s.i}.style">${Object.entries(STYLES).map(([k,o])=>`<option value="${k}" ${s.style===k?"selected":""}>${o.name}</option>`).join("")}</select><button data-del="${s.i}" title="Remove">✕</button>`).join("")}</div><button class="mini" data-add="seg" style="margin-top:6px">＋ Add a part</button>`:""}${note("timeline")}</div>
    <div class="ft"><span>${esc(B.name.toUpperCase())} · BIRDBOX COACHING</span><span>birdboxcoaching.com</span></div>
  </div>`;
  el.querySelectorAll("[data-z]").forEach(b=>b.onclick=(e)=>{e.preventDefault(); if(b.dataset.z==="full"){openTimeline(g);return} ZOOM[g.id]=Math.min(5,Math.max(1,(ZOOM[g.id]||1)+(+b.dataset.z)*.5)); const tin=el.querySelector(".tlin"); if(tin){ tin.style.width=Math.round(ZOOM[g.id]*100)+"%"; tin.innerHTML=timelineSVG(g,ZOOM[g.id]); } });
  const grow=(t)=>{t.style.height="auto";t.style.height=(t.scrollHeight+2)+"px"};
  el.querySelectorAll("textarea").forEach(t=>{grow(t);t.addEventListener("input",()=>grow(t))});
  if(E){
    const set=(path,val)=>{const ks=path.split(".");let o=g;for(let i=0;i<ks.length-1;i++)o=o[ks[i]];o[ks[ks.length-1]]=val;};
    const get=(path)=>path.split(".").reduce((o,k)=>o[k],g);
    el.querySelectorAll("[data-p]").forEach(inp=>{
      const h=(final)=>{ let val=inp.value; if(inp.dataset.num) val=Number(val)||0; set(inp.dataset.p,val);
        if(inp.dataset.p==="wod"&&val) g.title=val;
        opt.onChange&&opt.onChange(g);
        if(inp.type==="range"){ inp.closest(".scale").querySelector(".nn").textContent=val; }
        if(inp.dataset.p.startsWith("timeline")||inp.dataset.p==="length"){ const svg=el.querySelector(".tlsvg"); if(svg) svg.outerHTML=timelineSVG(g,ZOOM[g.id]||1); }
        if(final&&(inp.dataset.p==="brand"||inp.dataset.p==="length"||inp.dataset.p.endsWith(".min"))) renderGuide(el,g,opt); };
      inp.addEventListener("input",()=>h(false)); inp.addEventListener("change",()=>h(true)); });
    el.querySelectorAll("[data-chip]").forEach(b=>b.onclick=()=>{ const arr=get(b.dataset.chip); const i=arr.findIndex(x=>!x); if(i>=0) arr[i]=b.dataset.v; else arr[arr.length-1]=b.dataset.v; opt.onChange&&opt.onChange(g); renderGuide(el,g,opt); });
    el.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{g.timeline.splice(+b.dataset.del,1);opt.onChange&&opt.onChange(g);renderGuide(el,g,opt)});
    el.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{ if(b.dataset.add==="seg"){const last=[...g.timeline].sort((a,b)=>b.min-a.min)[0];g.timeline.push({min:Math.min((last?last.min:0)+5,g.length-1),label:"",style:"auto"})} else g.metaphors.push({k:"",v:""}); opt.onChange&&opt.onChange(g); renderGuide(el,g,opt); });
  }
  if(opt.notes==="edit"){
    el.querySelectorAll("[data-addnote]").forEach(b=>b.onclick=()=>{g.notes=g.notes||{};g.notes[b.dataset.addnote]="";renderGuide(el,g,opt);const t=el.querySelector(`[data-note="${b.dataset.addnote}"]`);t&&t.focus()});
    el.querySelectorAll("[data-note]").forEach(t=>t.oninput=()=>{g.notes[t.dataset.note]=t.value;opt.onChange&&opt.onChange(g,{note:true})});
  }
}

window.LG = {openTimeline, renderGuide, quickBuild, blankGuide, timelineSVG, EXAMPLES, PROFILE_DEFAULT, BRANDS, STYLES, MOVES, TEMPLATES, clone:(g)=>JSON.parse(JSON.stringify(g)), uid:uidg};
})();
