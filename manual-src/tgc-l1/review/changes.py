# Proposed changes to the TGC Seminar Guide. Nothing here goes into manual.html until Nathan approves it.
# find/repl work on manual.html source. "all": replace every occurrence. "show": text to search for in the
# old PDF (defaults to `now`), "seek": text to search for in the new PDF (defaults to `proposed`).
C = []
def add(id, type, now, proposed, note, find=None, repl=None, all=False, show=None, seek=None):
    C.append(dict(id=id, type=type, now=now, proposed=proposed, note=note,
                  find=find if find is not None else now, repl=repl if repl is not None else proposed,
                  all=all, show=show, seek=seek))

# ---- Cover, title page, CrossFit ----
add("g001", "crossfit", "Cover: CrossFit Gymnastics Course", "Cover: The Gymnastics Course",
    "TGC is stand-alone now", find='data-c="title">CrossFit Gymnastics Course<', repl='data-c="title">The Gymnastics Course<',
    show="CrossFit Gymnastics Course", seek="THE GYMNASTICS COURSE")
add("g002", "images", "Cover photo: whiteboard strip with the CrossFit Specialty Courses badge",
    "Cover photo: the TGC hollow-rock photo from the website (no CrossFit badge)",
    "Already in the new design. Keep it, or tell me another photo", find="", repl="", show="", seek="")
add("g003", "layout", "(new) Title page: 'The Gymnastics Course · Seminar Guide · Participant Manual', 2026 edition, © BirdBox Coaching Limited",
    "Keep this title page", "Same as the TCC manual. Is BirdBox Coaching Limited the right owner for TGC?",
    find="", repl="", show="", seek="Participant Manual")
add("g004", "layout", "(new) Contents page and chapter numbers 1 to 8", "Keep", "Same as the TCC manual",
    find="", repl="", show="", seek="Contents")
add("g005", "crossfit", "the CrossFit Gymnastics seminar", "The Gymnastics Course seminar",
    "TGC is stand-alone now", find="our critical points for the CrossFit Gymnastics seminar", repl="our critical points for The Gymnastics Course seminar",
    show="CrossFit Gymnastics seminar", seek="The Gymnastics Course seminar")
add("g006", "crossfit", "competing at the CrossFit Games or taking a top 5 position at a CrossFit sanctioned event",
    "competing at the highest level of their sport, or finishing in the top 5 at a national or international event",
    "CrossFit mention. Keep, reword (my suggestion) or remove?",
    find="competing at the CrossFit Games or taking a top 5 position at a CrossFit sanctioned event",
    repl="competing at the highest level of their sport, or finishing in the top 5 at a national or international event")
add("g007", "crossfit", "CrossFit is a core strength and conditioning training program",
    "", "CrossFit mention, and the start of the methodology. Keep, reword or remove? Tell me which",
    find="", repl="", seek="CrossFit is a core strength")
add("g008", "images", "Hierarchy pyramid in CrossFit's colours (CrossFit's 'Theoretical Hierarchy of Development' graphic)",
    "Redrawn in TGC red, same five levels, Gymnastics highlighted",
    "Their graphic in a book we sell is a copyright risk; the idea itself is fine to teach",
    find='<figure class="pyramid-img"><img src="img/original-pyramid.png" alt="Hierarchy: nutrition, gymnastics, metabolic conditioning, weightlifting and throwing, sport"></figure>',
    repl='<figure class="pyramid-img">@@PYRAMID@@</figure>', show="", seek="GYMNASTICS")
add("g009", "crossfit", "We perform concentric contractions in CrossFit® all the time.",
    "We perform concentric contractions in training all the time.", "CrossFit mention")
add("g010", "images", "Movement development diagram: dark screenshot with the CrossFit badge and a small TGC logo in the corners",
    "Redrawn as a clean flow chart, same words, no badges, prints sharp",
    "Same boxes and arrows, so nothing in the method changes",
    find='<figure class="mda"><img src="img/original-movement-development.png" alt="Movement development approach flow chart"></figure>',
    repl='<figure class="mda">@@MDA@@</figure>', show="", seek="MOVEMENT DEVELOPMENT APPROACH")

