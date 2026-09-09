// netlify/functions/outreach-send.mjs
//
// Cold outreach sender. Multiple named campaigns live in this one file.
//
// USAGE
//   Dry run:  ?key=KEY&campaign=tgc-london-central
//   Send:     ?key=KEY&campaign=tgc-london-central&send=1
//   Retry:    ...&send=1&only=3,7
//   List:     ?key=KEY            (shows campaigns, sends nothing)
//
// A campaign name is REQUIRED before anything sends. An old bookmarked
// URL without one cannot fire a new list.
//
// ENV
//   RESEND_API_KEY   required
//   OUTREACH_KEY     required, guards the endpoint
//   CONFIRM_FROM     optional, defaults to info@birdboxcoaching.com
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//                    optional. If both are set, every send is logged to
//                    public.outreach_sent and an address already logged
//                    for that campaign is SKIPPED. Without them the
//                    function still works, but with no duplicate guard.

const FROM     = process.env.CONFIRM_FROM || "info@birdboxcoaching.com";
const REPLY_TO = "info@birdboxcoaching.com";
const BCC      = "info@birdboxcoaching.com";

// Signature: TGC logo, then name and credentials. Dark logo on white.
const TGC_LOGO = "https://birdbox-train.netlify.app/logos/tgc-dark.png";

const SIGNATURE = `
<div style="padding-top:22px;">
  <img src="${TGC_LOGO}" alt="The Gymnastics Course" width="120"
       style="width:120px;height:auto;display:block;border:0;">
  <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:15px;line-height:21px;color:#14100F;
              font-weight:bold;padding-top:14px;">Nathan Bird</div>
  <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:12px;line-height:18px;color:#6E7378;">
    BSc, MSc, PhD Candidate, CSCS, CCFT</div>
  <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:12px;line-height:18px;color:#6E7378;padding-top:6px;">
    BirdBox Coaching ·
    <a href="https://www.birdboxcoaching.com"
       style="color:#6E7378;">birdboxcoaching.com</a></div>
</div>`;

const SIGNATURE_TEXT =
  "\n\n--\nNathan Bird\nBSc, MSc, PhD Candidate, CSCS, CCFT\n" +
  "BirdBox Coaching\nbirdboxcoaching.com\n";

