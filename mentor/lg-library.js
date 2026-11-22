// Movement library for lesson guides (and later TCC box programming).
// STARTER CONTENT: written by Claude on 22 Nov 2026 from the TCC Level 2 examples and general coaching practice.
// Every line here needs Nathan's check before real use.
(function(){
// Families carry the injury areas, interventions, exercises and a metaphor. Movements point at a family.
const FAM = {
  squat:   {areas:["Knee","Hips","Ankle","Lumbar spine","Thoracic spine"], pre:["Hips","Ankle","Posterior chain/hamstrings","T-spine/shoulder"], ex:["Plate split squat or Bulgarian split","Goblet squat hold","Eccentric calf raise or seated raise","T-spine loaded extension or KB arm bar"], met:{Contact:"Imagine you are an eagle gripping a branch.",Tension:"Try and twist the floor with your feet."}},
  hinge:   {areas:["Lumbar spine","Hips","Hamstrings","Knee","Grip"], pre:["Posterior chain/hamstrings","Hips","Thoracic spine","Grip"], ex:["RDL or good morning","Banded hip hinge","Dead bug or bird dog","Farmers hold"], met:{Tension:"Pull the slack out of the bar before it leaves the floor.",Contact:"Push the floor away rather than pulling the bar up."}},
  oly:     {areas:["Wrist","Lumbar spine","Shoulder/scapular","Knee","Hips"], pre:["Wrists/lats","Thoracic spine","Hips","Ankle"], ex:["Front rack stretch","Muscle clean or muscle snatch","Overhead squat with PVC","Goblet squat hold"], met:{Smoothness:"Stay close to the bar like a zip.",Contact:"Jump, then catch it on a shelf."}},
  press:   {areas:["Shoulder/scapular","Lumbar spine","Thoracic spine","Wrist","Elbow"], pre:["Thoracic spine","Shoulder/scapular","Lats","Wrists"], ex:["PVC pass-throughs","Wall angels","Banded face pulls","Dead bug"], met:{Contact:"Punch the ceiling.",Breath:"Imagine your inner core is a pressure jar, fill and hold it."}},
  hpush:   {areas:["Shoulder/scapular","Elbow","Wrist","Lumbar spine"], pre:["Shoulder/scapular","Wrists","Thoracic spine","Elbows"], ex:["Scapular push-ups","Banded external rotation","Wrist prep and loaded leans","Hollow hold"], met:{Stillness:"Body like a plank of wood from head to heel."}},
  invert:  {areas:["Shoulder/scapular","Neck","Wrist","Lumbar spine","Elbow"], pre:["Shoulder/scapular","Thoracic spine","Wrists","Midline"], ex:["Wall-facing hold","Pike push-up","Wrist prep and loaded leans","Hollow hold"], met:{Stillness:"Stack your joints like building blocks.",Contact:"Spread your fingers like you are gripping the floor."}},
  gpull:   {areas:["Shoulder/scapular","Elbow","Wrist","Lumbar spine","Grip"], pre:["Shoulder/scapular","Lats","Thoracic spine","Elbows"], ex:["Scapular pull-ups","Ring rows","Shoulder distraction into wall angels","Banded supination into PVC rotations"], met:{Stillness:"Be stable on the bar like a tree root rather than a branch in the wind.",Smoothness:"Imagine you are a play swing, one movement from one apex to the other."}},
  dip:     {areas:["Shoulder/scapular","Elbow","Wrist","Sternum"], pre:["Shoulder/scapular","Pecs/anterior shoulder","Elbows","Wrists"], ex:["Support hold","Banded pec stretch","Box dip","Scapular dips"], met:{Stillness:"Arms like pillars."}},
  midline: {areas:["Lumbar spine","Hip flexors","Shoulder/scapular","Neck"], pre:["Midline","Hip flexors","Lats","Thoracic spine"], ex:["Hollow hold","Dead bug","Active hang","Banded lat stretch"], met:{Tension:"Ribs down, like zipping up a tight jacket."}},
  jump:    {areas:["Knee","Ankle","Achilles","Hips","Lumbar spine"], pre:["Ankle","Hips","Knee","Calves"], ex:["Squat jump and stick","Eccentric calf raise or seated raise","Step-ups","Single-leg balance"], met:{Contact:"Land quiet like a cat."}},
  mono:    {areas:["Knee","Ankle","Hips","Lumbar spine","Shoulder/scapular"], pre:["Ankle","Hips","Posterior chain/hamstrings","Thoracic spine"], ex:["Eccentric calf raise or seated raise","Glute bridge","Banded hip hinge","Single-leg balance"], met:{Smoothness:"Find a rhythm like a metronome."}},
  swing:   {areas:["Lumbar spine","Hips","Shoulder/scapular","Grip"], pre:["Posterior chain/hamstrings","Hips","Lats","Grip"], ex:["Banded hip hinge","KB deadlift","Plank","Farmers hold"], met:{Smoothness:"Snap the hips like closing a car door with your bum."}},
  carry:   {areas:["Lumbar spine","Grip","Shoulder/scapular","Hips"], pre:["Midline","Grip","Shoulder/scapular","Hips"], ex:["Suitcase hold","Dead bug","Plank","Farmers hold"], met:{Stillness:"Walk tall like a waiter with a full tray."}},
  single:  {areas:["Knee","Hips","Ankle","Lumbar spine"], pre:["Hips","Ankle","Glutes","Knee"], ex:["Single-leg balance","Glute bridge","Split squat hold","Eccentric calf raise or seated raise"], met:{Balance:"Stand like a flamingo before you move."}},
  throw:   {areas:["Shoulder/scapular","Knee","Lumbar spine","Wrist"], pre:["Hips","Ankle","Thoracic spine","Shoulder/scapular"], ex:["Goblet squat hold","Wall angels","Med ball front squat","Eccentric calf raise or seated raise"], met:{Smoothness:"Squat and throw in one wave."}},
  rope:    {areas:["Grip","Elbow","Shoulder/scapular","Lumbar spine"], pre:["Grip","Lats","Shoulder/scapular","Midline"], ex:["Towel hang","Ring rows","Hanging knee raise","Farmers hold"], met:{Contact:"Feet are the brakes, hands are the steering wheel."}},
};

// category → [movement, family, scaling note]
const CATS = {
  "Squats": [["Air squat","squat","Box target or reduced depth"],["Back squat","squat","Adapt the volume and intensity first if mastery isn't there"],["Front squat","squat","Goblet or dumbbell front squat"],["Overhead squat","oly","PVC or reduced range"],["Goblet squat","squat","Lighter bell or box target"],["Wall ball","throw","Lighter ball or lower target"],["Thruster","press","Reduce the load, or dumbbells"],["Box squat","squat","Higher box"]],
  "Hinge & deadlift": [["Deadlift","hinge","Kettlebell or elevated deadlift"],["Sumo deadlift high pull","hinge","Kettlebell, lighter load"],["Romanian deadlift","hinge","Reduced range"],["Good morning","hinge","PVC or lighter load"],["Kettlebell swing","swing","Russian swing or lighter bell"],["Hip thrust","hinge","Glute bridge"]],
  "Olympic lifting": [["Clean","oly","Hang or dumbbell clean"],["Power clean","oly","Hang power clean"],["Hang clean","oly","Muscle clean"],["Snatch","oly","Hang or dumbbell snatch"],["Power snatch","oly","Muscle snatch"],["Clean and jerk","oly","Dumbbell clean and jerk"],["Ground to overhead","oly","Dumbbell or lighter load"],["Push jerk","press","Push press"],["Split jerk","press","Push jerk"],["Dumbbell snatch","oly","Lighter dumbbell, hang"],["Devil press","oly","Burpee + dumbbell clean"]],
  "Pressing": [["Strict press","press","Dumbbells or lighter load"],["Push press","press","Dumbbells or lighter load"],["Bench press","hpush","Dumbbells or push-ups"],["Dumbbell press","press","Lighter dumbbells, seated"]],
  "Gymnastics: pulling": [["Pull-up","gpull","Mastery of one strict pull-up before kipping. Scale reps, jumping, or ring rows"],["Strict pull-up","gpull","Banded or jumping negatives"],["Chest to bar","gpull","Pull-ups"],["Bar muscle-up","gpull","Chest to bar + dips"],["Ring muscle-up","gpull","Low ring transitions"],["Ring row","gpull","Steeper body angle"],["Rope climb","rope","Lying to standing rope pulls"],["Legless rope climb","rope","Rope climb with feet"]],
  "Gymnastics: pushing & upside down": [["Push-up","hpush","Box or knee push-up"],["Handstand push-up","invert","Pike push-up, box HSPU or reduced range"],["Strict handstand push-up","invert","Pike or box HSPU"],["Handstand walk","invert","Wall walks or shoulder taps"],["Wall walk","invert","Partial range"],["Ring dip","dip","Box dip or banded dip"],["Bar dip","dip","Box dip"],["Burpee","hpush","Step-back burpee"]],
  "Midline": [["Toes to bar","midline","Knees to chest or V-ups"],["Knees to elbows","midline","Hanging knee raise"],["Sit-up","midline","Reduced range"],["GHD sit-up","midline","AbMat sit-up"],["L-sit","midline","Tuck sit"],["Hollow rock","midline","Hollow hold"],["Plank","midline","Knees down"]],
  "Jumping": [["Box jump","jump","Step-ups or a lower box"],["Box jump over","jump","Step-overs"],["Double-under","jump","Single-unders or attempts"],["Single-under","jump","Jumping without a rope"],["Broad jump","jump","Shorter distance"],["Burpee box jump over","jump","Step-overs"]],
  "Monostructural": [["Running","mono","Shorter distance, row or bike"],["Rowing","mono","Bike or ski"],["Assault bike","mono","Shorter time"],["Ski erg","mono","Row"],["Swimming","mono","Shorter distance"]],
  "Single leg & lunges": [["Walking lunge","single","Reverse lunge or bodyweight"],["Front rack lunge","single","Bodyweight lunge"],["Overhead lunge","single","Front rack lunge"],["Pistol","single","Box pistol"],["Step-up","single","Lower box"],["Bulgarian split squat","single","Split squat"]],
  "Kettlebell, dumbbell & odd object": [["Turkish get-up","carry","Half get-up"],["Farmers carry","carry","Lighter load or shorter distance"],["Sandbag carry","carry","Lighter bag"],["Sled push","mono","Lighter sled"],["Dumbbell thruster","press","Lighter dumbbells"],["Med ball clean","oly","Lighter ball"]],
};

const MOVES = {};
Object.entries(CATS).forEach(([cat,list])=>list.forEach(([name,fam,scale])=>{ MOVES[name]={...FAM[fam], fam, cat, scale}; }));
// movement-specific words from the TCC Level 2 examples
Object.assign(MOVES["Back squat"],{areas:["Lumbar spine","Knee","Ankle","Shoulder","Thoracic spine"],pre:["Hips","Posterior chain/hamstrings","Ankle","T-spine/shoulder"],ex:["Plate split squat or Bulgarian split","RDL or good morning","Eccentric calf raise or seated raise","T-spine loaded extension or KB arm bar"],met:{Contact:"Imagine you are an eagle gripping a branch.",Balance:"Stabilise before squatting as if you were standing on a ship in a storm.",Tension:"Try and twist the floor with your feet while bending the bar down.",Smoothness:"Move with fluidity like water running from a tap."}});
Object.assign(MOVES["Thruster"],{areas:["Shoulder/scapular","Elbow","Wrist","Lumbar spine","Knees"],pre:["Shoulder/scapular","Thoracic spine","Elbows","Hips/P-chain"],ex:["Shoulder distraction into wall angels","Loaded arm bar into eccentric plate","Banded supination into PVC rotations","Bulgarian squat or DB RDL"],met:{Contact:"Imagine your knuckles are pointing a laser beam to the sky.",Balance:"Feel your belly button get pulled straight to the floor in your thruster.",Tension:"Corkscrew your feet into the floor during your thruster."}});

// Benchmarks: typing the name fills in the movements and session type.
const BENCH = {
  "fran":["Fran: 21-15-9 Thrusters, Pull-ups","metcon",["Thruster","Pull-up"]],
  "grace":["Grace: 30 Clean and jerks for time","metcon",["Clean and jerk"]],
  "isabel":["Isabel: 30 Snatches for time","metcon",["Snatch"]],
  "diane":["Diane: 21-15-9 Deadlifts, Handstand push-ups","metcon",["Deadlift","Handstand push-up"]],
  "elizabeth":["Elizabeth: 21-15-9 Cleans, Ring dips","metcon",["Clean","Ring dip"]],
  "helen":["Helen: 3 rounds 400 m run, 21 KB swings, 12 Pull-ups","metcon",["Running","Kettlebell swing","Pull-up"]],
  "annie":["Annie: 50-40-30-20-10 Double-unders, Sit-ups","metcon",["Double-under","Sit-up"]],
  "karen":["Karen: 150 Wall balls for time","metcon",["Wall ball"]],
  "cindy":["Cindy: 20 min AMRAP 5 Pull-ups, 10 Push-ups, 15 Air squats","metcon",["Pull-up","Push-up","Air squat"]],
  "mary":["Mary: 20 min AMRAP 5 HSPU, 10 Pistols, 15 Pull-ups","metcon",["Handstand push-up","Pistol","Pull-up"]],
  "nancy":["Nancy: 5 rounds 400 m run, 15 Overhead squats","metcon",["Running","Overhead squat"]],
  "jackie":["Jackie: 1000 m row, 50 Thrusters, 30 Pull-ups","metcon",["Rowing","Thruster","Pull-up"]],
  "kelly":["Kelly: 5 rounds 400 m run, 30 Box jumps, 30 Wall balls","metcon",["Running","Box jump","Wall ball"]],
  "amanda":["Amanda: 9-7-5 Ring muscle-ups, Snatches","metcon",["Ring muscle-up","Snatch"]],
  "linda":["Linda: 10-1 Deadlift, Bench press, Clean","metcon",["Deadlift","Bench press","Clean"]],
  "eva":["Eva: 5 rounds 800 m run, 30 KB swings, 30 Pull-ups","metcon",["Running","Kettlebell swing","Pull-up"]],
  "chelsea":["Chelsea: EMOM 30 min 5 Pull-ups, 10 Push-ups, 15 Air squats","metcon",["Pull-up","Push-up","Air squat"]],
  "barbara":["Barbara: 5 rounds 20 Pull-ups, 30 Push-ups, 40 Sit-ups, 50 Air squats","metcon",["Pull-up","Push-up","Sit-up","Air squat"]],
  "angie":["Angie: 100 Pull-ups, 100 Push-ups, 100 Sit-ups, 100 Air squats","metcon",["Pull-up","Push-up","Sit-up","Air squat"]],
  "nicole":["Nicole: 20 min AMRAP 400 m run, max Pull-ups","metcon",["Running","Pull-up"]],
  "lynne":["Lynne: 5 rounds max Bench press, max Pull-ups","strength",["Bench press","Pull-up"]],
  "murph":["Murph: 1 mile run, 100 Pull-ups, 200 Push-ups, 300 Air squats, 1 mile run","metcon",["Running","Pull-up","Push-up","Air squat"]],
  "dt":["DT: 5 rounds 12 Deadlifts, 9 Hang power cleans, 6 Push jerks","metcon",["Deadlift","Hang clean","Push jerk"]],
};

const TEMPLATES_MORE = {
  benchmark:{name:"Benchmark / hero", desc:"Long warm-up and prep, one big effort, cool down", tl:[[0,"Introduction and the why","demo"],[3,"General warm-up (RAMP)","auto"],[10,"Visual movement assessment","auto"],[13,"Interventions","demo"],[20,"Scaling decisions","alt"],[25,"Specific warm-up","auto"],[32,"WOD","auto"],[52,"Equipment away","auto"],[55,"Cool down and reflection","demo"]], goal:"Intensity with the right scale, so the score means something next time.", approach:""},
  oly:{name:"Olympic lifting", desc:"Barbell warm-up, drills, build, then a short finisher", tl:[[0,"Introduction","demo"],[2,"General warm-up","auto"],[8,"PVC and empty bar drills","auto"],[15,"Interventions","demo"],[20,"Technique sets","alt"],[30,"Build to working weight","alt"],[45,"Short finisher","auto"],[52,"Equipment away","demo"],[55,"Cool down","demo"]], goal:"Speed and position before load.", approach:""},
  gymskill:{name:"Gymnastics skill", desc:"Shapes, drills, progressions, then a short piece", tl:[[0,"Introduction","demo"],[2,"Shapes warm-up","auto"],[8,"Skill assessment","auto"],[12,"Progressions","alt"],[25,"Practice sets","alt"],[38,"Short WOD","auto"],[52,"Equipment away","demo"],[55,"Cool down","demo"]], goal:"Virtuous positions before volume.", approach:""},
  partner:{name:"Partner or team", desc:"Brief, pair up, shared workout, debrief", tl:[[0,"Introduction and pairing","demo"],[3,"Partner warm-up","alt"],[10,"Movement assessment","auto"],[14,"Interventions","demo"],[20,"Scaling and strategy in pairs","alt"],[28,"WOD","auto"],[50,"Equipment away","demo"],[53,"Debrief","demo"]], goal:"Shared effort and communication.", approach:""},
  endurance:{name:"Endurance", desc:"Easy build, drills, intervals, flush", tl:[[0,"Introduction","demo"],[2,"Easy build","auto"],[10,"Drills","auto"],[16,"Interventions","demo"],[22,"Intervals","auto"],[50,"Easy flush","auto"],[55,"Cool down","demo"]], goal:"Pacing and position under fatigue.", approach:""},
  mobility:{name:"Mobility & recovery", desc:"Breathing, joint by joint, test and retest", tl:[[0,"Introduction","demo"],[3,"Breathing","alt"],[8,"Test","auto"],[12,"Joint by joint","alt"],[40,"Retest","auto"],[48,"Reflection","demo"]], goal:"Move better tomorrow than today.", approach:""},
};

window.LG_LIB = {FAM, CATS, MOVES, BENCH, TEMPLATES_MORE};
})();
