# French edition of the TGC Seminar Guide, in the 2026 design.
# Wording: the 2023 French guide, verbatim, EXCEPT where
# Nathan's approved English decisions (review/decisions.json) change the meaning. Each such spot is
# wrapped in <span data-pt="gNNN"> so the review page can show it; the span has no visual effect.
# usage: build_html_pt.py <out.html>
import sys, html, json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from exercises import EX
from exercises_fr import EX_FR as EX_PT
from diagrams import pyramid, mda

OUT = sys.argv[1]
e = html.escape
_X = os.path.join(HERE, "extra-lines-fr.json")
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

# Changes for Nathan to approve (cards f12-f14), applied in the preview:
EX_PT = [list(x) for x in EX_PT]
EX_PT[2][0] = "Hollow avec une jambe tendue (One Leg Straight Hollow)"
EX_PT[39][1] = EX_PT[39][1][:3] + ["Les poignets sont alignés avec les coudes"]
EX_PT[41][0] = "Low ring pass-out – bras sur les côtés"
EX_PT[42][0] = "Low ring pass-out – bras devant"
assert len(EX) == len(EX_PT) == 52
ex_html = "\n".join(exercise(i, en[0], en[2], ptx[0], ptx[1]) for i, (en, ptx) in enumerate(zip(EX, EX_PT), 1))

CHAPTERS = ["INTRODUCTION", "NOTRE MISSION", "DÉFINITIONS ET TERMINOLOGIES", "SCHÉMA MÉTHODOLOGIQUE",
            "RÈGLES DE L’ENTRAÎNEMENT", "DÉVELOPPEMENT DU MOUVEMENT", "GUIDE DE PROGRESSION DU MOUVEMENT", "PROGRAMMATION"]
_T = os.path.join(HERE, "toc-pages-fr.json")
TOCP = json.load(open(_T)) if os.path.exists(_T) else {}
toc = "".join(f'<li><span class="toc-n">{i}</span><span class="toc-t">{t}</span><span class="toc-p" data-ch="Chapitre {i}">{TOCP.get(str(i), "")}</span></li>'
              for i, t in enumerate(CHAPTERS, 1))
def ch(i):
    return f'<section class="chapter" id="ch{i}"><header><p class="chapter-no">Chapitre {i}</p><h1>{CHAPTERS[i-1]}</h1></header>\n'

# Diagrams with Portuguese labels (layout identical to the approved English redraws g008/g010)
PYR = pyramid()
for a, b in [(">NUTRITION<", ">NUTRITION<"), (">GYMNASTICS<", ">GYMNASTIQUE<"), (">METABOLIC CONDITIONING<", ">CONDITIONNEMENT MÉTABOLIQUE<"),
             (">WEIGHTLIFTING<", ">HALTÉROPHILIE<"), (">&amp; THROWING<", ">&amp; LANCERS<"), (">SPORT<", ">SPORT<"),
             ('aria-label="Hierarchy of development: nutrition, gymnastics, metabolic conditioning, weightlifting and throwing, sport"',
              'aria-label="Pyramide du développement : nutrition, gymnastique, conditionnement métabolique, haltérophilie et lancers, sport"')]:
    assert a in PYR, a; PYR = PYR.replace(a, b)
PYR = PYR.replace('font-size="11"', 'font-size="9.5"', 1).replace('font-size="11"', 'font-size="11"')
MDA = mda()
for a, b in [(">MOVEMENT DEVELOPMENT APPROACH<", ">APPROCHE DU DÉVELOPPEMENT DU MOUVEMENT<"),
             (">The athlete presents movement<", ">L’athlète présente le mouvement<"),
             (">Poor Movement<", ">Mauvais mouvement<"), (">Good Movement<", ">Bon mouvement<"),
             (">Attempt to fix by<", ">Tenter de corriger avec<"), (">using a cue.<", ">une consigne verbale.<"),
             (">Negative correction<", ">Correction négative<"), (">with the cue.<", ">avec la consigne.<"),
             (">Positive correction<", ">Correction positive<"),
             (">Attempt to correct<", ">Tenter de corriger<"), (">athlete with a<", ">l’athlète avec<"), (">constraint.<", ">une contrainte.<"),
             (">with a constraint.<", ">avec la contrainte.<"),
             (">Reinforce, cue<", ">Renforcer, donner des consignes<"), (">and reward<", ">et récompenser<"),
             (">Devise and develop interventions to do with the<", ">Concevoir et développer des interventions avec l’athlète<"),
             (">athlete to help improve their movement pattern<", ">pour l’aider à améliorer son schéma de mouvement<"),
             ('aria-label="Movement development approach flow chart"', 'aria-label="Organigramme du développement du mouvement"')]:
    assert a in MDA, a; MDA = MDA.replace(a, b)