const CAMPAIGNS = {
  // Sent 9 Sept 2026. Locked so it can never fire again.
  "tcc-ipswich": {
    label: "TCC L1 Ipswich — SENT, LOCKED",
    locked: true,
    recipients: []
  },

  "tgc-london-central": {
    label: "TGC L1 London — central, wave one",
    recipients: [
    {
      gym: "FORT TRAINING",
      to: "info@fort.training",
      subject: "Gymnastics course in Southwark, 26-27 September",
      body: "Hi Anthony,\n\nNathan from BirdBox Coaching. We're running The Gymnastics Course Level\n1 at CrossFit Central London on Ewer Street, 26-27 September — about\nfifteen minutes from you, so I thought you'd want to know it was on.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "CROSSFIT SHAPESMITHS",
      to: "lee@crossfitshapesmiths.co.uk",
      subject: "Gymnastics coaching course, London, 26-27 September",
      body: "Hi Lee,\n\nNathan from BirdBox Coaching. We're at CrossFit Central London on 26-27\nSeptember with The Gymnastics Course Level 1. With the size of your\ncoaching team I thought it worth putting on your radar rather than\nletting you find out afterwards.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "CROSSFIT ALDGATE & FARRINGDON",
      to: "adambaileypt@hotmail.co.uk",
      subject: "Gymnastics coaching course, 26-27 September",
      body: "Hi Adam,\n\nNathan from BirdBox Coaching. We're running The Gymnastics Course Level\n1 at CrossFit Central London, 26-27 September. Writing to you once\nrather than to Aldgate and Farringdon separately.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "CROSSFIT VAUXHALL",
      to: "mike@crossfitvauxhall.co.uk",
      subject: "Gymnastics course down the road, 26-27 September",
      body: "Hi Michael,\n\nNathan from BirdBox Coaching. We're at CrossFit Central London with The\nGymnastics Course Level 1 on 26-27 September — a short hop from Miles\nStreet.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "SLEVEN CROSSFIT",
      to: "support@slevenfitness.com",
      subject: "Gymnastics coaching course, 26-27 September",
      body: "Hi Nicolas,\n\nNathan from BirdBox Coaching. We're running The Gymnastics Course Level\n1 at CrossFit Central London on 26-27 September, ten minutes up the road\nfrom Albert Embankment.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "GYMNASIUM",
      to: "nic@gymnasium.fit",
      subject: "Gymnastics coaching course, London, 26-27 September",
      body: "Hi Nic,\n\nNathan from BirdBox Coaching. Could you pass this to Jack if he's the\nright person? We're running The Gymnastics Course Level 1 at CrossFit\nCentral London on 26-27 September. With four sites there may be a\nconversation about doing this across the group rather than one coach at\na time.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "CROSSFIT ISLINGTON",
      to: "hello@crossfitislington.co.uk",
      subject: "Gymnastics coaching course, 26-27 September",
      body: "Hi Adam,\n\nNathan from BirdBox Coaching. We're at CrossFit Central London on 26-27\nSeptember with The Gymnastics Course Level 1. I noticed you already run\ngymnastics as a specialist class, which puts you ahead of most\naffiliates.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "CROSSFIT TUFNELL PARK",
      to: "info@crossfittufnellpark.com",
      subject: "Gymnastics coaching course, London, 26-27 September",
      body: "Hi Chi,\n\nNathan from BirdBox Coaching. We're running The Gymnastics Course Level\n1 at CrossFit Central London, 26-27 September. You describe the box as\nforged by members for members, which suggests your coaches came up\nthrough the gym — that's who this tends to suit best.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "THE WICK CROSSFIT",
      to: "harriet@thewickcrossfit.com",
      subject: "Gymnastics coaching course, 26-27 September",
      body: "Hi Harriet,\n\nNathan from BirdBox Coaching. We're at CrossFit Central London with The\nGymnastics Course Level 1 on 26-27 September. Happy to talk about\nWalthamstow too if it's the same team.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "E1 CROSSFIT",
      to: "ryan@e1crossfit.co.uk",
      subject: "Gymnastics coaching course, 26-27 September",
      body: "Hi Ryan,\n\nNathan from BirdBox Coaching. We're running The Gymnastics Course Level\n1 at CrossFit Central London on 26-27 September. Your beginners\nprogramme gets a lot of mentions, and that's the setting where this\nmaterial earns its keep.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "CROSSFIT NEON",
      to: "support@neoncrossfit.com",
      subject: "Gymnastics coaching course, London, 26-27 September",
      body: "Hi Mark,\n\nNathan from BirdBox Coaching. We're at CrossFit Central London on 26-27\nSeptember with The Gymnastics Course Level 1. Your members talk about\nthe coaching being attentive to detail on technique, which is the harder\nhalf of the job.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "CROSSFIT ONE MORE REP",
      to: "michaelbernardeli@hotmail.com",
      subject: "Gymnastics coaching course, 26-27 September",
      body: "Hi Michael,\n\nNathan from BirdBox Coaching. We're running The Gymnastics Course Level\n1 at CrossFit Central London, 26-27 September. You already list\ngymnastics alongside the CrossFit, Hyrox and weightlifting, so it's on\nthe timetable already.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "CROSSFIT 1864",
      to: "alfredo.e.yepes@gmail.com",
      subject: "Gymnastics coaching course, London, 26-27 September",
      body: "Hi Alfredo,\n\nNathan from BirdBox Coaching. We're at CrossFit Central London with The\nGymnastics Course Level 1 on 26-27 September. Twelve years affiliated\nand a big competitive roster, so you'll have athletes across a wide\nspan.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "LIVERPOOL ST CROSSFIT / 24N",
      to: "info@24nfitness.com",
      subject: "Gymnastics coaching course, 26-27 September",
      body: "Hi Ryan,\n\nNathan from BirdBox Coaching. We're running The Gymnastics Course Level\n1 at CrossFit Central London on 26-27 September. You already run\nspecialist gymnastics classes alongside the Olympic lifting, which most\naffiliates don't.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "CROSSFIT GMT",
      to: "mwilliams145@msn.com",
      subject: "Gymnastics coaching course, London, 26-27 September",
      body: "Hi Michael,\n\nNathan from BirdBox Coaching. We're at CrossFit Central London on 26-27\nSeptember with The Gymnastics Course Level 1 — an easy run from\nGreenwich. Your members single out the programming, which tells me you\nthink carefully about what goes up.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    },
    {
      gym: "CRANK / THE YARD PECKHAM",
      to: "train@crossfitpeckham.com",
      subject: "Gymnastics coaching course, 26-27 September",
      body: "Hi,\n\nNathan from BirdBox Coaching. We're running The Gymnastics Course Level\n1 at CrossFit Central London on 26-27 September — writing once rather\nthan to Crank and The Yard separately.\n\nThe Gymnastics Course isn't a weekend of drills to take home. It's a\nmethodology for reading movement and knowing what to do about it —\nso you can look at any athlete, on any apparatus, work out whether\nwhat's stopping them is mobility, strength or coordination, and pick\nthe intervention that actually changes it. That process is the thing\nyou leave with, and it applies to movements we never touch.\n\nWe build it across the whole catalogue: floor work, push-ups, rings\nfrom low through to strict and kipping muscle-ups, bar work, and\ninversions from headstand to handstand walking — underpinned by the\nbiomechanics of why a position breaks and where the force goes when\nit does. Spotting and self-spotting run through the whole weekend,\nboth as scaling tools and as the safest route to mastery. We finish\non programming: the rules, the variables, and how all of it changes\nwhat you write on the whiteboard on Monday morning.\n\nRunning alongside is the coaching craft itself — developing the\ncoach's eye so you see more across a busy room, external versus\ninternal cueing and what the evidence actually says, growth mindset\nand the language that builds it, and when feedback lands and when it\ndoesn't. It's for coaches who want the reasoning, not just the reps.\n\nTwo days, mostly on the floor. 14 CrossFit CEUs, no prerequisite.\n\nhttps://birdboxcoaching.com/c/tgc-l1-london-0926/\n\n£560, or £140 to hold a place. We can also split it over eight months\nwith no interest added — about £70 a month. That isn't on the booking\npage, so just ask if it would help.\n\nNo pitch — just so you know it's happening. Reply any time if you'd\nlike to talk it through."
    }
  ]
  }
};

// Blank-line separated paragraphs, hard wraps rejoined, URLs linked.
function toHtml(text) {
  const esc = (s) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const paras = text.split(/\n\s*\n/).map((p) => {
    let j = esc(p.split("\n").map((l) => l.trim()).join(" ")).trim();
    j = j.replace(/(https?:\/\/[^\s<]+)/g,
      '<a href="$1" style="color:#A31621;">$1</a>');
    return `<p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;` +
           `font-size:15px;line-height:23px;color:#14100F;margin:0 0 16px 0;">${j}</p>`;
  });
  return `<div style="max-width:520px;">\n${paras.join("\n")}\n${SIGNATURE}\n</div>`;
}

// Tries the usual names rather than assuming one, so a slightly
// different variable name doesn't silently disable the guard.
const URL_NAMES = ["SUPABASE_URL", "SUPABASE_PROJECT_URL", "SUPABASE_API_URL"];
const KEY_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY",
                   "SUPABASE_SERVICE_ROLE", "SERVICE_ROLE_KEY"];

