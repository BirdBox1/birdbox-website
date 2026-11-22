// Example data for the mentor portal test version (21 Nov 2026). Nothing real.
const TODAY_LABEL = "Mon 23 Nov";

const MENTORS = {
  nathan:   {name:"Nathan Bird", short:"Nathan",  admin:true,  courses:["tcc","tgc"], cap:5, colour:"#2f7fd0"},
  michaela: {name:"Michaela",    short:"Michaela",admin:false, courses:["tcc","tgc"], cap:5, colour:"#b0418f"},
  barney:   {name:"Barney",      short:"Barney",  admin:false, courses:["tgc"],       cap:5, colour:"#d1632b"},
  dane:     {name:"Dane",        short:"Dane",    admin:false, courses:["tcc"],       cap:5, colour:"#2f8f6b"},
  luis:     {name:"Luis",        short:"Luis",    admin:false, courses:["tcc","tgc"], cap:4, colour:"#6a5acd"},
  marcus:   {name:"Marcus",      short:"Marcus",  admin:false, courses:["tgc"],       cap:5, colour:"#8a6d1f"},
  mel:      {name:"Mel",         short:"Mel",     admin:false, courses:["tcc"],       cap:5, colour:"#c0392b"},
};

const PLAN_SAM = `Where you are now
Strong technical coach. In a busy class you lose people: you coach the strongest two and the rest drift.

Where you want to be in 6 months
Running the 6am class of 16 on your own, with every athlete feeling seen.

Focus for cycle 1
- One cue, one athlete, then move: no more than 8 words per cue
- Speak to every athlete by name in the first 10 minutes
- Film one class in week 2 for video review`;

let MENTEES = [
  {id:"sam",   name:"Sam Rivera",     brand:"tcc", mentor:"nathan",   cycle:1, week:2, joined:"15 Nov", pay:"paid",   gym:"Iron Harbour, Cork",
   goal:"Run the 6am class of 16 on his own, every athlete feeling seen", plan:PLAN_SAM, planSent:true, unread:1,
   path:[
     {bank:"tcc",topic:"Communication",media:"Video lecture",focus:"Count the words in your cues at the 6am.",status:"done",date:"15 Nov",reflection:"Most cues were 15-20 words. Got the warm-up down to 8."},
     {bank:"tcc",topic:"Feedback",media:"Article",focus:"One piece of feedback to every athlete, by name, before the workout.",status:"now",date:"19 Nov"},
     {bank:"wider",topic:"Running a group class",media:"Observation check sheet",focus:"Use the sheet on your own class video.",status:"next",date:""}],
   notes:"Responds well to direct challenge. Front desk shifts eat his planning time.",
   events:[["15 Nov","Opening call (58 min), recorded + transcribed","good"],["16 Nov","Development plan published","acc"],["18 Nov","Sent first coaching video","warn"],["19 Nov","Weekly call 1 · new focus: Feedback","acc"]]},
  {id:"aoife", name:"Aoife Byrne",    brand:"tgc", mentor:"nathan",   cycle:3, week:1, joined:"22 Sep", pay:"paid",   gym:"CrossFit Liffey, Dublin",
   goal:"Run her own gymnastics class and coach the kip with confidence", plan:"", planSent:true, unread:0,
   path:[{bank:"tgc",topic:"Kipping and the beat swing",media:"Video lecture",focus:"Film 3 athletes' beat swings and compare hollow-to-arch timing.",status:"now",date:"20 Nov"}],
   notes:"", events:[["22 Sep","Joined"],["20 Nov","Cycle 3 started"]]},
  {id:"lukas", name:"Lukas Weber",    brand:"tcc", mentor:"nathan",   cycle:2, week:4, joined:"6 Oct",  pay:"failed", gym:"Box 17, Munich",
   goal:"Move from assistant to head coach by spring", plan:"", planSent:true, unread:0, path:[], notes:"Card failed 21 Nov. Stripe retrying.", events:[["21 Nov","Payment failed, Stripe retrying","bad"]]},
  {id:"jade",  name:"Jade Thompson",  brand:"tgc", mentor:"michaela", cycle:1, week:3, joined:"3 Nov",  pay:"paid",   gym:"Northside Strength, Leeds",
   goal:"Fix her own kipping pull-up and coach it to beginners", plan:"", planSent:true, unread:2, path:[], notes:"", events:[]},
  {id:"marco", name:"Marco Rossi",    brand:"tcc", mentor:"michaela", cycle:5, week:2, joined:"1 Aug",  pay:"paid",   gym:"Forza Club, Milan",
   goal:"Lead his coaching team", plan:"", planSent:true, unread:0, path:[], notes:"", events:[]},
  {id:"priya", name:"Priya Shah",     brand:"tgc", mentor:"barney",   cycle:2, week:2, joined:"13 Oct", pay:"paid",   gym:"The Yard, London",
   goal:"Handstand progressions for her masters class", plan:"", planSent:true, unread:0, path:[], notes:"", events:[]},
  {id:"tom",   name:"Tom Gallagher",  brand:"tcc", mentor:null,       cycle:1, week:1, joined:"today",  pay:"paid",   gym:"Galway CrossFit",
   goal:"", plan:"", planSent:false, unread:0, path:[], notes:"", events:[["today","Paid €280 · TCC Essentials","good"]], level1:"TCC Level 1 · Dublin · Mar 2025",
   stage:"paid", paidOn:"today", amount:280, tz:"Europe/Dublin", email:"tom.gallagher@example.com",
   signup:{why:"I coach the evening classes and want to get better at managing big groups and giving feedback that sticks.", times:"Weekday mornings before 9", experience:"3 years coaching, CF-L1, TCC L1"}},
  {id:"ines",  name:"Inês Duarte",    brand:"tgc", mentor:null,       cycle:1, week:1, joined:"yesterday", pay:"paid", gym:"Alfama Fitness, Lisbon",
   goal:"", plan:"", planSent:false, unread:0, path:[], notes:"", events:[["yesterday","Paid €240 · TGC Essentials","good"]], level1:null, level1Note:"Says: TGC L1 Lisbon, June 2024 (not found under this email)",
   stage:"paid", paidOn:"yesterday", amount:240, tz:"Europe/Lisbon", email:"ines.duarte@example.com",
   signup:{why:"I want to run a proper gymnastics class at my box and coach the kip safely.", times:"Evenings after 6pm", experience:"5 years coaching, TGC L1"}},
];

