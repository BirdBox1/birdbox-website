# Spanish edition of the TGC Seminar Guide, in the 2026 design.
# Wording: the 2023 Spanish guide, verbatim, EXCEPT where
# Nathan's approved English decisions (review/decisions.json) change the meaning. Each such spot is
# wrapped in <span data-pt="gNNN"> so the review page can show it; the span has no visual effect.
# usage: build_html_pt.py <out.html>
import sys, html, json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from exercises import EX
from exercises_es import EX_ES as EX_PT, NEW
from diagrams import pyramid, mda

OUT = sys.argv[1]
e = html.escape
_X = os.path.join(HERE, "extra-lines-es.json")
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

# Same movement fixes Nathan approved for the English/Portuguese editions (cards s15-s17):
EX_PT = [list(x) for x in EX_PT]
for _i in (3, 4, 5):   # Hollow completo, Arco asistido, Arco completo: "length and tension" in English
    EX_PT[_i][1] = [b.replace("Busca la compresión y tensión", "Busca la longitud y tensión") for b in EX_PT[_i][1]]
EX_PT[24][1] = [b.replace("Las piernas se mantienen totalmente rectas", "Los brazos y las piernas se mantienen totalmente rectos") for b in EX_PT[24][1]]
EX_PT[41][0] = "“Pass-out” en anillas bajas – brazos hacia los lados"
EX_PT[42][0] = "“Pass-out” en anillas bajas – brazos hacia delante"
assert len(EX) == len(EX_PT) == 52
ex_html = "\n".join(exercise(i, en[0], en[2], ptx[0], ptx[1]) for i, (en, ptx) in enumerate(zip(EX, EX_PT), 1))

CHAPTERS = ["INTRODUCCIÓN", "NUESTRA MISIÓN", "DEFINICIONES Y VOCABULARIO", "NUESTRA METODOLOGÍA",
            "REGLAS DEL ENTRENAMIENTO", "EL DESARROLLO DEL MOVIMIENTO", "GUÍA DE LA PROGRESIÓN DEL MOVIMIENTO", "PROGRAMACIÓN"]
_T = os.path.join(HERE, "toc-pages-es.json")
TOCP = json.load(open(_T)) if os.path.exists(_T) else {}
toc = "".join(f'<li><span class="toc-n">{i}</span><span class="toc-t">{t}</span><span class="toc-p" data-ch="Capítulo {i}">{TOCP.get(str(i), "")}</span></li>'
              for i, t in enumerate(CHAPTERS, 1))
def ch(i):
    return f'<section class="chapter" id="ch{i}"><header><p class="chapter-no">Capítulo {i}</p><h1>{CHAPTERS[i-1]}</h1></header>\n'

# Diagrams with Portuguese labels (layout identical to the approved English redraws g008/g010)
PYR = pyramid()
for a, b in [(">NUTRITION<", ">NUTRICIÓN<"), (">GYMNASTICS<", ">GIMNASIA<"), (">METABOLIC CONDITIONING<", ">ACONDICIONAMIENTO METABÓLICO<"),
             (">WEIGHTLIFTING<", ">HALTEROFILIA<"), (">&amp; THROWING<", ">Y LANZAMIENTOS<"), (">SPORT<", ">DEPORTE<"),
             ('aria-label="Hierarchy of development: nutrition, gymnastics, metabolic conditioning, weightlifting and throwing, sport"',
              'aria-label="Jerarquía del desarrollo: nutrición, gimnasia, acondicionamiento metabólico, halterofilia y lanzamientos, deporte"')]:
    assert a in PYR, a; PYR = PYR.replace(a, b)