# ---- Introduction ----
add("g011", "grammar", "Led and developed by a team of expert-level coaches from around the world aimed to create",
    "It is led and developed by a team of expert-level coaches from around the world, and aims to create",
    "Sentence fragment")
add("g012", "spelling", "utilize", "utilise", "British spelling",
    find="Our goal is to utilize", repl="Our goal is to utilise", show="utilize", seek="utilise")
add("g013", "consistency", "This PDF is a supporting document … this PDF does not capture … The following PDF will have … through this PDF",
    "This manual is a supporting document … this manual does not capture … The following pages have … through this manual",
    "It's a printed book now as well as a download", find=r"\b([Tt]his|following) PDF\b", repl=r"\1 manual", all="re", show="This PDF", seek="This manual")
add("g014", "spelling", "Allowing you to emerge within the learning environment",
    "This allows you to immerse yourself in the learning environment",
    "Wrong word ('immerse' is meant) and a sentence fragment")
add("g015", "clarity", "Suppose you would like to explore a more profound learning opportunity with The Gymnastics Course, enhancing your live seminar learning. In that case, you can also learn",
    "If you would like to explore The Gymnastics Course in more depth and build on your live seminar learning, you can also learn",
    "Reads more naturally")
add("g016", "grammar", "The following manual will have images and explanations that follow",
    "The following pages have images and explanations that follow", "Tense (and follows on from the PDF change)", find="The following PDF will have", repl="The following pages have",
    show="The following PDF will have", seek="The following pages have")
add("g017", "grammar", "Aiming to help you actively retain information in the best possible way.",
    "This aims to help you actively retain information in the best possible way.", "Sentence fragment")

# ---- Mission ----
add("g018", "spelling", "We endeavor", "We endeavour", "British spelling")
add("g019", "grammar", "substantial coaches' eye development", "substantial coach's eye development",
    "Apostrophe: 'coach's eye' (same fix as TCC)")

# ---- Definitions ----
add("g020", "consistency", "Term - definition (hyphen after each term)", "Term – definition (en dash)",
    "Same as the TCC manual", find="</b> - ", repl="</b> – ", all=True, show="", seek="")
add("g021", "grammar", "a much stricter rule that is bound to be adhered.", "a much stricter rule that must be adhered to.",
    "Missing 'to'")
add("g022", "clarity", "Virtuosity, though, is a different beast altogether.", "Virtuosity is a different beast altogether.",
    "'Though' doesn't refer back to anything here")
add("g023", "consistency", "(Birdbox coaching development, 2020)", "(BirdBox Coaching Development, 2020)",
    "Company name spelling, as in TCC")
add("g024", "spelling", "characterized", "characterised", "British spelling")
add("g025", "clarity", "Movement absent a kip.", "Movement without a kip.", "Plainer")

# ---- Methodology ----
add("g026", "grammar", "Understanding an athlete's needs and requirements, their sport or life requirements, and designing",
    "This means understanding an athlete's needs and requirements, their sport or life requirements, and designing",
    "Sentence fragment")
add("g027", "spelling", "program / programs", "programme / programmes", "British spelling (training programme). Three places",
    find=r"\bprogram(s?)\b", repl=r"programme\1", all="re", show="training program", seek="training programme")
add("g028", "clarity", "Consequently, how you move your body through space, we theorize that we must be focusing on gymnastics",
    "It is about how you move your body through space. Consequently, we theorise that we must focus on gymnastics",
    "Sentence doesn't hold together; also British 'theorise'")

# ---- Training rules ----
add("g029", "grammar", "The strength gained from mastering the strict movements are well worth the effort",
    "The strength gained from mastering the strict movements is well worth the effort", "'Strength … is'")
add("g030", "spelling", "practiced first", "practised first", "British spelling (verb)")
add("g031", "clarity", "Alternatively, no action will happen as the strength is nil.",
    "Or no movement happens at all, because the strength isn't there.", "Plainer")
add("g032", "layout", "Heading 'TRAINING RULES CONTINUED…'", "Remove: rules 3 and 4 follow straight on",
    "Only needed when every page had a fixed layout", find='<h2 class="newpage">TRAINING RULES CONTINUED…</h2>',
    repl='', show="TRAINING RULES CONTINUED", seek="Rule number 3")