MDA = MDA.replace('font-size="24"', 'font-size="20"', 1)
# "Reforçar, dar indicações e recompensar" is too wide for two lines: set it on three
_m = re.search(r'<text x="([\d.]+)" y="([\d.]+)"([^>]*)>Renforcer, donner des consignes</text><text x="[\d.]+" y="([\d.]+)"[^>]*>et récompenser</text>', MDA)
assert _m, "reinforce box"
_x, _y1, _attrs, _y2 = _m.group(1), float(_m.group(2)), re.sub(r'font-size="[\d.]+"', 'font-size="16"', _m.group(3)), float(_m.group(4))
_mid = (_y1 + _y2) / 2
MDA = MDA.replace(_m.group(0), "".join(f'<text x="{_x}" y="{_mid + d:.1f}"{_attrs}>{t}</text>' for d, t in ((-20, "Renforcer, donner"), (1, "des consignes"), (22, "et récompenser"))))



page = f'''<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>The Gymnastics Course – Guide du séminaire</title>
<link rel="stylesheet" href="../manual.css">
<link rel="stylesheet" href="tgc.css">
<style>
@page :right {{ @top-right {{ content: "Guide du séminaire"; }} }}
@page titlep:right {{ @top-right {{ content: none; }} }}
figure.team img {{ height: 50mm; object-fit: cover; object-position: center 60%; }}
#ch2 ol.mission-list li {{ font-size: 12.5pt; margin-bottom: 3.2mm; }}
#ch2 figure.fill-bottom img {{ height: 62mm; }}
#ch4 figure.fill-bottom img {{ height: 44mm; }}
#ch4 figure.fill-bottom {{ margin-top: 4mm; }}
#ch5 figure.quote-photo + * {{ break-before: auto; margin-top: 5mm; }}
#ch5 figure.quote-photo {{ break-before: page; }}
</style>
<script>
  const edition = location.hash.startsWith("#print") ? "print" : "web";
  document.documentElement.classList.add(edition);
  if (location.hash === "#print-odd") document.documentElement.classList.add("odd");
  if (edition === "print") document.write('<link rel="stylesheet" href="../print-bleed.css">');
</script>
</head>
<body>
<!-- The Gymnastics Course – Guide du séminaire (French). Generated by review/build_html_fr.py from the 2023 French guide;
     spots changed for Nathan's decisions are marked data-pt="fNN". -->
<div class="cover">
  <div class="photo" style="background-image:url('img/cover-top.jpg')"></div>
  <div class="photo2" style="background-image:url('img/cover-photo.jpg')"></div>
  <div class="body">
    <img class="logo dark" src="../../brand/tgc-mark.png" alt="TGC">
    <img class="logo light" src="img/tgc-logo-on-light.png" alt="TGC">
    <p class="kicker">Guide du séminaire</p>
    <h1 class="title">{pt("f01", "The Gymnastics Course")}</h1>
  </div>
</div>
<section class="halftitle"><p>Guide du séminaire</p></section>
<section class="titlepage">
<img class="tp-logo" src="img/tgc-logo-on-light.png" alt="TGC">
<p class="tp-kicker">The Gymnastics Course</p>
<h1 class="tp-title">Guide du séminaire</h1>
<p class="tp-sub">{pt("f02", "Manuel du participant")}</p>
<div class="tp-foot"><img class="tp-ceu" src="img/ceu-approved.png" alt="CrossFit Approved CEU Provider"><p>{pt("f02", "Édition 2026")}</p><p>{pt("f02", "© 2026 BirdBox Coaching Limited. Tous droits réservés.<br>Aucune partie de ce manuel ne peut être copiée ou partagée sans autorisation écrite.")}</p><p>BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland<br>birdboxcoaching.com</p></div>
</section>
<section class="toc"><h1 class="toc-h">{pt("f03", "Sommaire")}</h1><ol class="toc-list">{toc}</ol></section>

{ch(1)}<p>The Gymnastics Course est un séminaire de développement du coaching professionnel. Il est dispensé et développé par une équipe de coachs experts qui viennent des quatre coins du globe. Cette équipe a pour objectif de décupler le potentiel des coachs, gérants de salle et athlètes. Nous souhaitons jouer un rôle dans l’amélioration de vos entrainements ainsi que dans le développement de vos objectifs liés au fitness. Notre objectif est d’utiliser les informations et la méthodologie de la gymnastique et du mouvement corporel pour améliorer votre entraînement et votre coaching, comme nous le faisons depuis plus d’une décennie.</p>
<figure class="team"><img src="img/photo-team-2026.jpg" alt="L’équipe de coachs TGC, 2026"><figcaption>{pt("f04", "Team Summit 2026 : Majorque, Espagne")}</figcaption></figure>
<p>{pt("f05", "Ce manuel")} est un support à ce que vous découvrirez lors de notre séminaire en présentiel. Il a été conçu pour vous aider, vous guider et faciliter votre apprentissage. Celui-ci vous permettra de suivre de manière précise le déroulé du cours et de devenir un acteur principal dans votre apprentissage. Cependant sachez que {pt("f05", "ce manuel")} ne reprend pas tous les éléments abordés lors de ce séminaire.</p>
<p>Si vous souhaitez approfondir votre apprentissage à votre rythme avec The Gymnastics Course, vous pouvez également apprendre de manière interactive grâce à notre cours en ligne. Nous offrons une réduction significative pour toutes personnes ayant participé au séminaire en présentiel, afin de proposer une expérience éducative totale et profonde. Ce document contient des images et des explications qui suivent les différents points importants du {pt("f06", "séminaire The Gymnastics Course")}. Des espaces libres sont prévus pour que vous puissiez ajouter vos notes tout au long du cours. L’objectif est de vous permettre de retenir un maximum d’information, de la meilleure façon possible.</p>
</section>

{ch(2)}<ol class="mission-list">
<li>Notre objectif est de vous aider à comprendre les bénéfices de la recherche de la virtuosité de vos mouvements.</li>
<li>Nous nous efforçons de vous donner la capacité de déceler les fautes d’exécution dans les mouvements de gymnastique sur la base de l’examen des limitations et d’établir des interventions et des progressions appropriées. Tout cela dans le but de mettre en œuvre un entrainement et un coaching efficient, efficace et sécuritaire.</li>
<li>Nous travaillons à développer de votre regard de coach, qui vous permettra d’améliorer votre capacité à diagnostiquer les erreurs dans vos mouvements et dans ceux des autres. En simplifiant les points de performance des mouvements de gymnastique et en comprenant les bases d’anthropométrie et de physique, nous développons votre esprit critique autour du mouvement.</li>
<li>Notre but est de vous démontrer les bénéfices physiques et neurologiques du développement du travail stricts avant celui du travail en kipping, particulièrement dans la recherche de la virtuosité.</li>
<li>Nous vous aiderons à développer un état d’esprit du développement aussi bien dans votre apprentissage que dans vos performances.</li>
</ol>
<figure class="fill-bottom"><img src="img/photo-p03.jpg" alt=""></figure>
</section>

{ch(3)}<div class="terms">
<p class="term"><b>Un Athlète</b> – Un athlète est une personne qui a une forte capacité pour entrer en compétition et gagner contre les autres. {pt("f07", "Un repère pour un athlète serait d’évoluer au plus haut niveau de son sport ou de se classer dans le top 5 d’une compétition nationale ou internationale.")}</p>
<p class="term"><b>Analyse des besoins</b> – L’analyse des besoins est un processus formel et systématique d’identification et d’évaluation des besoins d’entrainement à mettre en place pour aider au développement d’un athlète en fonction des exigences de son sport, sa vie ou ses blessures.</p>
<p class="term"><b>Règles</b> – Une règle est basée sur des principes qui sont des normes suggérées pour aider à corriger et développer un athlète de manière sécuritaire. Une règle peut être enfreinte et est dictée par vous-même ou un autre coach.</p>
<p class="term"><b>Loi</b> – Une loi est une règle beaucoup plus stricte qui doit être respectée. Transgresser cette loi n’est pas une option car elle est limitée par la science. Par exemple, la loi de Newton sur la gravité ne peut être modifiée ou contournée.</p>
<p class="term"><b>Virtuosité</b> – En gymnastique, la virtuosité est définie comme étant « un mouvement ordinaire exécuté de manière extraordinaire ». (Greg Glassman 2005)</p>
<p class="term"><b>Maitrise</b> – La maîtrise et l’expertise sont définis comme étant « l’amélioration de la capacité d’un athlète à utiliser efficacement son potentiel moteur » {pt("f08", "(BirdBox Coaching, 2020)")}</p>
<p class="term"><b>Tissu actif</b> – Le tissu actif est la capacité d’engager des muscles qui vont favoriser le maintien d’une position et permettre de rester une unité solide.</p>
<p class="term"><b>Hollow</b> – C’est une position utilisée pour créer de la stabilité, caractérisée par une forte contraction de la ligne médiane avec des tissus actifs des orteils jusqu’au bout des doigts. Souvenez-vous que le Hollow est une ligne droite avec une rétroversion du bassin.</p>
<p class="term"><b>Strict</b> – Un mouvement sans élan. L’athlète ne se repose que sur sa force et le contrôle musculaire pour réaliser le mouvement.</p>
<p class="term"><b>Kip</b> – Un changement agressif de direction avec de la vitesse qui amène un changement de plan ou de position pour réaliser un pattern de mouvement.</p>
<p class="term"><b>Technique</b> – La manière ou méthode d’effectuer un mouvement correctement en recherchant la perfection.</p>
<p class="term"><b>Agrès statique</b> – Un agrès stable et qui ne bouge pas (le sol ou les barres).</p>
<p class="term"><b>Agrès dynamique</b> – Un agrès instable et en mouvement (les anneaux)</p>
<p class="term"><b>Mobilité</b> – Mouvement autour d’une articulation.</p>
<p class="term"><b>Souplesse Active</b> – Contraction des muscles opposés pour étirer ou maintenir une position.</p>
<p class="term"><b>Souplesse Passive</b> – Etirement d’un muscle sans nécessité la contraction des muscles opposés.</p>
<p class="term"><b>ROM (Range Of Motion)</b> – Amplitude articulaire.</p>
<p class="term"><b>EROM (Extended Range of Motion)</b> – Amplitude Articulaire étendue.</p>
<p class="term"><b>Spotting</b> – Assistance donner à un athlète dans le cadre d’une progression ou pour prévenir les blessures.</p>
<p class="term"><b>Tension</b> – Peut-être définit comme un état de raideur. S’oppose au terme « relâchement » et « décontraction ». (Fowler &amp; Crystal 2010)</p>
</div>
<figure class="fill-bottom"><img src="img/photo-p05.jpg" alt=""></figure>
</section>

{ch(4)}<h2>La pyramide théorique du développement selon The Gymnastics Course</h2>
<div class="pyr-split">
<div><p>Chez The Gymnastics Course, nous soulignons le fait que le CrossFit est un programme de préparation physique générale. Il est donc important que, lors de notre travail avec un athlète ou client, nous établissions une analyse des besoins. Comprendre les besoins et les exigences d’un athlète, de son sport ou de sa vie est essentiel lors de la création du programme d’entrainement.</p>
<p>La gymnastique est purement et simplement un travail basé sur le poids du corps, tout comme la façon dont nous déplaçons notre corps dans l’espace. Sur ce principe, nous devrions nous concentrer sur la gymnastique avant le conditionnement métabolique car celle-ci est le fondement même de nos mouvements et de notre biomécanique. Si un individu a une mauvaise biomécanique (mouvement humain), il est suggéré que sa capacité à effectuer un travail de conditionnement métabolique serait vaine ou pourrait amener à une blessure.</p></div>
<figure class="pyramid-img">{pt("f09", PYR)}</figure>
</div>
<figure class="fill-bottom"><img src="img/photo-p06.jpg" alt=""></figure>
</section>

{ch(5)}<p class="rule">Règle numéro 1 : <span>Le statique avant le dynamique</span></p>
<p class="rule">Règle numéro 2 : <span>Le strict avant le kipping</span></p>
<p>La force est nécessaire pour avoir une bonne technique, une bonne technique est impérative pour avoir une bonne maitrise de son corps. C’est pour cela que la gymnastique met un accent clair sur la force dans les mouvements au poids du corps. La technique dans l’exécution des mouvements stricts va permettre la maitrise du mouvement, c’est pour cette raison que nous encourageons les mouvements stricts avant d’appliquer de l’élan. L’effort nécessaire au travail de la maitrise des mouvements stricts n’est pas vain, il vous fera gagner en force et réduira considérablement le risque de blessure. Les petits mouvements apportent de grandes récompenses. Ne survolez pas ces mouvements. Vous les apprendrez et les maitriserez !</p>
<p>Pour faire preuve de maitrise dans tous nos mouvements, nous devons avoir une conscience et une maitrise de notre corps des plus vertueuse. Pour acquérir cette conscience et ce contrôle, nous devons exécuter toutes les actions avec la bonne technique. Pour avoir cette bonne technique nous devons avoir la force nécessaire dans toute l’amplitude du mouvement, du début à la fin. Tout manque de force dans l’amplitude articulaire compromettra la position et causera l’application de force dans de mauvaises directions. De plus, sans force aucun mouvement ne peut avoir lieu.</p>
<p>Pour améliorer la qualité de mouvement d’un athlète, nous expliquons un procédé qui aide les coachs à être plus efficient. Les différentes options qui s’offrent au coach pour le développement du mouvement sont les consignes verbales, les contraintes physiques et les interventions de coaching.</p>
<blockquote class="big">« La force est impérative pour avoir une bonne technique et une bonne technique est impérative pour avoir une bonne maitrise et une bonne conscience de son corps. »</blockquote>
<figure class="quote-photo"><img src="img/photo-p07.jpg" alt=""></figure>
<p class="rule">Règle numéro 3 :<br><span>Construire une base isométrique</span></p>
<p class="rule">Règle numéro 4 :<br><span>Utiliser le travail en excentrique comme outil de développement de la force et de la position.</span></p>
<p>Une contraction isométrique à lieu lorsque le muscle est sous tension et reste de la même longueur. L’entrainement isométrique est primordial pour la stabilité articulaire et le développement du tissu conjonctif. Une contraction excentrique à lieu lorsque le muscle est sous tension et que celui-ci s’étire. L’entrainement excentrique présente de nombreux avantages, notamment des changements architecturaux au niveau du muscle qui entrainent un développement de la force. Une contraction concentrique à lieu lorsque le muscle est sous tension et que celui-ci se raccourci. {pt("f10", "À l’entraînement")} nous effectuons des contractions concentriques quotidiennement. Nous devons donc prendre en considération notre façon de développer de la force chez nos athlètes et les risques associés à ces différents types de contractions. Ces risques seront présentés durant la partie programmation du séminaire.</p>
<div class="notes-inline">{lines(7)}</div>
</section>

{ch(6)}<p>Les <b><i>consignes verbales</i></b> sont directement données à l’athlète afin de créer un changement dans la position de l’athlète.</p>
<p>Les <b><i>contraintes</i></b> sont des tâches ou des exercices qui ne créeront pas de changement dans la longueur du muscle ni dans sa force, mais l’aideront à travailler plus dur vers l’atteinte de certaines positions.</p>
<p>Les <b><i>interventions</i></b> sont utilisées quand les consignes verbales et les contraintes deviennent inefficaces. Elles conduisent à la modification de la longueur ou de la force du tissu musculaire, dans le but d’améliorer le mouvement.</p>
<p>Tout au long du séminaire, nous vous donnerons différents exemples de consignes verbales, contraintes et interventions. Ci-dessous, une illustration de la façon de décider efficacement quand utiliser une consigne verbale, une contrainte ou une intervention.</p>
<figure class="mda">{pt("f11", MDA)}</figure>
</section>

{ch(7)}<p>En tant que coach et/ou athlète, il est crucial de comprendre les positions d’un mouvement. Ici, nous vous présentons une série d’images qui mettant en avant les points clés pour développer le mouvement. En comprenant et en pratiquant ces positions clés vous développerez votre technique et améliorerez vos performances tout en réduisant le risque de blessures.</p>
<p>Nous vous encourageons fortement à prendre des notes pour chaque image lorsque que nous les abordons durant le séminaire et à les introduire dans vos routines d’entrainement.</p>
<h2 class="mv">Mouvements</h2>
{ex_html}
</section>

{ch(8)}<p>Durant la partie programmation nous approfondissons le sujet de la programmation. Sur ce support nous souhaitons mettre en avant certains éléments clés.</p>
<h2>La progression linéaire</h2>
<p>La progression linéaire est une méthode d’entraînement qui consiste à augmenter progressivement la difficulté ou le volume d’un exercice au fil du temps afin de stimuler les progrès et l’adaptation. Cette méthode est couramment utilisée en musculation pour aider les athlètes à développer la force et l’endurance nécessaires pour effectuer des mouvements ou des levées plus avancés.</p>
<p>En utilisant la progression linéaire à l’entraînement, les athlètes peuvent augmenter progressivement leur force et leur endurance d’une manière sûre et efficace. Il est important de noter que la progression linéaire doit être utilisée en accord avec une forme et une technique appropriée afin d’éviter les blessures et d’assurer des résultats optimaux. Nous aimons utiliser cette méthode de progression linéaire dans nos programmes de gymnastique.</p>
<p>Beaucoup de personnes utilisent des pourcentages en haltérophilie, mais peu de gens les utilisent en gymnastique. En gymnastique, l’intensité est le % du 1 RM ou le TST (temps sous tension). Le volume total est le nombre total de répétitions ou le temps total sous tension.</p>
<p>Vous trouverez ci-dessous deux exemples de progression linéaire pour le développement des tractions strictes. Comme vous pouvez le constater, nous chargeons toujours la première série de la séance afin de créer une surcharge progressive. Nous aimons commencer cette progression avec 40 %. L’exemple ci-dessous est basé sur une série maximale de 10 tractions vertueuses strictes.</p>
<div class="keep"><p class="tcap">Exemple de progression linéaire avec % de 1RM :</p>
<table class="prog"><thead><tr><th>{pt("f15", "Semaine")}</th><th>{pt("f15", "Séance 1")}</th><th>{pt("f15", "Séance 2")}</th><th>{pt("f15", "Séance 3")}</th></tr></thead><tbody>
<tr><td>1.</td><td>4-4-4</td><td>5-4-4</td><td>5-5-4</td></tr>
<tr><td>2.</td><td>5-5-5</td><td>6-5-5</td><td>6-6-5</td></tr>
<tr><td>3.</td><td>6-6-6</td><td>7-6-6</td><td>7-7-6</td></tr>
<tr><td>4.</td><td>7-7-7</td><td>8-7-7</td><td>8-8-7</td></tr>
<tr><td>5.</td><td>8-8-8</td><td>9-8-8</td><td>9-9-8</td></tr>
<tr><td>6.</td><td colspan="3">Retest</td></tr>
</tbody></table>
<p class="foot">*Adaptez ce cycle avec le nombre de votre série maximale.</p></div>
<p>Si vous n’êtes pas en mesure de faire un pull-up strict, nous devons développer votre force en travaillant le temps sous tension. Dans ce cas, commencez par l’exemple de progression ci-dessous. Le premier chiffre correspond à la position statique du menton au-dessus de la barre et le second à l’excentrique. Si vous n’êtes pas en mesure de contrôler et de maintenir ces positions avec tout le poids de votre corps, réduisez l’effort en utilisant un point d’appui sur les orteils.</p>
<div class="keep"><p class="tcap">Exemple de progression linéaire avec TST :</p>
<table class="prog"><thead><tr><th>{pt("f15", "Semaine")}</th><th>{pt("f15", "Séance 1")}</th><th>{pt("f15", "Séance 2")}</th><th>{pt("f15", "Séance 3")}</th></tr></thead><tbody>
<tr><td>1.</td><td>3/3 - 3/3 - 3/3</td><td>4/4 - 3/3 - 3/3</td><td>4/4 - 4/4 - 3/3</td></tr>
<tr><td>2.</td><td>4/4 - 4/4 - 4/4</td><td>5/5 - 4/4 - 4/4</td><td>5/5 - 5/5 - 4/4</td></tr>
<tr><td>3.</td><td>5/5 - 5/5 - 5/5</td><td>6/6 - 5/5 - 5/5</td><td>6/6 - 6/6 - 5/5</td></tr>
<tr><td>Retest</td><td colspan="3" class="note">Testez à nouveau vos tractions strictes. Si vous êtes capable d’en faire une, continuez avec la session 1, semaine 4. Si vous n’y arrivez pas, continuez à augmenter le TST de vos séries. Si vous avez utilisé un point d’appui sur les orteils au cours des trois premières semaines, recommencez à la semaine 1 et utilisez le poids total de votre corps.</td></tr>
<tr><td>4.</td><td>1-1-1</td><td>2-1-1</td><td>2-2-1</td></tr>
<tr><td>5.</td><td>2-2-2</td><td>3-2-2</td><td>3-3-2</td></tr>
<tr><td>6.</td><td>3-3-3</td><td>4-3-3</td><td>4-4-3</td></tr>
</tbody></table>
<p class="foot">*Si vous avez réussi à terminer la progression complète, vous pouvez maintenant commencer avec l’exemple du %.</p></div>
<p>Vous pouvez appliquer cette progression à tous les mouvements de gymnastique. Il s’agit d’une approche très simple et facile à appliquer dans votre programmation. C’est peut-être même la meilleure approche pour la plupart de vos membres.</p>
<h2>Volume, Intensité et Fréquence</h2>
<p>Si vous souhaitez jouer avec le volume, l’intensité et la fréquence dans le cadre d’une programmation individuelle, vous trouverez ci-dessous un autre exemple de progression linéaire avec une plus grande variabilité du volume, de l’intensité et de la fréquence.</p>
<div class="keep"><p class="foot">*L’exemple ci-dessous est basé sur une série maximale de 10 tractions vertueuses strictes.</p>
<table class="prog vif"><thead><tr><th>{pt("f15", "Semaine")}</th><th>Intensité</th><th>Fréquence</th><th>Volume</th></tr></thead><tbody>
<tr><td>1.</td><td>{pt("f15", "3 séries à 40 %")}<br>4-4-4</td><td>{pt("f15", "2 séances<br>par semaine")}</td><td>{pt("f15", "24 répétitions")}</td></tr>
<tr><td>2.</td><td>3 séries à 40 %<br>4-4-4</td><td>2 séances<br>par semaine</td><td>24 répétitions</td></tr>
<tr><td>3.</td><td>3 séries à 50 %<br>5-5-5</td><td>2 séances<br>par semaine</td><td>30 répétitions</td></tr>
<tr><td>4.</td><td>3 séries à 50 %<br>5-5-5</td><td>2 séances<br>par semaine</td><td>30 répétitions</td></tr>
<tr><td>5.</td><td>4 séries à 40 %<br>4-4-4-4</td><td>2 séances<br>par semaine</td><td>32 répétitions</td></tr>
<tr><td>6.</td><td>4 séries à 40 %<br>4-4-4-4</td><td>2 séances<br>par semaine</td><td>32 répétitions</td></tr>
<tr><td>7.</td><td>3 séries à 40 %<br>4-4-4</td><td>3 séances<br>par semaine</td><td>36 répétitions</td></tr>
<tr><td>8.</td><td>3 séries à 40 %<br>4-4-4</td><td>3 séances<br>par semaine</td><td>36 répétitions</td></tr>
</tbody></table></div>
<p>Comme vous pouvez le constater, l’intensité, le volume et la fréquence ne varient que toutes les deux semaines. Après les deux premières semaines, nous avons augmenté l’intensité. Après quatre semaines, nous avons réduit l’intensité mais augmenté le volume. Au cours des semaines sept et huit, nous avons {pt("f16", "augmenté la fréquence")}. En jouant avec le volume, l’intensité et la fréquence, vous pouvez voir comment le volume total augmente. Vous pouvez également appliquer ce principe aux contractions isométriques ou à la charge excentrique.</p>
<p>Dans l’exemple, vous pouvez voir que le volume en gymnastique est faible. En haltérophilie, vous n’obtiendrez pas de gain sur votre charge avec ce volume. En gymnastique, nous obtenons une évolution dans les adaptations par le temps sous tension et le travail en tempo, et non par le volume. Occasionnellement, nous pouvons utiliser un volume plus élevé, mais c’est le temps sous tension et le tempo que nous devons vraiment utiliser.</p>
<p>Reprenons l’exemple de progression linéaire avec % de 1RM, en faisant notre série de 4-4-4 tractions strictes, nous nous suspendons en hollow pendant 5 secondes, nous effectuons un travail concentrique de 3 secondes, nous maintenons notre menton au-dessus de la barre pendant 3 secondes et nous effectuons un travail excentrique de 5 secondes vers le bas pour les 4 répétitions. Nous voulons développer la technique et la virtuosité, et non le volume et l’intensité.</p>
<div class="notes-inline">{lines(10)}</div>
</section>
<section class="endblank"></section>
</body>
</html>
'''
open(OUT, "w").write(page)
print("wrote", OUT)