PYR = PYR.replace('font-size="11"', 'font-size="9.5"', 1).replace('font-size="11"', 'font-size="11"')
MDA = mda()
for a, b in [(">MOVEMENT DEVELOPMENT APPROACH<", ">ENFOQUE DEL DESARROLLO DEL MOVIMIENTO<"),
             (">The athlete presents movement<", ">El atleta presenta el movimiento<"),
             (">Poor Movement<", ">Movimiento incorrecto<"), (">Good Movement<", ">Movimiento correcto<"),
             (">Attempt to fix by<", ">Intentar corregir<"), (">using a cue.<", ">con una indicación.<"),
             (">Negative correction<", ">Corrección negativa<"), (">with the cue.<", ">con la indicación.<"),
             (">Positive correction<", ">Corrección positiva<"),
             (">Attempt to correct<", ">Intentar corregir<"), (">athlete with a<", ">al atleta con<"), (">constraint.<", ">una limitación.<"),
             (">with a constraint.<", ">con la limitación.<"),
             (">Reinforce, cue<", ">Reforzar, dar indicaciones<"), (">and reward<", ">y recompensar<"),
             (">Devise and develop interventions to do with the<", ">Crear y desarrollar intervenciones con el atleta<"),
             (">athlete to help improve their movement pattern<", ">para ayudar a mejorar su patrón de movimiento<"),
             ('aria-label="Movement development approach flow chart"', 'aria-label="Diagrama de flujo del desarrollo del movimiento"')]:
    assert a in MDA, a; MDA = MDA.replace(a, b)
MDA = MDA.replace('font-size="24"', 'font-size="20"', 1)
# "Reforçar, dar indicações e recompensar" is too wide for two lines: set it on three
_m = re.search(r'<text x="([\d.]+)" y="([\d.]+)"([^>]*)>Reforzar, dar indicaciones</text><text x="[\d.]+" y="([\d.]+)"[^>]*>y recompensar</text>', MDA)
assert _m, "reinforce box"
_x, _y1, _attrs, _y2 = _m.group(1), float(_m.group(2)), re.sub(r'font-size="[\d.]+"', 'font-size="16"', _m.group(3)), float(_m.group(4))
_mid = (_y1 + _y2) / 2
MDA = MDA.replace(_m.group(0), "".join(f'<text x="{_x}" y="{_mid + d:.1f}"{_attrs}>{t}</text>' for d, t in ((-20, "Reforzar,"), (1, "dar indicaciones"), (22, "y recompensar"))))


