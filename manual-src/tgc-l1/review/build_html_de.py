# German edition of the TGC Seminar Guide, in the 2026 design.
# Wording: the 2023 German guide, verbatim, EXCEPT where
# Nathan's approved English decisions (review/decisions.json) change the meaning. Each such spot is
# wrapped in <span data-pt="gNNN"> so the review page can show it; the span has no visual effect.
# usage: build_html_pt.py <out.html>
import sys, html, json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from exercises import EX
from exercises_de import EX_DE as EX_PT
from diagrams import pyramid, mda

OUT = sys.argv[1]
e = html.escape
_X = os.path.join(HERE, "extra-lines-de.json")
EXTRA = {int(k): v for k, v in json.load(open(_X)).items()} if os.path.exists(_X) else {}

def lines(n):
    return '<div class="lines">' + '<div class="ln"></div>' * n + '</div>'
def img(p, k):
    return f'img/p{p:02d}-{k:02d}.jpg'
def pt(cid, s):
    return f'<span data-pt="{cid}">{s}</span>'

# Exercise titles: same edits as the English decisions g038/g039 do not apply (Amadeu's names differ);
# colons are already dropped (g037).
def exercise(i, kind, src, title, bullets):
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
    n = len(ks); per = 5 if n == 10 else n
    pics = "".join(f'<img src="{img(p, k)}" alt="">' for k in ks)
    return (f'<div class="ex strip" id="ex{i}"><h3>{e(title)}</h3>'
            f'<figure class="strip n{per}">{pics}</figure>{bl}{lines(3 + EXTRA.get(i, 0))}</div>')

# Changes for Nathan to approve (card d13), applied in the preview:
EX_PT = [list(x) for x in EX_PT]
EX_PT[18][1] = [b.replace("Kraftübertagung", "Kraftübertragung") for b in EX_PT[18][1]]
assert len(EX) == len(EX_PT) == 52
ex_html = "\n".join(exercise(i, en[0], en[2], ptx[0], ptx[1]) for i, (en, ptx) in enumerate(zip(EX, EX_PT), 1))

CHAPTERS = ["EINLEITUNG", "UNSERE MISSION", "DEFINITIONEN &amp; TERMINOLOGIE", "ÜBERBLICK DER METHODIK",
            "TRAININGSREGELN", "MOVEMENT DEVELOPMENT", "PROGRESSIONSLEITFADEN", "PROGRAMMING"]
_T = os.path.join(HERE, "toc-pages-de.json")
TOCP = json.load(open(_T)) if os.path.exists(_T) else {}
toc = "".join(f'<li><span class="toc-n">{i}</span><span class="toc-t">{t}</span><span class="toc-p" data-ch="Kapitel {i}">{TOCP.get(str(i), "")}</span></li>'
              for i, t in enumerate(CHAPTERS, 1))
def ch(i):
    return f'<section class="chapter" id="ch{i}"><header><p class="chapter-no">Kapitel {i}</p><h1>{CHAPTERS[i-1]}</h1></header>\n'

# Diagrams with Portuguese labels (layout identical to the approved English redraws g008/g010)
PYR = pyramid()
for a, b in [(">NUTRITION<", ">ERNÄHRUNG<"), (">GYMNASTICS<", ">TURNEN<"), (">METABOLIC CONDITIONING<", ">METABOLISCHE KONDITIONIERUNG<"),
             (">WEIGHTLIFTING<", ">GEWICHTHEBEN<"), (">&amp; THROWING<", ">&amp; WERFEN<"), (">SPORT<", ">SPORT<"),
             ('aria-label="Hierarchy of development: nutrition, gymnastics, metabolic conditioning, weightlifting and throwing, sport"',
              'aria-label="Entwicklungshierarchie: Ernährung, Turnen, metabolische Konditionierung, Gewichtheben und Werfen, Sport"')]:
    assert a in PYR, a; PYR = PYR.replace(a, b)
