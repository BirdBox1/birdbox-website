import sys, html
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from exercises import EX
import json, os
_X = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'extra-lines.json')
EXTRA = {int(k): v for k, v in json.load(open(_X)).items()} if os.path.exists(_X) else {}  # extra write-in lines so the last movement on a page runs to the bottom

OUT = sys.argv[1]
e = html.escape

def lines(n):
    return '<div class="lines">' + '<div class="ln"></div>' * n + '</div>'

def img(p, k):
    return f'img/p{p:02d}-{k:02d}.jpg'

def exercise(i, kind, title, src, bullets):
    p, ks = src
    lst = "ol" if kind == "strip-ol" else "ul"
    bl = f'<{lst} class="bullets">' + "".join(f"<li>{e(b)}</li>" for b in bullets) + f"</{lst}>"
    if kind == "side":
        return (f'<div class="ex side" id="ex{i}"><figure><img src="{img(p, ks[0])}" alt=""></figure>'
                f'<div class="ex-text"><h3>{e(title)}</h3>{bl}{lines(4 + EXTRA.get(i, 0))}</div></div>')
    if kind == "side2":
        pics = "".join(f'<img src="{img(p, k)}" alt="">' for k in ks)
        return (f'<div class="ex side two" id="ex{i}"><figure class="pair">{pics}</figure>'
                f'<div class="ex-text"><h3>{e(title)}</h3>{bl}{lines(4 + EXTRA.get(i, 0))}</div></div>')
    n = len(ks)
    per = 5 if n == 10 else n
    pics = "".join(f'<img src="{img(p, k)}" alt="">' for k in ks)
    return (f'<div class="ex strip" id="ex{i}"><h3>{e(title)}</h3>'
            f'<figure class="strip n{per}">{pics}</figure>{bl}{lines(3 + EXTRA.get(i, 0))}</div>')

ex_html = "\n".join(exercise(i, *x) for i, x in enumerate(EX, 1))

CHAPTERS = ["INTRODUCTION", "OUR MISSION", "DEFINITIONS &amp; TERMINOLOGY", "METHODOLOGY OUTLINE",
            "TRAINING RULES", "MOVEMENT DEVELOPMENT", "MOVEMENT PROGRESSION GUIDE", "PROGRAMMING"]
toc = "".join(f'<li><span class="toc-n">{i}</span><span class="toc-t">{t}</span><span class="toc-p" data-ch="Chapter {i}"></span></li>'
              for i, t in enumerate(CHAPTERS, 1))

def ch(i):
    return f'<section class="chapter" id="ch{i}"><header><p class="chapter-no">Chapter {i}</p><h1>{CHAPTERS[i-1]}</h1></header>\n'