// Bookings this week (day 0 = Mon 23 Nov). start in minutes from midnight.
let BOOKINGS = [
  {mentor:"nathan", mentee:"sam",   day:0, start:7*60+30, len:30, kind:"wk"},
  {mentor:"nathan", mentee:"aoife", day:0, start:12*60,   len:30, kind:"wk"},
  {mentor:"nathan", mentee:"lukas", day:2, start:19*60,   len:30, kind:"wk"},
  {mentor:"michaela", mentee:"jade",  day:0, start:9*60,  len:30, kind:"wk"},
  {mentor:"michaela", mentee:"marco", day:3, start:13*60, len:30, kind:"wk"},
  {mentor:"barney", mentee:"priya", day:1, start:18*60,   len:30, kind:"wk"},
];

// Review queue: videos sent by mentees.
let VIDEOS = [
  {id:"v1", mentee:"sam",   title:"6am class: coaching feedback in the warm-up", note:"Am I getting round everyone? Watch from about 0:40.", sent:"18 Nov", src:"/tcc/level-1/Oregon%20feedback%20BB%20website.mp4", sheet:"tcc-obs", status:"new",
   items:[]},
  {id:"v2", mentee:"jade",  title:"Teaching the kip to a beginner group", note:"Is my progression order right?", sent:"20 Nov", src:"/tgc/programming/feedback-film.mp4", sheet:"tcc-obs", status:"new", items:[]},
  {id:"v3", mentee:"aoife", title:"Coaching a 1-2-1 session", note:"My cueing on the beat swing.", sent:"21 Nov", src:"/tcc/level-2/Niels%20feedback%20BB%20website.mp4", sheet:"tcc-obs", status:"draft",
   items:[{t:12.4,type:"comment",text:"Lovely start: you got her name and the goal in the first 10 seconds."},{t:31,type:"check",text:"Communication · Verbal: 8"}]},
];

let THREADS = {
  sam:[{who:"nathan",t:"15 Nov",text:"Great to meet you Friday Sam. Plan is on its way. Shout here any time."},{who:"sam",t:"18 Nov",text:"Thanks! Just sent my first class video."},{who:"sam",t:"22 Nov",text:"Quick one: is it ok to use the same cue for everyone in the warm-up?"}],
  aoife:[{who:"aoife",t:"20 Nov",text:"Starting the beat swing work this week 💪"},{who:"nathan",t:"20 Nov",text:"Brilliant. Film 3 athletes if you can."}],
  lukas:[{who:"nathan",t:"12 Nov",text:"How did the head coach chat go?"}],
  jade:[{who:"jade",t:"21 Nov",text:"Sent the kip video!"},{who:"jade",t:"22 Nov",text:"Also, can we move Thursday's call?"}],
  marco:[], priya:[],
};