PYR = PYR.replace('font-size="11"', 'font-size="9.5"', 1).replace('font-size="11"', 'font-size="11"')
MDA = mda()
for a, b in [(">MOVEMENT DEVELOPMENT APPROACH<", ">ANSATZ ZUR BEWEGUNGSENTWICKLUNG<"),
             (">The athlete presents movement<", ">Der Athlet zeigt die Bewegung<"),
             (">Poor Movement<", ">Schlechte Bewegung<"), (">Good Movement<", ">Gute Bewegung<"),
             (">Attempt to fix by<", ">Korrekturversuch<"), (">using a cue.<", ">mit einem Cue.<"),
             (">Negative correction<", ">Negative Korrektur<"), (">with the cue.<", ">mit dem Cue.<"),
             (">Positive correction<", ">Positive Korrektur<"),
             (">Attempt to correct<", ">Korrekturversuch<"), (">athlete with a<", ">mit einem<"), (">constraint.<", ">Constraint.<"),
             (">with a constraint.<", ">mit dem Constraint.<"),
             (">Reinforce, cue<", ">Bestärken, cuen<"), (">and reward<", ">und belohnen<"),
             (">Devise and develop interventions to do with the<", ">Interventionen mit dem Athleten entwickeln,<"),
             (">athlete to help improve their movement pattern<", ">um sein Bewegungsmuster zu verbessern<"),
             ('aria-label="Movement development approach flow chart"', 'aria-label="Ablaufdiagramm der Bewegungsentwicklung"')]:
    assert a in MDA, a; MDA = MDA.replace(a, b)
MDA = MDA.replace('font-size="24"', 'font-size="20"', 1)
# "Reforçar, dar indicações e recompensar" is too wide for two lines: set it on three
_m = re.search(r'<text x="([\d.]+)" y="([\d.]+)"([^>]*)>Bestärken, cuen</text><text x="[\d.]+" y="([\d.]+)"[^>]*>und belohnen</text>', MDA)
assert _m, "reinforce box"
_x, _y1, _attrs, _y2 = _m.group(1), float(_m.group(2)), re.sub(r'font-size="[\d.]+"', 'font-size="16"', _m.group(3)), float(_m.group(4))
_mid = (_y1 + _y2) / 2
MDA = MDA.replace(_m.group(0), "".join(f'<text x="{_x}" y="{_mid + d:.1f}"{_attrs}>{t}</text>' for d, t in ((-20, "Bestärken,"), (1, "Cue geben"), (22, "und belohnen"))))