add("g033", "spelling", "stabilization", "stabilisation", "British spelling")
add("g034", "grammar", "Eccentric will lead to many noted benefits", "Eccentric loading leads to many noted benefits",
    "Missing word")

# ---- Movement development ----
add("g035", "grammar", "Leading to the change in length or strength of muscle tissue, aiming to improve movements.",
    "They lead to a change in the length or strength of muscle tissue, aiming to improve movements.", "Sentence fragment")

# ---- Movement progression guide ----
add("g036", "spelling", "practicing these key positions", "practising these key positions", "British spelling (verb)")
add("g037", "consistency", "Colon after every movement name (Tuck Hollow:)", "No colon (TUCK HOLLOW)",
    "They're headings now", find=":</h3>", repl="</h3>", all=True, show="", seek="")
add("g038", "consistency", "Tuck Hollow / One Leg Straight Hollow / Full Hollow / Supported Arch / Full Arch (capitals)",
    "Tuck hollow / One leg straight hollow / Full hollow / Supported arch / Full arch",
    "Match the other 47 movement names (only the first word capital)", find="", repl="", show="", seek="")
add("g039", "clarity", "Low ring pass-out: (twice, with different positions)",
    "Low ring pass-out – arm out wide / Low ring pass-out – arm out front",
    "Two different drills had the same name", find="", repl="", show="", seek="arm out wide")
add("g040", "grammar", "Able to even apply more force on the bar", "Able to apply even more force on the bar", "Word order")
add("g041", "grammar", "Wrist are in line with elbow", "Wrists are in line with elbows", "Plural")
add("g042", "spelling", "Elbows are traveling backwards (twice)", "Elbows are travelling backwards", "British spelling",
    find="traveling", repl="travelling", all=True, show="traveling", seek="travelling")
add("g043", "punctuation", "Strict ring muscle-up progression - 5 key positions", "Strict ring muscle-up progression – 5 key positions",
    "En dash, as elsewhere", find="progression - 5 key", repl="progression – 5 key", show="progression - 5 key", seek="progression – 5 key")

# ---- Programming ----
add("g044", "consistency", "frontload / front loading", "front-load / front-loading", "Same spelling both times",
    find="", repl="", show="frontload", seek="front-load")
add("g045", "grammar", "*Start this cycle again with your new number of your max set.", "*Start this cycle again with your new max set.", "Wording")
add("g046", "grammar", "Maybe even for the most of your membership base the best approach.",
    "It may even be the best approach for most of your members.", "Sentence is back to front")
add("g047", "grammar", "As you can see the intensity, volume and frequency is the same for every two weeks.",
    "As you can see, the intensity, volume and frequency stay the same for each two-week block.", "Grammar")
add("g048", "grammar", "for week five and six but increased the volume. In week seven and eight",
    "for weeks five and six but increased the volume. In weeks seven and eight", "Plural")
add("g049", "grammar", "for all the 4 repetitions", "for all 4 repetitions", "Wording")

# where the text search can't find a spot (pictures, raster pages), set the page by hand
SEEK = {"g013": "This manual is a supporting", "g008": "Hierarchy of Development", "g020": "An Athlete –", "g023": "evelopment, 2020",
        "g026": "This means", "g037": "Eccentric sit-up", "g038": "Tuck hollow"}
SHOW = {"g020": "An Athlete -", "g038": "Tuck Hollow:", "g039": "Low ring pass-out:"}
PAGES = {"g002": (1, 1), "g008": (None, 6), "g010": (None, 9), "g036": (None, 10), "g037": (None, 10)}
for c in C:
    if c["id"] in SEEK: c["seek"] = SEEK[c["id"]]
    if c["id"] in SHOW: c["show"] = SHOW[c["id"]]
add("g050", "images", "Team photo (blue T-shirts, barn doors)", "2026 team photo (BirdBox TGC vests)",
    "Approved by Nathan in chat, 19 Nov. Already in the new design", find="", repl="", show="", seek="")
PAGES["g050"] = (4, 2)