// Observation check sheets, worded as in the TCC portfolio. Units 10 (report) and 15 (checklist) merged into one
// on 21 Nov (Nathan): they repeat the same five sections; Humility & vulnerability is only in the report.
const SHEETS = {
  "tcc-obs": {name:"TCC coaching observation (report + checklist)", short:"TCC observation", sections:[
    {key:"comm", name:"Communication", items:["Verbal","Non-verbal","Responses","Listening skills"]},
    {key:"team", name:"Team work", items:["Quality of integration","Leadership quality","Team cohesion","Individual contributions"]},
    {key:"judg", name:"Judgement", items:["Predetermined judgements","Judgements developed","Accuracy","Consequences"]},
    {key:"dec",  name:"Decision making", items:["Speed","Timing","Effectiveness","Consequences","Options taken when presented"]},
    {key:"obs",  name:"Observation", items:["Observation of people","Observation of situations","Observation of self","Observation of environment","Consequences of observations"]},
    {key:"hv",   name:"Humility & vulnerability", hv:true, items:["Spend time listening to others","Practise mindfulness, and focus on the present","Be grateful for what you have","Ask for help when you need it","Seek feedback from others regularly","Review your actions against the language of pride"]},
  ]},
};

// From the TCC Level 1 manual, chapter 21 "Observational checksheets" (wording as printed).
const TCC_CHARISMA = {key:"char", name:"Charisma", desc:"The emotional connection a leader develops with an athlete or athletes. Dependants will attach themselves emotionally to the leader",
  items:["Metaphors","Subject knowledge","Resonant voice","Open body language","Enthusiasm and energy","Animated facial expressions","Varied voice, tone and pitch","Use of pauses","Hand gestures","Eye contact"]};
SHEETS["tcc-transform"] = {name:"Transformational leadership (TCC manual)", short:"Transformational", sections:[
  TCC_CHARISMA,
  {key:"ideal", name:"Idealised influence", desc:"Describes behaviours that actively promote a leader's vision, mission and beliefs",
    items:["Discussing values and behaviours","Showing vulnerability and humility","Has a coaching philosophy"]},
  {key:"insp", name:"Inspiration", desc:"Inspiration is a dimension that generates emotional identification with the leader's vision",
    items:["Discussing goals and expectations","Providing meaningful and challenging tasks and roles","Expressing confidence in athletes’ capabilities","Implementing a collective vision"]},
  {key:"intel", name:"Intellectual Stimulation", desc:"Focuses on cognitions, a leader will nurture proactive, creative and innovative thinking",
    items:["Eliciting athlete input","Sharing decision making/leadership responsibilities","Emphasising the learning process"]},
  {key:"indiv", name:"Individual Considerations", desc:"A coach will provide individualised attention to the subordinates by emphasising one-on-one relationships, and two-way dialogue",
    items:["Showing interest in athletes’ feelings and perspectives","Recognising athlete accomplishments and contributions"]},
]};

const CONTENT_REQUESTS = [
  {topic:"Feedback", bank:"tcc", media:"Podcast", by:["Nathan","Michaela"], count:2},
  {topic:"Kipping and the beat swing", bank:"tgc", media:"Observation check sheet", by:["Barney"], count:1},
  {topic:"Running a group class", bank:"wider", media:"Video lecture", by:["Nathan","Dane","Mel"], count:3},
  {topic:"Motivational interviewing", bank:"tcc", media:"Case study", by:["Michaela"], count:1},
];

// Price per 4-week cycle, and what is left after 23% VAT + Stripe fees.
const PRICE = {tgc:{gross:240,net:189.59}, tcc:{gross:280,net:221.23}};

// Lesson guides sent in by mentees (the coach builds them in Learn → Mentorship → Lesson guides).
const GUIDES = (()=>{ const g=LG.quickBuild({wod:"Warm-up and back squat, 6am class",template:"strength",moves:["Back squat"],
  profile:{...LG.PROFILE_DEFAULT,name:"Sam Rivera",brand:"tcc",philosophy:"Every athlete leaves feeling seen, safer and a little better than when they came in."}});
  Object.assign(g,{id:"g-sam-1",owner:"sam",status:"submitted",sent:"17 Nov",date:"2026-11-19"}); return [g]; })();
VIDEOS.find(v=>v.id==="v1").guide="g-sam-1";