page = f'''<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>The Gymnastics Course – Seminar Guide</title>
<link rel="stylesheet" href="../manual.css">
<link rel="stylesheet" href="tgc.css">
<script>
  // Build editions: #print = Bookvault softback interior (bleed, no cover); anything else = downloadable PDF (light cover)
  const edition = location.hash.startsWith("#print") ? "print" : "web";
  document.documentElement.classList.add(edition);
  if (location.hash === "#print-odd") document.documentElement.classList.add("odd");
  if (edition === "print") document.write('<link rel="stylesheet" href="../print-bleed.css">');
</script>
</head>
<body>
<!-- The Gymnastics Course participant manual (Seminar Guide). Source of truth for both the downloadable PDF
     and the printed softback. Wording copied verbatim from the 2023 English Seminar Guide
     (Illustrator PDF, 37 US Letter pages, live as manuals/tgc-l1-manual-en.pdf). Nathan approves every change
     before it goes in. Build: manual-src/build.sh tgc-l1 -->
<div class="cover">
  <div class="photo" style="background-image:url('img/cover-top.jpg')"></div>
  <div class="photo2" style="background-image:url('img/cover-photo.jpg')"></div>
  <div class="body">
    <img class="logo dark" src="../../brand/tgc-mark.png" alt="TGC">
    <img class="logo light" src="img/tgc-logo-on-light.png" alt="TGC">
    <p class="kicker">Seminar Guide</p>
    <h1 class="title" data-c="title">CrossFit Gymnastics Course</h1>
  </div>
</div>
<section class="halftitle"><p>Seminar Guide</p></section>
<section class="titlepage">
<img class="tp-logo" src="img/tgc-logo-on-light.png" alt="TGC">
<p class="tp-kicker">The Gymnastics Course</p>
<h1 class="tp-title">Seminar Guide</h1>
<p class="tp-sub">Participant Manual</p>
<div class="tp-foot"><img class="tp-ceu" src="img/ceu-approved.png" alt="CrossFit Approved CEU Provider"><p>2026 edition</p><p>© 2026 BirdBox Coaching Limited. All rights reserved.<br>No part of this manual may be copied or shared without written permission.</p><p>BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland<br>birdboxcoaching.com</p></div>
</section>
<section class="toc"><h1 class="toc-h">Contents</h1><ol class="toc-list">{toc}</ol></section>

{ch(1)}<p>The Gymnastics Course is a professional coaching development seminar. Led and developed by a team of expert-level coaches from around the world aimed to create and elicit potential from professional trainers, coaches, gym owners and athletes. We hope to play a role in your ability to better train and grow towards your fitness goals. Our goal is to utilize the information and methodology of gymnastics and body movement to augment your training and coaching as we have for over a decade.</p>
<figure class="team"><img src="img/photo-team-2026.jpg" alt="The TGC coaching team, 2026"></figure>
<p>This PDF is a supporting document for things you will discover when attending our live seminar. This supporting document has been designed to help prompt, remind, and facilitate learning. Allowing you to emerge within the learning environment and become an active learner when attending our course. Please note that this PDF does not capture every single discussed element in our course.</p>
<p>Suppose you would like to explore a more profound learning opportunity with The Gymnastics Course, enhancing your live seminar learning. In that case, you can also learn interactively online with our self-paced online course. We provide a significant discount to all live seminar participants, helping to build a deep and well-rounded learning experience. The following PDF will have images and explanations that follow our critical points for the CrossFit Gymnastics seminar. There will be allocated spaces through this PDF for you to add your own notes as you pass through this course. Aiming to help you actively retain information in the best possible way.</p>
</section>

{ch(2)}<ol class="mission-list">
<li>We aim to help you understand the benefits of pursuing virtuosity, especially applied to your movement and gymnastics.</li>
<li>We endeavor to give you the ability to diagnose gymnastic movement faults based on assessing limitations, establish appropriate interventions and progressions, and successfully implement gymnastic training and coaching that improves safety, efficacy, and efficiency.</li>
<li>We will work to create substantial coaches' eye development that will enhance your ability to diagnose movement faults in yourself and others by simplifying gymnastic points of performance, understanding basic individual anthropometrics and physics, and the ability to think critically about movement.</li>
<li>We aim to help you understand the physical and neurological benefits of building strict movements before kipping movements, especially as applied to the pursuit of virtuosity.</li>
<li>We will help you cultivate a growth mindset regarding your own learning and performance.</li>
</ol>
<figure class="fill-bottom"><img src="img/photo-p03.jpg" alt=""></figure>
</section>

{ch(3)}<div class="terms">
<p class="term"><b>An Athlete</b> - An athlete is someone with the elite ability to compete and win against others. A relative marker for an athlete would be competing at the CrossFit Games or taking a top 5 position at a CrossFit sanctioned event.</p>
<p class="term"><b>Needs Analysis</b> - Needs Analysis is a formal, systematic process of identifying and evaluating training that should be done to help develop an athlete towards the requirements of their sport, life or injury.</p>
<p class="term"><b>Rules</b> - A rule is based on principles; they are suggested standards to help correct and safely develop an athlete; a rule can be broken and is governed by yourself or a coach.</p>
<p class="term"><b>Laws</b> - A law is a much stricter rule that is bound to be adhered. Breaking the law is not an option as this is restricted by science. For example, Newton's gravitational laws cannot be changed or bent.</p>
<p class="term"><b>Virtuosity</b> - Virtuosity, though, is a different beast altogether. Virtuosity is defined in gymnastics as “performing the common uncommonly well.” (Greg Glassman, 2005)</p>
<p class="term"><b>Mastery</b> - Mastery is defined as “the improvement of an athlete’s skill to effectively use his or her motor potential” (Birdbox coaching development, 2020)</p>
<p class="term"><b>Active Tissue</b> - Active tissue is the ability to contract muscles helping to maintain shapes, as an entirety, to help remain as one solid unit.</p>
<p class="term"><b>Hollow</b> - A position used to create stability, characterized by strong midline contraction with active tissue from toes to fingers. Remember that a hollow position is a straight line with a posterior pelvic tilt.</p>
<p class="term"><b>Strict</b> - Movement absent a kip. The athlete relies on muscle control and strength to complete the movement.</p>
<p class="term"><b>Kip</b> - An aggressive change of direction at speed that leads to a change in plane or position to achieve a movement pattern.</p>
<p class="term"><b>Form</b> - The manner or method of doing a movement correctly while striving for perfection.</p>
<p class="term"><b>Static Apparatus</b> - Stable and does not move (floor and bars).</p>
<p class="term"><b>Dynamic Apparatus</b> - Unstable and moves (rings).</p>
<p class="term"><b>Mobility</b> - Movement around a joint.</p>
<p class="term"><b>Active Flexibility</b> - Contracting opposing muscles to stretch or hold a position.</p>
<p class="term"><b>Passive Flexibility</b> - Stretching a muscle that does not require contraction of opposing muscles.</p>
<p class="term"><b>ROM</b> - Range of motion.</p>
<p class="term"><b>EROM</b> - Extended range of motion.</p>
<p class="term"><b>Spotting</b> - Giving assistance to an athlete if needed as part of a progression or to prevent injury.</p>
<p class="term"><b>Tension</b> - Tension, as a word, can be defined as "the state of being stretched tight" and the opposite would be "slackness" or "looseness" (Fowler &amp; Crystal, 2010).</p>
</div>
<figure class="fill-bottom"><img src="img/photo-p05.jpg" alt=""></figure>
</section>

{ch(4)}<h2>The Gymnastics Course Theoretical Hierarchy of Development</h2>
<div class="pyr-split">
<div><p>We at The Gymnastics Course highlight that CrossFit is a core strength and conditioning training program. Therefore, when working with an athlete or client, we should do a needs analysis. Understanding an athlete's needs and requirements, their sport or life requirements, and designing their training program around the discrepancies between the two.</p>
<p>Gymnastics is purely bodyweight movement. Consequently, how you move your body through space, we theorize that we must be focusing on gymnastics before metabolic conditioning as this is our basis for movement, biomechanics. If an individual was to have poor biomechanics (human movement), it can be suggested the ability to achieve metabolic conditioning would be void or at risk of injury.</p></div>
<figure class="pyramid-img"><img src="img/original-pyramid.png" alt="Hierarchy: nutrition, gymnastics, metabolic conditioning, weightlifting and throwing, sport"></figure>
</div>
<figure class="fill-bottom"><img src="img/photo-p06.jpg" alt=""></figure>
</section>

{ch(5)}<p class="rule">Rule number 1: <span>Static before dynamic</span></p>
<p class="rule">Rule number 2: <span>Strict before kipping</span></p>
<p>Strength is required for proper form, and proper form is required to demonstrate body control. As such, gymnastics has a clear emphasis on strength in bodyweight movements. More than anything else, strict form establishes mastery in a movement, and for this reason, we promote strict movement before we apply momentum. The strength gained from mastering the strict movements are well worth the effort, and the possibility of injury is reduced substantially when strict movements are practiced first. Small moves will bring great rewards. You do not rush these movements. You learn them and earn them!</p>
<p>To present mastery in all our movements, we must have virtuous body awareness and control. To gain this body awareness and control, we must execute all actions with proper form. To obtain the proper form, we must have the prerequisite strength through the full range of motion, start to finish. Any lack of strength through a range of motion will compromise a position that causes forces to be sent in the wrong directions. Alternatively, no action will happen as the strength is nil.</p>
<p>When aiming to develop an athlete’s movement, we explain a process allowing coaches to find greater effectiveness. Options as a coach for movement development changes are coaching cues, coaching constraints, and coaching interventions.</p>
<blockquote class="big">“Strength is imperative for Proper Form,<br>and Proper Form is imperative for Body Awareness and Control.”</blockquote>
<figure class="quote-photo"><img src="img/photo-p07.jpg" alt=""></figure>
<h2 class="newpage">TRAINING RULES CONTINUED…</h2>
<p class="rule">Rule number 3:<br><span>Build an isometric base.</span></p>
<p class="rule">Rule number 4:<br><span>Use eccentric loading as a strength and positional development tool.</span></p>
<p>Isometric contractions are where the muscle is under load or tension by remaining the same length. Isometric training is essential for joint stabilization and connective tissue development. Eccentric loading is where a muscle is under load or tension, but the muscle is lengthening. Eccentric will lead to many noted benefits, specifically muscle architecture changes leading to strength development. Concentric contractions are where a muscle is under load or tension, but the muscle shortens at the same time. We perform concentric contractions in CrossFit® all the time. Thus, we must consider how we develop strength in our members and the risks of each contraction tool—these risks are outlined to you during our programming lecture on the course.</p>
<div class="notes-inline">{lines(9)}</div>
</section>

{ch(6)}<p><b><i>Coaching cues</i></b> are directed at the athlete to make a positional change by using verbal communication.</p>
<p><b><i>Coaching constraints</i></b> are tasks or exercises that do not intervene with the length or strength of a muscle but help make an individual work hard towards better positions within a chosen movement.</p>
<p><b><i>Coaching interventions</i></b> are used when cues and constraints become ineffective. Leading to the change in length or strength of muscle tissue, aiming to improve movements.</p>
<p>Throughout the live seminar, we provide multiple aspects of coaching cues, interventions and constraints. An illustration of how to effectively decide when to use a cue, constraint or intervention can be seen below.</p>
<figure class="mda"><img src="img/original-movement-development.png" alt="Movement development approach flow chart"></figure>
</section>

{ch(7)}<p>As an athlete and/or coach, it is crucial to understand positions in movements. Here we will be presenting a series of images that showcase key positions for development. By understanding and practicing these key positions, you can develop your skills, improve your performance, and reduce the risk of injury.</p>
<p>We encourage you to proactively add notes to each image if we go through them in the seminar and incorporate these positions into your training routine.</p>
<h2 class="mv">Movements</h2>
{ex_html}
</section>

{ch(8)}<p>During the programming lecture we go much more in depth. Here we would like to share some key elements from this lecture. We cover a lot of important information, but here we are highlighting a few key takeaways.</p>
<h2>Linear Progression</h2>
<p>Linear progression is a training method that involves gradually increasing the difficulty or volume of an exercise over time to stimulate progress and adaptation. This method is commonly used in strength training to help athletes develop the strength and endurance necessary to perform more advanced movements or lifts. By using linear progression in training, athletes can gradually increase their strength and endurance in a safe and effective way. It's important to note that linear progression should be used in conjunction with proper form and technique to avoid injury and ensure optimal results. We like to use this linear progression method in our gymnastics programs.</p>
<p>Many people use percentages in their weightlifting, but not many people use percentages in their gymnastics. In gymnastics, intensity is the % of 1RM or TUT (time under tension). The total volume is the total amount of reps or total time under tension.</p>
<p>Below you will find two linear progression examples for strict pull-up development. As you can see, we always frontload the first set of the session so we can create progressive overload. We like to start this progression with 40%. The first example below is based on a max set of 10 strict virtuous pull-ups.</p>
<div class="keep"><p class="tcap">Linear progression example with % of 1RM:</p>
<table class="prog"><thead><tr><th>Week</th><th>Session 1</th><th>Session 2</th><th>Session 3</th></tr></thead><tbody>
<tr><td>1.</td><td>4-4-4</td><td>5-4-4</td><td>5-5-4</td></tr>
<tr><td>2.</td><td>5-5-5</td><td>6-5-5</td><td>6-6-5</td></tr>
<tr><td>3.</td><td>6-6-6</td><td>7-6-6</td><td>7-7-6</td></tr>
<tr><td>4.</td><td>7-7-7</td><td>8-7-7</td><td>8-8-7</td></tr>
<tr><td>5.</td><td>8-8-8</td><td>9-8-8</td><td>9-9-8</td></tr>
<tr><td>6.</td><td colspan="3">Retest</td></tr>
</tbody></table>
<p class="foot">*Start this cycle again with your new number of your max set.</p></div>
<p>If you are unable to do a strict pull-up, we need to develop strength and we will do this by working on time under tension. In this case, start with the progression example below. The first number is for a chin-over-bar hold and the second number is for the eccentric. Jump up to position to start your set. If you are unable to control and hold these positions with your full bodyweight, scale it down by using a toe-spot.</p>
<div class="keep"><p class="tcap">Linear progression example with TUT:</p>
<table class="prog"><thead><tr><th>Week</th><th>Session 1</th><th>Session 2</th><th>Session 3</th></tr></thead><tbody>
<tr><td>1.</td><td>3/3 - 3/3 - 3/3</td><td>4/4 - 3/3 - 3/3</td><td>4/4 - 4/4 - 3/3</td></tr>
<tr><td>2.</td><td>4/4 - 4/4 - 4/4</td><td>5/5 - 4/4 - 4/4</td><td>5/5 - 5/5 - 4/4</td></tr>
<tr><td>3.</td><td>5/5 - 5/5 - 5/5</td><td>6/6 - 5/5 - 5/5</td><td>6/6 - 6/6 - 5/5</td></tr>
<tr><td>Retest</td><td colspan="3" class="note">Retest your strict pull-up. If you are able to do one, continue with session 1, week 4. If you are unable to do one, continue with front loading the seconds on your set. If you used a toe-spot the first three weeks, start over with week 1 and use your full bodyweight.</td></tr>
<tr><td>4.</td><td>1-1-1</td><td>2-1-1</td><td>2-2-1</td></tr>
<tr><td>5.</td><td>2-2-2</td><td>3-2-2</td><td>3-3-2</td></tr>
<tr><td>6.</td><td>3-3-3</td><td>4-3-3</td><td>4-4-3</td></tr>
</tbody></table>
<p class="foot">*If you managed to complete the full progression, you can now start over with the % example.</p></div>
<p>You can apply this progression to every gymnastics movement. This is a very simple approach and easy to apply in your programming. Maybe even for the most of your membership base the best approach.</p>
<h2>Volume, Intensity and Frequency</h2>
<p>If you want to play with volume, intensity and frequency for individual programming and you want to understand this more in depth, below you can find another example of a linear progression with more variability in volume, intensity and frequency.</p>
<div class="keep"><p class="foot">*Example below is based on a max set of 10 strict virtuous pull-ups.</p>
<table class="prog vif"><thead><tr><th>Week</th><th>Intensity</th><th>Frequency</th><th>Volume</th></tr></thead><tbody>
<tr><td>1.</td><td>3 sets at 40%<br>4-4-4</td><td>2 sessions<br>per week</td><td>24 reps</td></tr>
<tr><td>2.</td><td>3 sets at 40%<br>4-4-4</td><td>2 sessions<br>per week</td><td>24 reps</td></tr>
<tr><td>3.</td><td>3 sets at 50%<br>5-5-5</td><td>2 sessions<br>per week</td><td>30 reps</td></tr>
<tr><td>4.</td><td>3 sets at 50%<br>5-5-5</td><td>2 sessions<br>per week</td><td>30 reps</td></tr>
<tr><td>5.</td><td>4 sets at 40%<br>4-4-4-4</td><td>2 sessions<br>per week</td><td>32 reps</td></tr>
<tr><td>6.</td><td>4 sets at 40%<br>4-4-4-4</td><td>2 sessions<br>per week</td><td>32 reps</td></tr>
<tr><td>7.</td><td>3 sets at 40%<br>4-4-4</td><td>3 sessions<br>per week</td><td>36 reps</td></tr>
<tr><td>8.</td><td>3 sets at 40%<br>4-4-4</td><td>3 sessions<br>per week</td><td>36 reps</td></tr>
</tbody></table></div>
<p>As you can see the intensity, volume and frequency is the same for every two weeks. After the first two weeks we increased the intensity. After the third and fourth week we reduced the intensity for week five and six but increased the volume. In week seven and eight we increased the frequency. By playing around with volume, intensity, and frequency you can see how those numbers are going up. You can apply this as well to isometric contractions or eccentric loading.</p>
<p>In the example you can see the volume in gymnastics is low. In weightlifting you will not gain overload by doing it at this volume. In gymnastics we gain overload in adaptations by time under tension and tempo work, not by volume. Occasionally we can use higher volume, but it is the time under tension and tempo we really need to be using.</p>
<p>That means that if we do our set of 4-4-4 strict pull-ups we will hang in a hollow for 5 seconds, do a 3 sec concentric, hold our chin above the bar for 3 seconds, do a 5 sec eccentric down for all the 4 repetitions. We want to train positions and perfection, not volume and intensity.</p>
<div class="notes-inline">{lines(10)}</div>
</section>
<section class="endblank"></section>
<script>
// Contents page numbers: worked out after layout by the page-number pass in build (see tgc.css note)
</script>
</body>
</html>
'''
open(OUT, "w").write(page)
print("wrote", OUT)