page = f'''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>The Gymnastics Course – Guía del seminario</title>
<link rel="stylesheet" href="../manual.css">
<link rel="stylesheet" href="tgc.css">
<style>
@page :right {{ @top-right {{ content: "Guía del seminario"; }} }}
@page titlep:right {{ @top-right {{ content: none; }} }}
/* Spanish runs longer than English: slightly smaller photos so each chapter keeps its pages */
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
<!-- The Gymnastics Course – Guía del seminario (Spanish). Generated by review/build_html_es.py from the 2023 Spanish guide;
     spots changed to follow Nathan's decisions are marked data-pt="sNN"; movements 11-16 are new translations. -->
<div class="cover">
  <div class="photo" style="background-image:url('img/cover-top.jpg')"></div>
  <div class="photo2" style="background-image:url('img/cover-photo.jpg')"></div>
  <div class="body">
    <img class="logo dark" src="../../brand/tgc-mark.png" alt="TGC">
    <img class="logo light" src="img/tgc-logo-on-light.png" alt="TGC">
    <p class="kicker">Guía del seminario</p>
    <h1 class="title">{pt("s01", "The Gymnastics Course")}</h1>
  </div>
</div>
<section class="halftitle"><p>Guía del seminario</p></section>
<section class="titlepage">
<img class="tp-logo" src="img/tgc-logo-on-light.png" alt="TGC">
<p class="tp-kicker">The Gymnastics Course</p>
<h1 class="tp-title">Guía del seminario</h1>
<p class="tp-sub">{pt("s02", "Manual del participante")}</p>
<div class="tp-foot"><img class="tp-ceu" src="img/ceu-approved.png" alt="CrossFit Approved CEU Provider"><p>{pt("s02", "Edición 2026")}</p><p>{pt("s02", "© 2026 BirdBox Coaching Limited. Todos los derechos reservados.<br>Ninguna parte de este manual puede copiarse ni compartirse sin autorización por escrito.")}</p><p>BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland<br>birdboxcoaching.com</p></div>
</section>
<section class="toc"><h1 class="toc-h">{pt("s03", "Índice")}</h1><ol class="toc-list">{toc}</ol></section>

{ch(1)}<p>The Gymnastics Course es un seminario de desarrollo del coaching profesional, brindado y dirigido por un equipo de entrenadores expertos, provenientes de todas partes del mundo, que apuntan a crear y obtener el mayor potencial posible de entrenadores profesionales, dueños de gimnasios y atletas. Esperamos desempeñar un papel en el desarrollo de su capacidad para entrenar mejor, y así poder crecer y estar cada vez más cerca de sus objetivos de fitness. Nuestra meta es emplear la información y metodología de la gimnasia y del movimiento del propio cuerpo, para así mejorar el entrenamiento y el coaching, tal y como lo hemos hecho nosotros a lo largo de estos últimos diez años.</p>
<figure class="team"><img src="img/photo-team-2026.jpg" alt="El equipo de entrenadores TGC, 2026"><figcaption>{pt("s04", "Team Summit 2026: Mallorca, España")}</figcaption></figure>
<p>{pt("s05", "Este manual")} es un documento que acompaña todo lo que descubrirán al participar en nuestro seminario presencial. Ha sido diseñado para iniciar, recordar y facilitar el aprendizaje. Les permitirá aprender de manera activa al participar del seminario. Por favor, tengan en cuenta que {pt("s05", "este manual")} no contiene toda la información mencionada durante el fin de semana.</p>
<p>Si desean seguir aprendiendo con The Gymnastics Course y afianzar lo visto en el seminario presencial, pueden estudiar a su propio ritmo con nuestro curso online. Se les puede brindar, a todos aquellos que han participado del seminario presencial, un descuento significativo, ayudando así a construir una experiencia de aprendizaje más profunda y completa. {pt("s05", "Este manual")} contiene imágenes, textos explicativos e informativos que siguen los puntos clave del {pt("s06", "seminario The Gymnastics Course")}. Habrá espacios asignados para que puedan tomar sus propios apuntes a lo largo del curso, permitiéndoles retener la información de la mejor manera posible.</p>
</section>

{ch(2)}<ol class="mission-list">
<li>Buscamos ayudar a hacerles entender los beneficios de perseguir el virtuosismo, especialmente cuando se trata de aplicarlo a los movimientos gimnásticos.</li>
<li>Apuntamos a desarrollar su capacidad para ver los errores en los movimientos gimnásticos, basándose en el asesoramiento de limitaciones físicas, las herramientas para aplicar intervenciones y progresiones apropiadas e implementar de manera exitosa un entrenamiento gimnástico, que con coaching mejorará la seguridad, eficacia y eficiencia.</li>
<li>Trabajaremos para desarrollar de manera significativa el ojo del coach, y así mejorar su habilidad para diagnosticar errores, tanto en sus propios movimientos, como en los de los demás. Esto se logrará simplificando los puntos de rendimiento de los movimientos gimnásticos, entendiendo la antropometría de un individuo y física básica y, por último, analizando un movimiento de manera crítica.</li>
<li>Queremos ayudar a hacerles ver la importancia de crear movimientos estrictos antes de ir al kipping, dadas las adaptaciones neurológicas y físicas que conlleva el trabajo estricto, especialmente cuando vamos en búsqueda del virtuosismo.</li>
<li>Ayudaremos a crear una mentalidad de crecimiento aplicada a su propio entrenamiento y rendimiento.</li>
</ol>
<figure class="fill-bottom"><img src="img/photo-p03.jpg" alt=""></figure>
</section>

{ch(3)}<div class="terms">
<p class="term"><b>Un Atleta</b> – Un atleta es alguien capaz de competir y ganarle a otros en categoría élite. {pt("s07", "Un marcador para definir a una persona como atleta sería competir al más alto nivel de su deporte, o quedar en el top 5 de una competición nacional o internacional.")}</p>
<p class="term"><b>Análisis de necesidades</b> – El análisis de necesidades es un proceso formal y sistemático para identificar y evaluar el entrenamiento que debería llevarse a cabo para ayudar al atleta a mejorar en su deporte, en su vida o su lesión.</p>
<p class="term"><b>Reglas</b> – Una regla se basa en principios, son estándares sugeridos para ayudar a corregir y desarrollar a un atleta de manera segura, las reglas se pueden romper ya que son impuestas por los entrenadores mismos.</p>
<p class="term"><b>Leyes</b> – Una ley es una regla mucho más estricta, que deberá ser cumplida obligatoriamente. Quebrantar la ley no es una opción ya que está basada en la ciencia. Por ejemplo, la ley gravitacional de Newton no se puede ni cambiar ni infringir.</p>
<p class="term"><b>Virtuosismo</b> – El virtuosismo se define, en la gimnasia, de la siguiente manera: “realizar lo común tan bien que está fuera de lo común” (Greg Glassman, 2005).</p>
<p class="term"><b>Maestría</b> – La maestría se define como “la mejora de la habilidad de un atleta para usar su potencial motor de forma efectiva” {pt("s08", "(BirdBox Coaching, 2020)")}.</p>
<p class="term"><b>{pt("s09", "Tejido activo")}</b> – {pt("s09", "El tejido activo")} es aquel que se contrae para ayudar a mantener las formas y posturas en una unidad sólida. Se puede decir que está el “tejido activo” cuando se contrae.</p>
<p class="term"><b>Hollow</b> – Una postura usada para crear estabilidad. Se caracteriza por una contracción de la zona media y tejido activo desde los dedos del pie hasta los dedos de la mano. Recordemos que el hollow es una línea recta con una retroversión pélvica.</p>
<p class="term"><b>Estricto</b> – Movimiento que carece de “kip”. El atleta hace uso de su control muscular y fuerza para completar el movimiento.</p>
<p class="term"><b>Kip</b> – Un cambio brusco de dirección, con velocidad, generando un cambio en el plano o patrón de movimiento.</p>
<p class="term"><b>Forma</b> – La manera o la metodología para realizar un movimiento correctamente, buscando la perfección.</p>
<p class="term"><b>Aparato estático</b> – Es un aparato estable, no se mueve (suelo y barras).</p>
<p class="term"><b>Aparato dinámico</b> – Es un aparato inestable, se mueve (anillas).</p>
<p class="term"><b>Movilidad</b> – El movimiento alrededor de una articulación.</p>
<p class="term"><b>Flexibilidad activa</b> – Es la amplitud máxima de una articulación o de un movimiento que puede alcanzar una persona sin ayuda externa, lo cual sucede únicamente a través de la contracción y distensión voluntaria de los músculos del cuerpo.</p>
<p class="term"><b>Flexibilidad pasiva</b> – Es la amplitud máxima de una articulación o de un movimiento a través de la acción de fuerzas externas, es decir, mediante la ayuda de un compañero, un aparato, el propio peso corporal etc.</p>
<p class="term"><b>ROM</b> – Rango de movimiento.</p>
<p class="term"><b>EROM</b> – Rango de movimiento en extensión.</p>
<p class="term"><b>Spotting</b> – Brindarle asistencia a un atleta como parte de una progresión o para prevenir una lesión.</p>
<p class="term"><b>Tensión</b> – Se puede definir la tensión como “el punto en el que se está totalmente extendido y tenso”. Lo opuesto sería estar “flojo” o “dejado”. (Fowler &amp; Crystal, 2010).</p>
</div>
<figure class="fill-bottom"><img src="img/photo-p05.jpg" alt=""></figure>
</section>

{ch(4)}<h2>Pirámide del desarrollo teórico de un atleta según The Gymnastics Course</h2>
<div class="pyr-split">
<div><p>En el curso de gimnasia destacamos que CrossFit es un programa de entrenamiento de fuerza y acondicionamiento. Por lo tanto, al trabajar con un atleta o cliente, debemos hacer un análisis de sus necesidades. Entender las necesidades y requisitos de un atleta, sus requisitos deportivos o de vida y diseñar un programa de entrenamiento en torno a las discrepancias entre ambos.</p>
<p>La gimnasia es puro movimiento del propio peso corporal. En otras palabras, es la forma en que el cuerpo se mueve a través del espacio; de hecho, se dice que teóricamente debemos centrarnos en la gimnasia antes que en el acondicionamiento metabólico, ya que ésta es nuestra base para el movimiento. Estamos hablando de biomecánica. Si un individuo tiene una mala biomecánica (movimiento humano), se puede decir que la capacidad de lograr el acondicionamiento metabólico será nula o correrá el riesgo de lesionarse.</p></div>
<figure class="pyramid-img">{pt("s10", PYR)}</figure>
</div>
<figure class="fill-bottom"><img src="img/photo-p06.jpg" alt=""></figure>
</section>

{ch(5)}<p class="rule">Regla #1: <span>Estático antes que dinámico</span></p>
<p class="rule">Regla #2: <span>Estricto antes que kipping</span></p>
<p>La fuerza es imprescindible para lograr la forma adecuada, y la forma adecuada es imprescindible para la conciencia y el control corporal. La gimnasia pone un claro énfasis en los movimientos a peso corporal. Sobre todo, un movimiento estricto demuestra dominio de un movimiento, es por esto que fomentamos el movimiento estricto antes de añadirle inercia. La fuerza adquirida mediante el trabajo estricto valdrá la pena, ya que se reduce significativamente el riesgo de lesión. Pequeños pasos traerán grandes recompensas. Evita la prisa; los movimientos se aprenden y se ganan.</p>
<p>Para demostrar dominio en todos los movimientos, debemos ser conscientes de nuestras formas y tener un control corporal virtuoso. Para adquirir esto, debemos ejecutar toda acción con la forma correcta. Para lograr la forma correcta, hay que tener la fuerza suficiente para realizar el rango de movimiento completo de principio a fin. La falta de fuerza comprometerá la posición, provocando que las fuerzas se envíen en direcciones incorrectas. Además, si no hay fuerza, no se podrá realizar la acción.</p>
<p>Apuntamos a desarrollar el movimiento de un atleta, y para ello explicamos cuál es el proceso que le permitirá al coach encontrar la forma más efectiva de hacerlo. Para desarrollar un movimiento, las opciones que tiene el entrenador son: usar indicaciones, limitaciones o intervenciones.</p>
<blockquote class="big">“La fuerza es imprescindible para lograr la forma adecuada, y la forma adecuada es imprescindible para la conciencia y el control corporal.”</blockquote>
<figure class="quote-photo"><img src="img/photo-p07.jpg" alt=""></figure>
<p class="rule">Regla #3:<br><span>Construye una base isométrica.</span></p>
<p class="rule">Regla #4:<br><span>Utiliza la carga excéntrica como herramienta para el desarrollo de la fuerza y de las posiciones.</span></p>
<p>Las contracciones isométricas son aquellas donde el músculo se mantiene del mismo largo cuando se encuentra bajo carga o tensión. Entrenar los isométricos es esencial para la estabilización de la articulación y el desarrollo del tejido conectivo. Las contracciones excéntricas son aquellas donde el músculo se alarga mientras está bajo carga o tensión. Los beneficios de las cargas excéntricas son muchos, especialmente a la hora de hablar del cambio en la estructura del músculo para el desarrollo de la fuerza. Las contracciones concéntricas son aquellas donde el músculo se acorta mientras está bajo carga o tensión. {pt("s11", "En el entrenamiento")}, se realizan muchas contracciones concéntricas. Debemos tener en cuenta cómo queremos desarrollar la fuerza de nuestros atletas y qué riesgos trae cada una de estas contracciones. Estos riesgos se detallan en nuestra charla de programación.</p>
<div class="notes-inline">{lines(7)}</div>
</section>

{ch(6)}<p>Las <b><i>indicaciones</i></b> son dirigidas directamente al atleta para intentar crear un cambio a nivel posicional, utilizando la comunicación verbal.</p>
<p>Las <b><i>restricciones o limitaciones</i></b> son tareas o ejercicios que no intervienen en la longitud o la fuerza del músculo, si no que ayudan a que el individuo trabaje duro para mantener mejores formas y posiciones en un movimiento.</p>
<p>Las <b><i>intervenciones</i></b> son usadas cuando las indicaciones y restricciones no fueron efectivas. Buscan crear un cambio en la longitud y la fuerza del tejido muscular para así mejorar el movimiento.</p>
<p>Durante el seminario presencial, hablamos sobre diversos aspectos de las indicaciones, intervenciones y limitaciones. Pueden ver a continuación una ilustración de cómo decidir de manera efectiva si utilizar una indicación, una limitación o una intervención.</p>
<figure class="mda">{pt("s12", MDA)}</figure>
</section>

{ch(7)}<p>Como atleta y/o entrenador, es crucial entender las posiciones que hay dentro de los movimientos. A continuación, les pondremos una serie de imágenes que muestran las posiciones clave para el desarrollo. Al entender y practicar estas posiciones clave, pueden desarrollar sus habilidades, mejorar su rendimiento y reducir el riesgo de una lesión.</p>
<p>Les animamos a que añadan sus notas a las imágenes durante el seminario y que incorporen estas posiciones en su rutina diaria de entrenamiento.</p>
<h2 class="mv">Movimientos</h2>
{ex_html}
</section>

{ch(8)}<p>Durante nuestra charla sobre programación, entramos más en detalle. A continuación les compartimos algunos elementos clave de esta charla. Abarcamos mucha información importante; aquí resaltamos algunos aspectos para tener en cuenta.</p>
<h2>Progresión lineal</h2>
<p>La progresión lineal es un método en el cual se incrementa gradualmente la dificultad o el volumen de un ejercicio a lo largo del tiempo para estimular la progresión y la adaptación del cuerpo. Este método se utiliza comúnmente en los entrenamientos de fuerza para ayudar a que los atletas desarrollen su fuerza y la resistencia necesaria para realizar movimientos avanzados o levantamientos. Al utilizar una progresión lineal en el entrenamiento, los atletas pueden incrementar gradualmente su fuerza y resistencia de manera segura y efectiva. Es importante destacar que la progresión lineal debería realizarse en conjunto con una buena forma y técnica para evitar lesiones y asegurar los mejores resultados posibles. Nos gusta utilizar este método de progresión lineal en nuestras programaciones gimnásticas.</p>
<p>Muchas personas utilizan porcentajes para sus levantamientos pero no para los gimnásticos. En la gimnasia, la intensidad es el % de la repetición máxima (1 RM) o del TUT (tiempo bajo tensión). El volumen total es el total de repeticiones o de tiempo bajo tensión.</p>
<p>A continuación, encontrarán un ejemplo de una progresión lineal para el desarrollo de la dominada estricta. Verán que siempre se carga la primera serie de la sesión para poder crear una sobrecarga progresiva. Nos gusta empezar esta progresión con el 40%. Este primer ejemplo se basa en una serie máxima de 10 dominadas estrictas virtuosas.</p>
<div class="keep"><p class="tcap">Ejemplo de progresión lineal con el % del 1 RM:</p>
<table class="prog"><thead><tr><th>Semana</th><th>Sesión 1</th><th>Sesión 2</th><th>Sesión 3</th></tr></thead><tbody>
<tr><td>1.</td><td>4-4-4</td><td>5-4-4</td><td>5-5-4</td></tr>
<tr><td>2.</td><td>5-5-5</td><td>6-5-5</td><td>6-6-5</td></tr>
<tr><td>3.</td><td>6-6-6</td><td>7-6-6</td><td>7-7-6</td></tr>
<tr><td>4.</td><td>7-7-7</td><td>8-7-7</td><td>8-8-7</td></tr>
<tr><td>5.</td><td>8-8-8</td><td>9-8-8</td><td>9-9-8</td></tr>
<tr><td>6.</td><td colspan="3">Retest</td></tr>
</tbody></table>
<p class="foot">*Comienza el ciclo de nuevo basado en el nuevo número de la serie máxima</p></div>
<p>Si no es capaz de hacer una dominada estricta, debemos desarrollar la fuerza pasando tiempo bajo tensión. En este caso, se utilizaría el ejemplo detallado a continuación. El primer número sería para aguantar con la barbilla por encima de la barra y el segundo número sería para el excéntrico. Empieza la serie saltando a la primera posición de barbilla por encima de la barra. Si no es capaz de soportar todo su peso corporal, se puede usar la asistencia del dedo del pie como escalamiento.</p>
<div class="keep"><p class="tcap">Ejemplo de progresión lineal con tiempo bajo tensión:</p>
<table class="prog"><thead><tr><th>Semana</th><th>Sesión 1</th><th>Sesión 2</th><th>Sesión 3</th></tr></thead><tbody>
<tr><td>1.</td><td>3/3 - 3/3 - 3/3</td><td>4/4 - 3/3 - 3/3</td><td>4/4 - 4/4 - 3/3</td></tr>
<tr><td>2.</td><td>4/4 - 4/4 - 4/4</td><td>5/5 - 4/4 - 4/4</td><td>5/5 - 5/5 - 4/4</td></tr>
<tr><td>3.</td><td>5/5 - 5/5 - 5/5</td><td>6/6 - 5/5 - 5/5</td><td>6/6 - 6/6 - 5/5</td></tr>
<tr><td>Retest</td><td colspan="3" class="note">Vuelve a probar la dominada estricta. Si eres capaz de realizar una dominada estricta, sigue con la sesión 1 de la semana 4. Si todavía no eres capaz de realizar una, continúa añadiendo segundos a la primera serie. Si has utilizado la asistencia del dedo del pie las primeras tres semanas, comienza de nuevo sin usar la asistencia.</td></tr>
<tr><td>4.</td><td>1-1-1</td><td>2-1-1</td><td>2-2-1</td></tr>
<tr><td>5.</td><td>2-2-2</td><td>3-2-2</td><td>3-3-2</td></tr>
<tr><td>6.</td><td>3-3-3</td><td>4-3-3</td><td>4-4-3</td></tr>
</tbody></table>
<p class="foot">*Si se ha logrado completar toda la progresión, se puede ahora utilizar el ejemplo de la progresión con porcentajes mencionado al principio.</p></div>
<p>Se puede aplicar esta progresión a todos los movimientos gimnásticos. Es una manera simple de enfocarlo y es fácil de implementarlo en una programación. Tal vez sea la mejor manera de enfocarlo a nivel general para todos los miembros del gimnasio.</p>
<h2>Volumen, intensidad y frecuencia</h2>
<p>Si quieren jugar con el volumen, la intensidad y la frecuencia en una programación individual, y quieren entenderlo más en detalle, tienen abajo otro ejemplo de una progresión lineal con mayor variabilidad de volumen, intensidad y frecuencia.</p>
<div class="keep"><p class="foot">*Este ejemplo se basa en una serie máxima de 10 dominadas estrictas virtuosas.</p>
<table class="prog vif"><thead><tr><th>Semana</th><th>Intensidad</th><th>Frecuencia</th><th>Volumen</th></tr></thead><tbody>
<tr><td>1.</td><td>3 series al 40%<br>4-4-4</td><td>2 sesiones por<br>semana</td><td>24 repes</td></tr>
<tr><td>2.</td><td>3 series al 40%<br>4-4-4</td><td>2 sesiones por<br>semana</td><td>24 repes</td></tr>
<tr><td>3.</td><td>3 series al 50%<br>5-5-5</td><td>2 sesiones por<br>semana</td><td>30 repes</td></tr>
<tr><td>4.</td><td>3 series al 50%<br>5-5-5</td><td>2 sesiones por<br>semana</td><td>30 repes</td></tr>
<tr><td>5.</td><td>4 series al 40%<br>4-4-4-4</td><td>2 sesiones por<br>semana</td><td>32 repes</td></tr>
<tr><td>6.</td><td>4 series al 40%<br>4-4-4-4</td><td>2 sesiones por<br>semana</td><td>32 repes</td></tr>
<tr><td>7.</td><td>3 series al 40%<br>4-4-4</td><td>3 sesiones por<br>semana</td><td>36 repes</td></tr>
<tr><td>8.</td><td>3 series al 40%<br>4-4-4</td><td>3 sesiones por<br>semana</td><td>36 repes</td></tr>
</tbody></table></div>
<p>Como pueden ver, la intensidad, el volumen y la frecuencia son las mismas cada dos semanas. Después de las primeras dos semanas, aumenta la intensidad. Después de la tercera y cuarta semana, se reduce la intensidad para las siguientes dos semanas pero aumenta el volumen. En la semana siete y ocho, aumenta la frecuencia. Al jugar con el volumen, la frecuencia y la intensidad, podemos notar como aumentan los números. Se puede aplicar esto mismo a las contracciones isométricas y cargas excéntricas.</p>
<p>En el ejemplo, pueden ver que el volumen en los gimnásticos es bajo. En la halterofilia, no habrá adaptaciones si se trabaja con este volumen. En la gimnasia, se ganarán adaptaciones pasando tiempo bajo tensión y trabajando con tempo, no añadiendo volumen. Ocasionalmente, podemos trabajar a un volumen más alto pero lo que realmente debemos trabajar es el tiempo que pasamos bajo tensión y el tempo.</p>
<p>Esto significa que si realizamos la serie de 4-4-4 dominadas estrictas, estaríamos colgados en hollow por 5 segundos, realizaríamos un concéntrico de 3 segundos, aguantaríamos 3 segundos con la barbilla por encima de la barra y regresaríamos en 5 segundos.</p>
<p>Debemos entrenar la posición y la perfección, no el volumen ni la intensidad.</p>
<div class="notes-inline">{lines(10)}</div>
</section>
<section class="endblank"></section>
</body>
</html>
'''
open(OUT, "w").write(page)
print("wrote", OUT)