page = f'''<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>The Gymnastics Course – Seminar-Leitfaden</title>
<link rel="stylesheet" href="../manual.css">
<link rel="stylesheet" href="tgc.css">
<style>
@page :right {{ @top-right {{ content: "Seminar-Leitfaden"; }} }}
@page titlep:right {{ @top-right {{ content: none; }} }}
figure.team img {{ height: 50mm; object-fit: cover; object-position: center 60%; }}
#ch2 ol.mission-list li {{ font-size: 12.5pt; margin-bottom: 3.2mm; }}
#ch2 figure.fill-bottom img {{ height: 62mm; }}
#ch4 figure.fill-bottom img {{ height: 44mm; }}
#ch4 figure.fill-bottom {{ margin-top: 4mm; }}
#ch5 figure.quote-photo + * {{ break-before: auto; margin-top: 5mm; }}
#ch5 figure.quote-photo {{ break-before: page; }}
/* German runs longest: keep each chapter on its pages */
#ch3 figure.fill-bottom {{ margin-top: 8mm; }}
/* Page 8: larger pyramid at the top beside a narrower column, rest of the text full width below (Nathan, 19 Nov) */
#ch4 .pyr-split {{ grid-template-columns: 1fr 92mm; align-items: start; gap: 6mm; }}
#ch4 .pyr-split p:last-child {{ margin-bottom: 0; }}
#ch4 p.after-pyr {{ margin-top: 3mm; }}
#ch4 figure.fill-bottom img {{ height: 58mm; }}
#ch4 figure.fill-bottom {{ margin: 4mm 0 0; }}
figure.mda {{ width: 78%; margin-top: 2mm; }}
</style>
<script>
  const edition = location.hash.startsWith("#print") ? "print" : "web";
  document.documentElement.classList.add(edition);
  if (location.hash === "#print-odd") document.documentElement.classList.add("odd");
  if (edition === "print") document.write('<link rel="stylesheet" href="../print-bleed.css">');
</script>
</head>
<body>
<!-- The Gymnastics Course – Seminar-Leitfaden (German). Generated by review/build_html_de.py from the 2023 German guide;
     spots changed for Nathan's decisions are marked data-pt="dNN". -->
<div class="cover">
  <div class="photo" style="background-image:url('img/cover-top.jpg')"></div>
  <div class="photo2" style="background-image:url('img/cover-photo.jpg')"></div>
  <div class="body">
    <img class="logo dark" src="../../brand/tgc-mark.png" alt="TGC">
    <img class="logo light" src="img/tgc-logo-on-light.png" alt="TGC">
    <p class="kicker">Seminar-Leitfaden</p>
    <h1 class="title">{pt("d01", "The Gymnastics Course")}</h1>
  </div>
</div>
<section class="halftitle"><p>Seminar-Leitfaden</p></section>
<section class="titlepage">
<img class="tp-logo" src="img/tgc-logo-on-light.png" alt="TGC">
<p class="tp-kicker">The Gymnastics Course</p>
<h1 class="tp-title">Seminar-Leitfaden</h1>
<p class="tp-sub">{pt("d02", "Teilnehmerhandbuch")}</p>
<div class="tp-foot"><img class="tp-ceu" src="img/ceu-approved.png" alt="CrossFit Approved CEU Provider"><p>{pt("d02", "Ausgabe 2026")}</p><p>{pt("d02", "© 2026 BirdBox Coaching Limited. Alle Rechte vorbehalten.<br>Kein Teil dieses Handbuchs darf ohne schriftliche Genehmigung kopiert oder weitergegeben werden.")}</p><p>BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland<br>birdboxcoaching.com</p></div>
</section>
<section class="toc"><h1 class="toc-h">{pt("d03", "Inhalt")}</h1><ol class="toc-list">{toc}</ol></section>

{ch(1)}<p>The Gymnastics Course ist ein Seminar für Coaches Development – eine professionelle Weiterentwicklung für Coaches und Athleten. Der Kurs wird seit über einem Jahrzehnt von einem weltweiten Experten-Team geleitet und stetig weiterentwickelt. Wir wollen einen Beitrag dazu leisten, das Potenzial von professionellen Trainern, Coaches, Athleten und Gym-Besitzern zu wecken und auszuschöpfen. Unser Ziel ist es, die methodische Vorgehensweise des Turnens zu nutzen, um das Training und Coaching zu optimieren.</p>
<figure class="team"><img src="img/photo-team-2026.jpg" alt="Das TGC Coaching-Team, 2026"><figcaption>{pt("d04", "Team Summit 2026: Mallorca, Spanien")}</figcaption></figure>
<p>{pt("d05", "Dieses Handbuch")} ist ein Leitfaden für das Live-Seminar. Bitte beachte, dass das Dokument nicht alle in unserem Kurs besprochenen Elemente enthält. Das Handbuch soll Dir das Lernen erleichtern und als Gedankenstütze, für Dein Training &amp; Coaching nach dem Seminar, dienen.</p>
<p>Wenn Du die Inhalte des Live-Seminars noch vertiefen möchtest, empfehlen wir Dir unseren Online-Kurs. Hier hast Du die Möglichkeit, im Rahmen eines Selbststudiums, alle Themenschwerpunkte in einem interaktiven Umfeld, mit Videos, weiterführende Literatur und Lernproben, erneut zu bearbeiten. Wir gewähren allen Teilnehmern eines Live-Seminars einen erheblichen Preisnachlass, um eine tiefgreifende und abgerundete Lernerfahrung zu ermöglichen. {pt("d05", "Das folgende Handbuch")} enthält Bilder und Erklärungen zu den elementaren Inhalten dieses Seminars.</p>
<p>Im Handbuch gibt es Platz für Deine eigenen Notizen, die Du im Laufe des Kurses hinzufügen kannst.</p>
</section>

{ch(2)}<ol class="mission-list">
<li>Wir wollen Dir helfen, die Vorteile des Strebens nach Bewegungen mit Virtuosität zu verstehen, insbesondere in Bezug auf die turnerischen Elemente und Übungen mit dem eigenen Körpergewicht.</li>
<li>Unser Ziel ist es, Dir die Fähigkeit zu vermitteln, turnerische Bewegungsfehler auf der Grundlage der Beurteilung von körperlichen Einschränkungen zu diagnostizieren. Darauf aufbauend lernst Du, geeignete Interventionen und Progressionen festzulegen und diese erfolgreich in ein Training und Coaching zu implementieren, um die Sicherheit, Effektivität und Effizienz zu verbessern.</li>
<li>Wir arbeiten darauf hin, Dein Coaches Eye zu entwickeln, was Dir dabei helfen wird, Bewegungsfehler bei Dir selbst und bei anderen aufzudecken und Bewegungen kritisch zu hinterfragen. Dabei nutzen wir vereinfachte Points of Performance der turnerischen Elemente sowie das grundlegende Verständnis von Anthropometrie und Physik.</li>
<li>Im Hinblick auf die Entwicklung von Bewegung mit Virtuosität, ist es essenziell eine starke Basis der turnerischen Bewegungen in der Abwesenheit eines Kips zu erlernen und zu trainieren (strict Movements). Unser Ziel ist es, Dir die physischen und neurologischen Vorteile von strict before kip zu erklären.</li>
<li>Growth Mindset (Wachstumsmentalität) spielt in Bezug auf Dein eigenes Lernen, Deine Leistungsentwicklung aber auch in Bezug auf Dein Coaching und den Einfluss, den Du damit auf Deine Mitglieder und Athleten hast, eine große Rolle. Deshalb ist es unser Ziel, Dir dabei zu helfen eine Growth Mindset Mentalität zu entwickeln.</li>
</ol>
<figure class="fill-bottom"><img src="img/photo-p03.jpg" alt=""></figure>
</section>

{ch(3)}<div class="terms">
<p class="term"><b>Athlet</b> – ein Athlet ist jemand, der die Fähigkeit besitzt, sich mit anderen zu messen und zu gewinnen. {pt("d06", "Ein relativer Indikator für einen Athleten wäre ein Wettkampf auf höchstem Niveau seiner Sportart oder eine Top-5-Platzierung bei einem nationalen oder internationalen Wettkampf.")}</p>
<p class="term"><b>Bedarfsanalyse</b> – die Bedarfsanalyse ist ein formaler, systematischer Prozess zur Identifizierung und Bewertung des Trainings, das durchgeführt werden sollte, um einen Athleten in Bezug auf die Anforderungen seines Sports, seines Lebens oder seiner Verletzung zu fördern.</p>
<p class="term"><b>Regeln</b> – Regeln basieren auf Prinzipien und sind vorgeschlagene Standards, die dabei helfen, einen Athleten zu korrigieren und sicher weiterzuentwickeln. Eine Regel kann von dem Athleten selbst oder dem Coach gebrochen werden.</p>
<p class="term"><b>Gesetze</b> – ein Gesetz ist eine viel strengere Regel, an die man sich unbedingt halten muss. Das Gesetz zu brechen ist keine Option, da diese durch die Wissenschaft eingeschränkt wird. Zum Beispiel können Newtons Gravitationsgesetze nicht geändert oder gebrochen werden.</p>
<p class="term"><b>Virtuosität</b> – Virtuosität wird im Turnen als „das Gewöhnliche ungewöhnlich gut ausführen“ definiert. (Greg Glassman, 2005)</p>
<p class="term"><b>Mastery</b> – Mastery ist die Beherrschung einer Bewegung und wird definiert als „die Verbesserung der Fähigkeit eines Sportlers, sein motorisches Potenzial effektiv zu nutzen“ {pt("d07", "(BirdBox Coaching, 2020)")}</p>
<p class="term"><b>Aktive Muskelmasse</b> – aktive Muskelmasse bedeutet, dass wir die Fähigkeit haben, Muskeln zu kontrahieren, die dabei helfen, die Form als Ganzes aufrechtzuerhalten. Ziel ist es, eine möglichst feste Einheit zu bilden.</p>
<p class="term"><b>Hollow</b> – die Hollow Position ist die Basis für alle turnerischen Elemente und dient dazu, Stabilität zu schaffen. Sie ist gekennzeichnet durch eine starke Kontraktion des Cores und maximaler aktiver Muskelmasse von den Zehen bis zu den Fingerspitzen. Hollow ist immer eine gerade Linie von Rippenbogen bis Zehenspitze. Der Rippenbogen ist geschlossen und das Becken befindet sich in einer posterioren Position.</p>
<p class="term"><b>“Strict”</b> – Bewegung ohne Kippbewegung. Der Athlet verlässt sich auf Muskelkontrolle und Kraft, um die Bewegung auszuführen.</p>
<p class="term"><b>Kipp</b> – eine aggressive Richtungsänderung bei hoher Geschwindigkeit, die zu einer Änderung der Ebene oder Position führt, um ein Bewegungsmuster zu erreichen.</p>
<p class="term"><b>Form</b> – die Art und Weise oder Methode, eine Bewegung korrekt auszuführen, wobei Perfektion angestrebt wird.</p>
<p class="term"><b>Statisches Gerät</b> – Stabil und unbeweglich (Boden und Barren).</p>
<p class="term"><b>Dynamisches Gerät</b> – Instabil und beweglich (Ringe).</p>
<p class="term"><b>Beweglichkeit (“Mobility”)</b> – Bewegungsamplitude um ein Gelenk.</p>
<p class="term"><b>Aktive Beweglichkeit (“Flexibility“)</b> – Kontraktion der entgegengesetzten Muskeln, um eine Position zu dehnen oder zu halten.</p>
<p class="term"><b>Passive Beweglichkeit („Flexibility“)</b> – Dehnung eines Muskels, die keine Kontraktion der gegenüberliegenden Muskeln erfordert.</p>
<p class="term"><b>ROM</b> – Bewegungsumfang.</p>
<p class="term"><b>EROM</b> – erweiterter Bewegungsumfang.</p>
<p class="term"><b>Hilfestellung (“Spotting“)</b> – Unterstützung eines Sportlers bei Bedarf als Teil einer Progression oder zur Vermeidung von Verletzungen.</p>
<p class="term"><b>Spannung</b> – das Wort „Spannung“ kann als „Zustand der Anspannung“ definiert werden, während das Gegenteil „Schlaffheit“ oder „Lockerheit“ ist (Fowler &amp; Crystal, 2010).</p>
</div>
<figure class="fill-bottom"><img src="img/photo-p05.jpg" alt=""></figure>
</section>

{ch(4)}<h2>Die theoretische Entwicklungshierarchie von The Gymnastics Course</h2>
<div class="pyr-split">
<div><p>Wir von The Gymnastics Course betonen, dass CrossFit ein grundlegendes Kraft- und Konditionstrainingsprogramm (Core Strength &amp; Conditioning Programm) ist.</p>
<p>Wenn wir mit einem Athleten oder Kunden arbeiten, sollten wir daher eine Bedarfsanalyse durchführen. Wir müssen die Bedürfnisse und Anforderungen eines Athleten, seiner Sportart oder seines Lebens verstehen und sein Trainingsprogramm auf die Diskrepanzen zwischen diesen beiden Bereichen abstimmen.</p></div>
<figure class="pyramid-img">{pt("d08", PYR)}</figure>
</div>
<p class="after-pyr">Das Turnen umfasst nur Übungen und Bewegungen mit dem eigenen Körper. Anders ausgedrückt, wir bewegen unseren Körper in Ort und Zeit. Wir theoretisieren, dass wir die Beherrschung des eigenen Körpergewichts (also das Turnen), vor der metabolischen Konditionierung priorisieren müssen. Denn das, die Biomechanik, ist unsere Grundlage für Bewegung. Wenn eine Person eine schlechte Biomechanik (= menschliche Bewegung) hat, kann man davon ausgehen, dass die Fähigkeit, metabolische Konditionierung zu erreichen, nichtig oder verletzungsgefährdet ist.</p>
<figure class="fill-bottom"><img src="img/photo-p06.jpg" alt=""></figure>
</section>

{ch(5)}<p class="rule">Regel Nr. 1: <span>„Statisch vor dynamisch“</span></p>
<p class="rule">Regel Nr. 2: <span>“Strict vor kip”</span></p>
<p>Kraft ist die grundlegende Voraussetzung für eine korrekte Ausführung (Form), und eine korrekte Ausführung (Form) ist erforderlich, um den Körper in der Bewegung kontrollieren zu können. Daher liegt der Schwerpunkt beim Turnen eindeutig auf der Kraftentwicklung.</p>
<p>Das Kontrollieren einer Bewegung wird vor allem durch das Ausführen von Bewegungen in Abwesenheit eines Kipps (strict Movement) erreicht. Aus diesem Grund betonen wir das Training von Übungen &amp; Bewegungen in der Abwesenheit einer Kipp-Bewegung. Die dadurch gewonnene Kraft und Körperbeherrschung sind die Mühe wert, und die Verletzungsgefahr wird erheblich reduziert. Bereits kleine Fortschritte machen sich schnell bemerkbar, aber es bedarf Zeit, um eine Bewegung mit voller Bewegungskontrolle ausführen zu können. “You learn them and earn them!”</p>
<p>Um eine Bewegung meistern zu können, benötigen wir ein virtuoses Körperbewusstsein und eine gute Körperbeherrschung. Um diese zu erlangen, müssen wir alle Bewegungen mit optimaler Form ausführen. Hierfür bedarf es der erforderlichen Kraft im gesamten Bewegungsumfang, von Anfang bis Ende einer Bewegung. Fehlt die Kraft – wenn auch nur in einem Teil des Bewegungsumfanges – hat dies negative Auswirkung auf die Position. Dies führt dann dazu, dass Kräfte in falsche Richtungen geleitet werden. Oder es findet keine Aktion statt, da keine oder nicht genügend Kraft vorhanden ist. (Newtonsche Gesetze)</p>
<p>Unser Ziel ist es, die Bewegungen eines Athleten optimal zu entwickeln. Den Trainern möchten wir hierfür eine Herangehensweise an die Hand geben, die es ihnen erlaubt, möglichst effizient zu coachen. Coaching Cues, Coaching Constraints und Coaching Interventionen sind Werkzeuge {pt("d13", "die")} wir hierzu nutzen können.</p>
<blockquote class="big">„Kraft ist die Voraussetzung für eine korrekte Form,<br>und korrekte Form ist Voraussetzung für Körperbewusstsein und -kontrolle“</blockquote>
<figure class="quote-photo"><img src="img/photo-p07.jpg" alt=""></figure>
<p class="rule">Regel Nr. 3:<br><span>Nutze isometrisches Training, um ein starkes Fundament zu schaffen.</span></p>
<p class="rule">Regel Nr. 4:<br><span>Nutze die exzentrische Belastung als Mittel zur Kraft- und Positionsentwicklung.</span></p>
<p>Isometrische {pt("d13", "Kontraktionen")} bedeuten, dass der Muskel bei gleichbleibender Länge unter Belastung oder Spannung steht. Isometrisches Training ist wichtig für die Stabilisierung der Gelenke und die Entwicklung des Bindegewebes.</p>
<p>Unter einer exzentrischen Belastung versteht man eine Kontraktion, bei welcher der Muskel unter Belastung oder Spannung ist. Der Muskel wirkt einer auf ihn wirkenden Kraft entgegen, während er bzw. seine Sarkomere verlängert werden. Die exzentrische Belastung bringt viele Vorteile mit sich, insbesondere die Veränderungen der Muskelarchitektur, die zur Kraftentwicklung führen.</p>
<p>Bei konzentrischen Kontraktionen wird ein Muskel belastet oder angespannt, aber gleichzeitig verkürzt er sich. {pt("d09", "Im Training")} führen wir ständig konzentrische Kontraktionen aus. Unser Ziel ist es, die Vorteile der verschiedenen Kontraktionsformen zu nutzen, ohne dabei aber die Risiken aus den Augen zu verlieren. In der Programming Lecture werden die Risiken der verschiedenen Kontraktionsformen erläutert.</p>
<div class="notes-inline">{lines(7)}</div>
</section>

{ch(6)}<p><b><i>Coaching-Cues</i></b> richten sich an den Athleten, um eine Positionsänderung durch verbale Kommunikation herbeizuführen.</p>
<p><b><i>Coaching-Constraints</i></b> sind Übungen, die dazu beitragen, dass eine Position innerhalb einer ausgewählten Bewegung hart erarbeitet wird. Die Bewegung bzw. der Bewegungsumfang wird hier bewusst beschränkt. Es wird jedoch kein Einfluss auf die Entwicklung von Kraft oder Länge eines Muskels genommen.</p>
<p><b><i>Coaching-Interventionen</i></b> werden eingesetzt, wenn Cues und Constraints unwirksam werden. Sie führen zu einer Veränderung der Länge des Muskelgewebes, zur Kraftsteigerung, und zielen somit auf eine Verbesserung der Bewegungen ab.</p>
<p>Während des Live-Seminars werden verschiedene Aspekte von Coaching-Cues, -Constraints und -Interventionen behandelt. Eine Übersicht, wie man effektiv entscheidet, welches Werkzeug am besten anzuwenden ist, siehst du unten.</p>
<figure class="mda">{pt("d10", MDA)}</figure>
</section>

{ch(7)}<p>Als Athlet und auch als Trainer ist es wichtig, die Positionen in einer Bewegung zu verstehen. Hier stellen wir eine Reihe von Bildern vor, die die wichtigsten Positionen für die entsprechenden Bewegungen zeigen.</p>
<p>Je besser wir die Grundpositionen einer Bewegung verstehen und trainieren, desto größer wird die Fähigkeit sein, die Bewegung optimal umzusetzen. Die Performanceleistung steigt und wir reduzieren das Verletzungsrisiko.</p>
<p>Während des Seminars werden wir uns die Positionen und Bewegungen noch sehr viel detaillierter ansehen. Nutze die Notizfelder und ergänze weiter wichtige Informationen während des Kurses.</p>
<h2 class="mv">Movements</h2>
{ex_html}
</section>

{ch(8)}<p>Im nächsten Abschnitt erhältst du einen Einblick in die Trainingsprogrammierung von turnerischen Elementen. Im Seminar werden wir, während der Programming Lecture noch weiter in die Tiefe gehen.</p>
<h2>Lineare Progression</h2>
<p>Bei der linearen Progression handelt es sich um eine Trainingsmethode, bei der der Schwierigkeitsgrad oder das Volumen einer Übung im Laufe der Zeit schrittweise erhöht wird. So fördern wir den Fortschritt und die Anpassung. Diese Methode wird häufig im Krafttraining eingesetzt, um Athleten dabei zu helfen, Kraft und Ausdauer zu entwickeln, die für die Ausführung fortgeschrittener Bewegungen oder Lifts erforderlich sind. Mit Hilfe der linearen Progression im Training können Sportler ihre Kraft und Ausdauer auf sichere und effektive Weise allmählich steigern. Es ist wichtig zu beachten, dass die lineare Progression in Verbindung mit der richtigen Form und Technik eingesetzt werden sollte, um Verletzungen zu vermeiden und optimale Ergebnisse zu erzielen. Wir nutzen diese Methode der linearen Progression gerne für das Training der turnerischen Elemente.</p>
<p>Wir verwenden oft Prozentsätze beim Gewichtheben, aber nur wenige von uns nutzen Prozentsätze im Training von turnerischen Elementen. Beim Turnen ist die Intensität der Prozentsatz der maximalen Wiederholungszahl (RM) oder die TUT (Zeit unter Spannung). Das Gesamtvolumen ist die Gesamtanzahl der Wiederholungen oder die Gesamtzeit unter Spannung.</p>
<p>Im Folgenden erklären wir zwei Beispiele für eine lineare Progression bei der Kraftentwicklung von Strict Pull-Ups. Wir erhöhen um jeweils eine Wiederholung je Trainingseinheit, um eine progressive Überlastung zu erreichen. Wir beginnen diese Progression bspw. mit 40 %. Das erste Beispiel unten basiert auf einem maximalen Satz von 10 strict Pull-Ups mit perfekter Bewegungsbeherrschung.</p>
<div class="keep"><p class="tcap">Beispiel einer linearen Progression mit % der maximalen Wiederholungszahl:</p>
<table class="prog"><thead><tr><th>Woche</th><th>Session 1</th><th>Session 2</th><th>Session 3</th></tr></thead><tbody>
<tr><td>1.</td><td>4-4-4</td><td>5-4-4</td><td>5-5-4</td></tr>
<tr><td>2.</td><td>5-5-5</td><td>6-5-5</td><td>6-6-5</td></tr>
<tr><td>3.</td><td>6-6-6</td><td>7-6-6</td><td>7-7-6</td></tr>
<tr><td>4.</td><td>7-7-7</td><td>8-7-7</td><td>8-8-7</td></tr>
<tr><td>5.</td><td>8-8-8</td><td>9-8-8</td><td>9-9-8</td></tr>
<tr><td>6.</td><td colspan="3">Retest</td></tr>
</tbody></table>
<p class="foot">*Wiederhole diesen Zyklus erneut mit dem neuen RM-Wert des Retests.</p></div>
<p>Wenn die Kraft für einen Strict Pull-Up noch nicht ausreicht, können wir eine isometrische und eine exzentrische Kontraktion miteinander verbinden und progressiv die Time Under Tension, also die Zeit, die der Muskel unter Spannung ist, steigern, um die Kraft in den nötigen Positionen bzw. der Bewegung aufzubauen.</p>
<p>Ein Beispiel zu dieser Progression siehst Du unten. Die erste Zahl steht für Time Under Tension in der Chin Over Bar Position und die zweite Zahl für die Exzentrik, also das Ablassen aus der Chin Over Bar Position bis in den Hang. Nutze bspw. einen Jumping Pull Up, eine Box oder einen Spotter, der Dir Hilfestellung gibt, um in die Ausgangsposition zu gelangen. Falls die Kraft noch nicht ausreicht, um Position und Bewegung zu kontrollieren, kannst Du über die Hilfestellung mit den Füßen (Toe-Nail-Spot) die Last entsprechend reduzieren.</p>
<div class="keep"><p class="tcap">Beispiel einer linearen Progression mit TUT:</p>
<table class="prog"><thead><tr><th>Woche</th><th>Session 1</th><th>Session 2</th><th>Session 3</th></tr></thead><tbody>
<tr><td>1.</td><td>3/3 - 3/3 - 3/3</td><td>4/4 - 3/3 - 3/3</td><td>4/4 - 4/4 - 3/3</td></tr>
<tr><td>2.</td><td>4/4 - 4/4 - 4/4</td><td>5/5 - 4/4 - 4/4</td><td>5/5 - 5/5 - 4/4</td></tr>
<tr><td>3.</td><td>5/5 - 5/5 - 5/5</td><td>6/6 - 5/5 - 5/5</td><td>6/6 - 6/6 - 5/5</td></tr>
<tr><td>Retest</td><td colspan="3" class="note">• Nach Absolvieren der 3. Woche, folgt ein Retest.<br>• Sofern die Kraft für einen Strict Pull-Up ausreicht, folge dem Schema aus Woche 4.<br>• Falls die Kraft noch nicht ausreicht, fahre mit der linearen Progression fort.<br>• Wenn du zu Beginn einen Toe-Spot genutzt hast, kannst du nun versuchen, mit dem vollen Körpergewicht zu arbeiten.</td></tr>
<tr><td>4.</td><td>1-1-1</td><td>2-1-1</td><td>2-2-1</td></tr>
<tr><td>5.</td><td>2-2-2</td><td>3-2-2</td><td>3-3-2</td></tr>
<tr><td>6.</td><td>3-3-3</td><td>4-3-3</td><td>4-4-3</td></tr>
</tbody></table>
<p class="foot">*Wenn es gelungen ist, die gesamte Progression, wie vorgeschrieben, zu absolvieren, kann nun das %-Beispiel folgen.</p></div>
<p>Diese Progression kann mit jedem turnerischen Element durchgeführt werden. Es ist ein sehr einfacher Ansatz und ermöglicht eine leichte Implementierung in ein Box-Programm. Vielleicht ist dies sogar für den Großteil der Mitgliederbasis der beste Ansatz.</p>
<h2>{pt("d11", "Volumen, Intensität und Häufigkeit")}</h2>
<p>Wenn ein individuelles Training zu planen ist, kann mit Volumen, Intensität und Häufigkeit gespielt werden. Für einen ersten Einblick und ein besseres Verständnis findest Du hier ein Beispiel einer linearen Progression mit mehr Variabilität dieser Parameter.</p>
<div class="keep"><p class="foot">*Das Beispiel basiert auf einem maximalen Satz von 10 strict Pull-Ups mit perfekter Bewegungsausführung.</p>
<table class="prog vif"><thead><tr><th>Woche</th><th>Intensität</th><th>Häufigkeit</th><th>Volumen</th></tr></thead><tbody>
<tr><td>1.</td><td>3 Sätze mit 40%<br>4-4-4</td><td>2 Trainingseinheiten<br>pro Woche</td><td>24 Wiederholungen</td></tr>
<tr><td>2.</td><td>3 Sätze mit 40%<br>4-4-4</td><td>2 Trainingseinheiten<br>pro Woche</td><td>24 Wiederholungen</td></tr>
<tr><td>3.</td><td>3 Sätze mit 50%<br>5-5-5</td><td>2 Trainingseinheiten<br>pro Woche</td><td>30 Wiederholungen</td></tr>
<tr><td>4.</td><td>3 Sätze mit 50%<br>5-5-5</td><td>2 Trainingseinheiten<br>pro Woche</td><td>30 Wiederholungen</td></tr>
<tr><td>5.</td><td>4 Sätze mit 40%<br>4-4-4-4</td><td>2 Trainingseinheiten<br>pro Woche</td><td>32 Wiederholungen</td></tr>
<tr><td>6.</td><td>4 Sätze mit 40%<br>4-4-4-4</td><td>2 Trainingseinheiten<br>pro Woche</td><td>32 Wiederholungen</td></tr>
<tr><td>7.</td><td>3 Sätze mit 40%<br>4-4-4</td><td>3 Trainingseinheiten<br>pro Woche</td><td>36 Wiederholungen</td></tr>
<tr><td>8.</td><td>3 Sätze mit 40%<br>4-4-4</td><td>3 Trainingseinheiten<br>pro Woche</td><td>36 Wiederholungen</td></tr>
</tbody></table></div>
<p>Intensität, Umfang und Häufigkeit bleiben immer für zwei Wochen konstant. Für Woche drei und vier haben wir die Intensität erhöht, in Woche fünf und sechs, wird die Intensität reduziert, aber das Volumen erhöht. In der siebten und achten Woche heben wir die Häufigkeit von zwei auf 3 Trainingseinheiten pro Woche an. Die Summe der Wiederholungen je Woche spiegelt den Anstieg des Gesamtvolumens {pt("d13", "wider")}. Die gleiche Herangehensweise lässt sich auch auf isometrische und exzentrische Belastungen anwenden.</p>
<p>In den hier genannten Beispielen kann man sehen, dass das Gesamtvolumen als auch die Intensität sehr gering ist. Im Gewichtheben werden wir mit diesem Volumen und Intensität wohl keinen optimalen Trainingsreiz setzen. Im Turnen erzielen wir einen überschwelligen Reiz durch die Anpassung der Time Under Tension und Tempo-Arbeit, jedoch nicht durch Volumen. Gelegentlich kann ein höheres Volumen genutzt werden, einen optimaleren Reiz setzen wir jedoch mit TUT:</p>
<p>Bei den hier genannten Progressionen, arbeiten wir jede Wiederholung in jedem Satz {pt("d13", "beispielsweise mit")} 5 Sekunden Hang in Hollow-Position, 3 Sekunden konzentrische Belastung, 3 Sekunden Chin over Bar Hold und 5s in der exzentrischen Phase des Pull-Ups, ab. So trainieren wir Positionen und Perfektion, statt Volumen und Intensität.</p>
<div class="notes-inline">{lines(10)}</div>
</section>
<section class="endblank"></section>
</body>
</html>
'''
open(OUT, "w").write(page)
print("wrote", OUT)