const pick = (names) => {
  for (const n of names) if (process.env[n]) return { name: n, value: process.env[n] };
  return null;
};

const sb = () => {
  const u = pick(URL_NAMES);
  const k = pick(KEY_NAMES);
  if (!u || !k) return null;
  return { url: u.value.replace(/\/$/, ""), key: k.value,
           via: `${u.name} + ${k.name}` };
};

async function alreadySent(campaign) {
  const s = sb();
  if (!s) return null;
  try {
    const res = await fetch(
      `${s.url}/rest/v1/outreach_sent?campaign=eq.${encodeURIComponent(campaign)}&select=email`,
      { headers: { apikey: s.key, Authorization: `Bearer ${s.key}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return new Set(rows.map((r) => String(r.email).toLowerCase()));
  } catch {
    return null;
  }
}

async function logSend(campaign, email, resendId) {
  const s = sb();
  if (!s) return;
  try {
    await fetch(`${s.url}/rest/v1/outreach_sent`, {
      method: "POST",
      headers: {
        apikey: s.key,
        Authorization: `Bearer ${s.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ campaign, email, resend_id: resendId })
    });
  } catch {
    // Logging must never break a send that already succeeded.
  }
}

async function sendOne(r) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `Nathan Bird <${FROM}>`,
      to: [r.to],
      bcc: [BCC],
      reply_to: REPLY_TO,
      subject: r.subject,
      html: toHtml(r.body),
      text: r.body + SIGNATURE_TEXT
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Resend returned ${res.status}`);
  return data.id || "sent";
}

export default async (request) => {
  const url = new URL(request.url);
  const expected = process.env.OUTREACH_KEY;
  if (!expected || url.searchParams.get("key") !== expected) {
    return new Response("Not found", { status: 404 });
  }

  const name = url.searchParams.get("campaign");

  if (!name) {
    return Response.json({
      error: "No campaign named. Nothing sent.",
      campaigns: Object.entries(CAMPAIGNS).map(([k, c]) => ({
        campaign: k, label: c.label,
        recipients: c.recipients.length,
        locked: !!c.locked
      }))
    }, { status: 400 });
  }

  const campaign = CAMPAIGNS[name];
  if (!campaign) {
    return Response.json({
      error: `Unknown campaign "${name}"`,
      known: Object.keys(CAMPAIGNS)
    }, { status: 400 });
  }
  if (campaign.locked) {
    return Response.json({
      error: `Campaign "${name}" is locked and cannot be sent again.`
    }, { status: 400 });
  }
  if (!process.env.RESEND_API_KEY) {
    return Response.json({ error: "RESEND_API_KEY is not set" }, { status: 500 });
  }

  const live = url.searchParams.get("send") === "1";
  const onlyParam = url.searchParams.get("only");
  const only = onlyParam
    ? onlyParam.split(",").map((n) => parseInt(n.trim(), 10)).filter(Boolean)
    : null;

  const conn = sb();
  const sentSet = await alreadySent(name);

  const queue = campaign.recipients
    .map((r, i) => ({ ...r, n: i + 1 }))
    .filter((r) => !only || only.includes(r.n));

  const results = [];

  for (const r of queue) {
    if (sentSet && sentSet.has(r.to.toLowerCase())) {
      results.push({ n: r.n, gym: r.gym, to: r.to, status: "skipped-already-sent" });
      continue;
    }
    if (!live) {
      results.push({ n: r.n, gym: r.gym, to: r.to, subject: r.subject, status: "dry-run" });
      continue;
    }
    try {
      const id = await sendOne(r);
      await logSend(name, r.to, id);
      results.push({ n: r.n, gym: r.gym, to: r.to, status: "sent", id });
    } catch (err) {
      results.push({ n: r.n, gym: r.gym, to: r.to, status: "FAILED",
                     error: String(err.message || err) });
    }
    await new Promise((res) => setTimeout(res, 250));
  }

  const failed = results.filter((r) => r.status === "FAILED");

  return Response.json({
    campaign: name,
    label: campaign.label,
    mode: live ? "LIVE" : "dry-run",
    duplicateGuard: sentSet
      ? `on — via ${conn.via}`
      : conn
        ? "OFF — Supabase env vars found but the outreach_sent table did not respond. Run the SQL."
        : `OFF — no Supabase env vars matched. Looked for: ${URL_NAMES.join("/")} and ${KEY_NAMES.join("/")}`,
    from: FROM, replyTo: REPLY_TO, bcc: BCC,
    queued: queue.length,
    sent: results.filter((r) => r.status === "sent").length,
    skipped: results.filter((r) => r.status === "skipped-already-sent").length,
    failed: failed.length,
    retryFailedWith: failed.length
      ? `?key=...&campaign=${name}&send=1&only=${failed.map((f) => f.n).join(",")}`
      : null,
    results
  });
};
