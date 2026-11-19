# Italian edition of the TGC Seminar Guide, in the 2026 design.
# Wording: the 2023 Italian guide, verbatim, EXCEPT where
# Nathan's approved English decisions (review/decisions.json) change the meaning. Each such spot is
# wrapped in <span data-pt="gNNN"> so the review page can show it; the span has no visual effect.
# usage: build_html_pt.py <out.html>
import sys, html, json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from exercises import EX
from exercises_it import EX_IT as EX_PT
from diagrams import pyramid, mda

OUT = sys.argv[1]
e = html.escape
_X = os.path.join(HERE, "extra-lines-it.json")
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

# Changes for Nathan to approve (cards i13-i15), applied in the preview:
EX_PT = [list(x) for x in EX_PT]
EX_PT[19][1] = EX_PT[19][1][:3] + ["Rimani appeso in un allineamento rettilineo neutro"]
EX_PT[41][0] = "Low ring pass-out – braccia larghe"
EX_PT[42][0] = "Low ring pass-out – braccia in avanti"
EX_PT[42][1] = EX_PT[42][1][:2] + ["Braccia vicino alle orecchie (al telefono)"]
assert len(EX) == len(EX_PT) == 52
ex_html = "\n".join(exercise(i, en[0], en[2], ptx[0], ptx[1]) for i, (en, ptx) in enumerate(zip(EX, EX_PT), 1))

CHAPTERS = ["INTRODUZIONE", "LA NOSTRA MISSIONE", "DEFINIZIONI &amp; TERMINOLOGIA", "CENNI METODOLOGICI",
            "REGOLE DI ALLENAMENTO", "SVILUPPO DEL MOVIMENTO", "GUIDA DELLA PROGRESSIONE DEL MOVIMENTO", "PROGRAMMAZIONE"]
_T = os.path.join(HERE, "toc-pages-it.json")
TOCP = json.load(open(_T)) if os.path.exists(_T) else {}
toc = "".join(f'<li><span class="toc-n">{i}</span><span class="toc-t">{t}</span><span class="toc-p" data-ch="Capitolo {i}">{TOCP.get(str(i), "")}</span></li>'
              for i, t in enumerate(CHAPTERS, 1))
def ch(i):
    return f'<section class="chapter" id="ch{i}"><header><p class="chapter-no">Capitolo {i}</p><h1>{CHAPTERS[i-1]}</h1></header>\n'

# Diagrams with Portuguese labels (layout identical to the approved English redraws g008/g010)
PYR = pyramid()
for a, b in [(">NUTRITION<", ">NUTRIZIONE<"), (">GYMNASTICS<", ">GINNASTICA<"), (">METABOLIC CONDITIONING<", ">CONDIZIONAMENTO METABOLICO<"),
             (">WEIGHTLIFTING<", ">SOLLEVAMENTO PESI<"), (">&amp; THROWING<", ">&amp; LANCI<"), (">SPORT<", ">SPORT<"),
             ('aria-label="Hierarchy of development: nutrition, gymnastics, metabolic conditioning, weightlifting and throwing, sport"',
              'aria-label="Gerarchia dello sviluppo: nutrizione, ginnastica, condizionamento metabolico, sollevamento pesi e lanci, sport"')]:
    assert a in PYR, a; PYR = PYR.replace(a, b)
PYR = PYR.replace('font-size="11"', 'font-size="9.5"', 1).replace('font-size="11"', 'font-size="11"')
MDA = mda()
for a, b in [(">MOVEMENT DEVELOPMENT APPROACH<", ">APPROCCIO ALLO SVILUPPO DEL MOVIMENTO<"),
             (">The athlete presents movement<", ">L’atleta presenta il movimento<"),
             (">Poor Movement<", ">Movimento scorretto<"), (">Good Movement<", ">Movimento corretto<"),
             (">Attempt to fix by<", ">Tentare di correggere<"), (">using a cue.<", ">con un consiglio.<"),
             (">Negative correction<", ">Correzione negativa<"), (">with the cue.<", ">con il consiglio.<"),
             (">Positive correction<", ">Correzione positiva<"),
             (">Attempt to correct<", ">Tentare di correggere<"), (">athlete with a<", ">l’atleta con<"), (">constraint.<", ">un vincolo.<"),
             (">with a constraint.<", ">con il vincolo.<"),
             (">Reinforce, cue<", ">Rinforzare, dare consigli<"), (">and reward<", ">e premiare<"),
             (">Devise and develop interventions to do with the<", ">Ideare e sviluppare interventi con l’atleta<"),
             (">athlete to help improve their movement pattern<", ">per aiutarlo a migliorare il suo schema motorio<"),
             ('aria-label="Movement development approach flow chart"', 'aria-label="Diagramma dello sviluppo del movimento"')]:
    assert a in MDA, a; MDA = MDA.replace(a, b)
MDA = MDA.replace('font-size="24"', 'font-size="20"', 1)
# "Reforçar, dar indicações e recompensar" is too wide for two lines: set it on three
_m = re.search(r'<text x="([\d.]+)" y="([\d.]+)"([^>]*)>Rinforzare, dare consigli</text><text x="[\d.]+" y="([\d.]+)"[^>]*>e premiare</text>', MDA)
assert _m, "reinforce box"
_x, _y1, _attrs, _y2 = _m.group(1), float(_m.group(2)), re.sub(r'font-size="[\d.]+"', 'font-size="16"', _m.group(3)), float(_m.group(4))
_mid = (_y1 + _y2) / 2
MDA = MDA.replace(_m.group(0), "".join(f'<text x="{_x}" y="{_mid + d:.1f}"{_attrs}>{t}</text>' for d, t in ((-20, "Rinforzare,"), (1, "dare consigli"), (22, "e premiare"))))




page = f'''<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>The Gymnastics Course – Guida del seminario</title>
<link rel="stylesheet" href="../manual.css">
<link rel="stylesheet" href="tgc.css">
<style>
@page :right {{ @top-right {{ content: "Guida del seminario"; }} }}
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
<!-- The Gymnastics Course – Guida del seminario (Italian). Generated by review/build_html_it.py from the 2023 Italian guide;
     spots changed for Nathan's decisions are marked data-pt="iNN". -->
<div class="cover">
  <div class="photo" style="background-image:url('img/cover-top.jpg')"></div>
  <div class="photo2" style="background-image:url('img/cover-photo.jpg')"></div>
  <div class="body">
    <img class="logo dark" src="../../brand/tgc-mark.png" alt="TGC">
    <img class="logo light" src="img/tgc-logo-on-light.png" alt="TGC">
    <p class="kicker">Guida del seminario</p>
    <h1 class="title">{pt("i01", "The Gymnastics Course")}</h1>
  </div>
</div>
<section class="halftitle"><p>Guida del seminario</p></section>
<section class="titlepage">
<img class="tp-logo" src="img/tgc-logo-on-light.png" alt="TGC">
<p class="tp-kicker">The Gymnastics Course</p>
<h1 class="tp-title">Guida del seminario</h1>
<p class="tp-sub">{pt("i02", "Manuale del partecipante")}</p>
<div class="tp-foot"><img class="tp-ceu" src="img/ceu-approved.png" alt="CrossFit Approved CEU Provider"><p>{pt("i02", "Edizione 2026")}</p><p>{pt("i02", "© 2026 BirdBox Coaching Limited. Tutti i diritti riservati.<br>Nessuna parte di questo manuale può essere copiata o condivisa senza autorizzazione scritta.")}</p><p>BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland<br>birdboxcoaching.com</p></div>
</section>
<section class="toc"><h1 class="toc-h">{pt("i03", "Indice")}</h1><ol class="toc-list">{toc}</ol></section>

{ch(1)}<p>Il Gymnastics Course è un seminario di sviluppo del coaching professionale. Guidato e sviluppato da un team di esperti allenatori provenienti da tutto il mondo, mirato a creare ed estrapolare il potenziale di trainers, coach, proprietari di palestre e atleti. Speriamo di svolgere un ruolo nella tua capacità di allenarti meglio e crescere verso i tuoi obiettivi di fitness. Il nostro obiettivo è utilizzare le informazioni e la metodologia della ginnastica e del movimento del corpo per aumentare le tue abilità nel tuo allenamento e nel coaching come abbiamo fatto per oltre un decennio.</p>
<figure class="team"><img src="img/photo-team-2026.jpg" alt="Il team di allenatori TGC, 2026"><figcaption>{pt("i04", "Team Summit 2026: Maiorca, Spagna")}</figcaption></figure>
<p>{pt("i05", "Questo manuale")} è un documento di supporto per le cose che scoprirai partecipando al nostro seminario dal vivo. Questo documento di supporto è stato progettato per aiutare a suggerire, ricordare e facilitare l’apprendimento. Permettendoti di emergere nell’ambiente di apprendimento e diventare uno studente attivo quando frequenti il nostro corso. Si prega di notare che {pt("i05", "questo manuale")} non cattura ogni singolo elemento discusso nel nostro corso.</p>
<p>Sperando che tu voglia esplorare un’opportunità di apprendimento più profonda con il Gymnastics Course, migliorando l’apprendimento del tuo seminario dal vivo. In tal caso, puoi anche imparare in modo interattivo online con il nostro corso online di autoapprendimento. Offriamo uno sconto significativo a tutti i partecipanti ai seminari dal vivo, contribuendo a costruire un’esperienza di apprendimento profonda e completa. {pt("i05", "Il seguente manuale")} conterrà immagini e spiegazioni che seguono i nostri punti critici per il {pt("i06", "seminario The Gymnastics Course")}. Ci saranno spazi assegnati attraverso {pt("i05", "questo manuale")} per aggiungere le tue note mentre svolgi questo corso. Con l’obiettivo di aiutarti a conservare attivamente le informazioni nel miglior modo possibile.</p>
</section>

{ch(2)}<ol class="mission-list">
<li>Il nostro obiettivo è aiutarti a comprendere i vantaggi di perseguire il virtuosismo, in particolare applicato al movimento e alla ginnastica.</li>
<li>Ci sforziamo di darti la possibilità di diagnosticare errori nei movimenti di ginnastica sulla base della valutazione dei limiti, stabilire interventi e progressioni appropriati e implementare con successo l’allenamento e il coaching della ginnastica per migliorare la sicurezza, l’efficacia e l’efficienza.</li>
<li>Lavoreremo per creare un sostanziale sviluppo dell’occhio da coach che migliorerà la tua capacità di diagnosticare errori di movimento in te stesso e negli altri semplificando i punti di prestazione della ginnastica, comprendendo l’antropometria e la fisica individuali di base e la capacità di pensare in modo critico al movimento.</li>
<li>Il nostro obiettivo è aiutarti a comprendere i benefici fisici e neurologici della costruzione di movimenti strict prima dei movimenti di kipping, specialmente se applicati alla ricerca del virtuosismo.</li>
<li>Ti aiuteremo a coltivare una mentalità di crescita per quanto riguarda il tuo apprendimento e le tue prestazioni.</li>
</ol>
<figure class="fill-bottom"><img src="img/photo-p03.jpg" alt=""></figure>
</section>

{ch(3)}<div class="terms">
<p class="term"><b>Un Atleta</b> – Un atleta è qualcuno con la capacità d’élite di competere e vincere contro gli altri. {pt("i07", "Un marcatore relativo per un atleta sarebbe competere al massimo livello del proprio sport o prendere una posizione tra i primi 5 in una competizione nazionale o internazionale.")}</p>
<p class="term"><b>Analisi delle necessità</b> – L’analisi dei bisogni è un processo formale e sistematico di identificazione e valutazione dell’allenamento che dovrebbe essere fatto per aiutare a sviluppare un atleta verso i requisiti del suo sport, di vita o per evitare un infortunio.</p>
<p class="term"><b>Regole</b> – Una regola si basa su principi; sono standard suggeriti per aiutare a correggere e sviluppare in sicurezza un atleta; una regola può essere infranta ed è governata da te stesso o da un allenatore.</p>
<p class="term"><b>Leggi</b> – Una legge è una regola molto più rigida che deve essere rispettata. Infrangere la legge non è un’opzione in quanto ciò è limitato dalla scienza. Ad esempio, le leggi gravitazionali di Newton non possono essere modificate o piegate.</p>
<p class="term"><b>{pt("i08", "Virtuosismo")}</b> – {pt("i08", "Il virtuosismo, però, è tutta un’altra cosa. In ginnastica il virtuosismo è definito come “eseguire il comune in modo non comune”. (Greg Glassman, 2005)")}</p>
<p class="term"><b>{pt("i08", "Maestria")}</b> – {pt("i08", "La maestria è definita come “il miglioramento dell’abilità di un atleta nell’utilizzare efficacemente il proprio potenziale motorio”")} {pt("i09", "(BirdBox Coaching, 2020)")}</p>
<p class="term"><b>{pt("i08", "Tessuto attivo")}</b> – {pt("i08", "Il tessuto attivo è la capacità di contrarre i muscoli per aiutare a mantenere le posizioni nel loro insieme, rimanendo un’unica unità solida.")}</p>
<p class="term"><b>Hollow</b> – {pt("i08", "Una posizione usata per creare stabilità, caratterizzata da una forte contrazione della linea mediana con tessuto attivo dalle dita dei piedi alle dita delle mani. Ricorda che la posizione hollow è una linea retta con retroversione del bacino.")}</p>
<p class="term"><b>Strict</b> – Movimento assente di kip. L’atleta fa affidamento sul controllo muscolare e sulla forza per completare il movimento.</p>
<p class="term"><b>Kip</b> – Un cambio di direzione aggressivo a velocità che porta a un cambiamento di piano o posizione per ottenere uno schema di movimento.</p>
<p class="term"><b>Forma</b> – Il modo o il metodo per eseguire correttamente un movimento mentre si cerca la perfezione.</p>
<p class="term"><b>Attrezzo Statico</b> – Stabile e non si muove (pavimento e sbarre).</p>
<p class="term"><b>Attrezzo Dinamico</b> – Instabile e si muove (anelli).</p>
<p class="term"><b>Mobilità</b> – Movimento attorno a un’articolazione.</p>
<p class="term"><b>Flessibilità Attiva</b> – Contrazione dei muscoli opposti per allungare o mantenere una posizione.</p>
<p class="term"><b>Flessibilità Passiva</b> – Allungamento di un muscolo che non richiede la contrazione dei muscoli opposti.</p>
<p class="term"><b>ROM</b> – Range di movimento.</p>
<p class="term"><b>EROM</b> – Range di movimento esteso.</p>
<p class="term"><b>Spotting</b> – Fornire assistenza a un atleta se necessario come parte di una progressione o per prevenire lesioni.</p>
<p class="term"><b>Tensione</b> – La tensione, come parola, può essere definita come "lo stato di essere teso" e l’opposto sarebbe "lasso" o "sciolto" (Fowler &amp; Crystal, 2010).</p>
</div>
<figure class="fill-bottom"><img src="img/photo-p05.jpg" alt=""></figure>
</section>

{ch(4)}<h2>Gerarchia teorica dello sviluppo del Gymnastics Course</h2>
<div class="pyr-split">
<div><p>Noi di The Gymnastics Course evidenziamo che CrossFit è un programma di allenamento per la forza e il condizionamento. Pertanto, quando lavoriamo con un atleta o un cliente, dovremmo fare un’analisi dei bisogni. Comprendere le esigenze e i bisogni di un atleta, le sue esigenze sportive o di vita e progettare il suo programma di allenamento in base alle discrepanze tra i due.</p>
<p>La ginnastica è un movimento puramente a corpo libero. Di conseguenza, come muovi il tuo corpo attraverso lo spazio, teorizziamo che dobbiamo concentrarci sulla ginnastica prima del condizionamento metabolico poiché questa è la nostra base per il movimento, la biomeccanica. Se un individuo dovesse avere una scarsa biomeccanica (movimento umano), si può suggerire che la capacità di raggiungere il condizionamento metabolico sarebbe nulla o a rischio di lesioni.</p></div>
<figure class="pyramid-img">{pt("i10", PYR)}</figure>
</div>
<figure class="fill-bottom"><img src="img/photo-p06.jpg" alt=""></figure>
</section>

{ch(5)}<p class="rule">Regola numero 1: <span>Statico prima di dinamico</span></p>
<p class="rule">Regola numero 2: <span>Strict prima di kipping</span></p>
<p>La forza è necessaria per la forma corretta e la forma corretta è necessaria per dimostrare il controllo del corpo. In quanto tale, la ginnastica pone una chiara enfasi sulla forza nei movimenti a corpo libero. Più di ogni altra cosa, la forma strict stabilisce la maestria in un movimento e, per questo motivo, promuoviamo il movimento strict prima di applicare il kipping. La forza acquisita dalla padronanza dei movimenti strict vale lo sforzo e la possibilità di lesioni si riduce sostanzialmente quando si praticano prima i movimenti strict. Piccole mosse porteranno grandi ricompense. Non affrettare questi movimenti. Imparali e guadagnateli!</p>
<p>Per presentare la maestria in tutti i nostri movimenti, dobbiamo avere una consapevolezza e un controllo del corpo virtuosi. Per ottenere questa consapevolezza e controllo del corpo, dobbiamo eseguire tutti i movimenti con la forma corretta. Per ottenere la forma corretta, dobbiamo avere la forza necessaria attraverso l’intera gamma di movimento, dall’inizio alla fine. Qualsiasi mancanza di forza attraverso un raggio di movimento comprometterà una posizione che fa sì che le forze vengano inviate nelle direzioni sbagliate. In alternativa, non si verificherà alcuna azione poiché la forza è nulla.</p>
<p>Quando miriamo a sviluppare il movimento di un atleta, spieghiamo un processo che consente agli allenatori di trovare una maggiore efficacia. Le opzioni come coach per i cambiamenti nello sviluppo del movimento sono segnali di coaching, vincoli di coaching e interventi di coaching.</p>
<blockquote class="big">“La forza è un imperativo per la forma corretta,<br>e la forma corretta è indispensabile per la consapevolezza e il controllo del corpo{pt("i16", ".")}”</blockquote>
<figure class="quote-photo"><img src="img/photo-p07.jpg" alt=""></figure>
<p class="rule">Regola numero 3:<br><span>Costruisci una base isometrica.</span></p>
<p class="rule">Regola numero 4:<br><span>Utilizzare il carico eccentrico come strumento di sviluppo della forza e della posizione.</span></p>
<p>Le contrazioni isometriche sono dove il muscolo è {pt("i11", "sotto")} carico o tensione rimanendo della stessa lunghezza. L’allenamento isometrico è essenziale per la stabilizzazione articolare e lo sviluppo del tessuto connettivo. Il carico eccentrico è dove un muscolo è {pt("i11", "sotto")} carico o tensione, ma il muscolo si sta allungando. L’eccentrica porterà a molti noti benefici, in particolare cambiamenti nell’architettura muscolare che portano allo sviluppo della forza. Le contrazioni concentriche sono dove un muscolo è {pt("i11", "sotto")} carico o tensione, ma il muscolo si accorcia allo stesso tempo. Eseguiamo sempre contrazioni concentriche {pt("i12", "nell’allenamento")}. Pertanto, dobbiamo considerare come sviluppiamo la forza nei nostri membri e i rischi di ogni strumento di contrazione: questi rischi ti vengono delineati durante la nostra lezione di programmazione del corso.</p>
<div class="notes-inline">{lines(7)}</div>
</section>

{ch(6)}<p><b><i>Consigli di coaching</i></b> sono indirizzati all’atleta affinché effettui un cambio di posizione utilizzando la comunicazione verbale.</p>
<p><b><i>Vincoli di coaching</i></b> sono compiti o esercizi che non interferiscono con la lunghezza o la forza di un muscolo, ma aiutano a far lavorare duramente un individuo verso posizioni migliori all’interno di un movimento scelto.</p>
<p><b><i>Interventi di Coaching</i></b> vengono utilizzati quando consigli e vincoli diventano inefficaci. Portando al cambiamento di lunghezza o forza del tessuto muscolare, con l’obiettivo di migliorare i movimenti.</p>
<p>Durante il seminario dal vivo, forniamo molteplici aspetti di consigli, interventi e vincoli di coaching. Di seguito è riportato un esempio di come decidere in modo efficace quando utilizzare un consiglio, un vincolo o un intervento.</p>
<figure class="mda">{pt("i13", MDA)}</figure>
</section>

{ch(7)}<p>Come atleta e/o allenatore, è fondamentale comprendere le posizioni nei movimenti. Qui presenteremo una serie di immagini che mostrano posizioni chiave per lo sviluppo. Comprendendo e praticando queste posizioni chiave, puoi sviluppare le tue capacità, migliorare le tue prestazioni e ridurre il rischio di lesioni.</p>
<p>Ti invitiamo ad aggiungere in modo proattivo note a ciascuna immagine se le esaminiamo nel seminario e incorporiamo queste posizioni nella tua routine di allenamento.</p>
<h2 class="mv">Movimenti</h2>
{ex_html}
</section>

{ch(8)}<p>Durante la lezione di programmazione andiamo molto più in profondità. Qui vorremmo condividere alcuni elementi chiave di questa lezione. Copriamo molte informazioni importanti, ma qui stiamo evidenziando alcuni aspetti chiave.</p>
<h2>Progressione Lineare</h2>
<p>La progressione lineare è un metodo di allenamento che prevede l’aumento graduale della difficoltà o del volume di un esercizio nel tempo per stimolare il progresso e l’adattamento. Questo metodo è comunemente usato nell’allenamento della forza per aiutare gli atleti a sviluppare la forza e la resistenza necessarie per eseguire movimenti o sollevamenti più avanzati. Utilizzando la progressione lineare nell’allenamento, gli atleti possono aumentare gradualmente la loro forza e resistenza in modo sicuro ed efficace. È importante notare che la progressione lineare dovrebbe essere utilizzata in combinazione con una forma e una tecnica adeguate per evitare lesioni e garantire risultati ottimali. Ci piace usare questo metodo di progressione lineare nei nostri programmi di ginnastica.</p>
<p>Molte persone usano le percentuali nel loro sollevamento pesi, ma non molte persone usano le percentuali nella loro ginnastica. Nella ginnastica, l’intensità è la % di 1RM o TUT (tempo {pt("i11", "sotto")} tensione). Il volume totale è la quantità totale di ripetizioni o il tempo totale {pt("i11", "sotto")} tensione.</p>
<p>Di seguito troverai due esempi di progressione lineare per lo sviluppo del pull-up strict. Come puoi vedere, carichiamo sempre in anticipo il primo set della sessione in modo da poter creare un sovraccarico progressivo. Ci piace iniziare questa progressione con il 40%. Il primo esempio di seguito si basa su un set massimo di 10 pull-up strict e virtuosi.</p>
<div class="keep"><p class="tcap">Esempio di progressione lineare con % di 1RM:</p>
<table class="prog"><thead><tr><th>{pt("i14", "Settimana")}</th><th>{pt("i14", "Sessione 1")}</th><th>{pt("i14", "Sessione 2")}</th><th>{pt("i14", "Sessione 3")}</th></tr></thead><tbody>
<tr><td>1.</td><td>4-4-4</td><td>5-4-4</td><td>5-5-4</td></tr>
<tr><td>2.</td><td>5-5-5</td><td>6-5-5</td><td>6-6-5</td></tr>
<tr><td>3.</td><td>6-6-6</td><td>7-6-6</td><td>7-7-6</td></tr>
<tr><td>4.</td><td>7-7-7</td><td>8-7-7</td><td>8-8-7</td></tr>
<tr><td>5.</td><td>8-8-8</td><td>9-8-8</td><td>9-9-8</td></tr>
<tr><td>6.</td><td colspan="3">Retest</td></tr>
</tbody></table>
<p class="foot">*Ricomincia questo ciclo con il tuo nuovo numero del tuo set massimo.</p></div>
<p>Se non sei in grado di eseguire un pull-up strict, dobbiamo sviluppare la forza e lo faremo lavorando a tempo {pt("i11", "sotto")} tensione. In questo caso, inizia con l’esempio di progressione di seguito. Il primo numero è per una presa del mento sopra la barra e il secondo numero è per l’eccentrico. Salta in posizione per iniziare il tuo set. Se non sei in grado di controllare e mantenere queste posizioni con tutto il tuo peso corporeo, scalalo usando il toe spotting.</p>
<div class="keep"><p class="tcap">Esempio di progressione lineare con il TUT:</p>
<table class="prog"><thead><tr><th>{pt("i14", "Settimana")}</th><th>{pt("i14", "Sessione 1")}</th><th>{pt("i14", "Sessione 2")}</th><th>{pt("i14", "Sessione 3")}</th></tr></thead><tbody>
<tr><td>1.</td><td>3/3 - 3/3 - 3/3</td><td>4/4 - 3/3 - 3/3</td><td>4/4 - 4/4 - 3/3</td></tr>
<tr><td>2.</td><td>4/4 - 4/4 - 4/4</td><td>5/5 - 4/4 - 4/4</td><td>5/5 - 5/5 - 4/4</td></tr>
<tr><td>3.</td><td>5/5 - 5/5 - 5/5</td><td>6/6 - 5/5 - 5/5</td><td>6/6 - 6/6 - 5/5</td></tr>
<tr><td>Retest</td><td colspan="3" class="note">Ritesta il tuo strict pull-up. Se sei in grado di farne uno, continua con la sessione 1, settimana 4. Se non sei in grado di farne uno, continua con il caricamento frontale dei secondi sul tuo set. Se hai usato il toe spotting nelle prime tre settimane, ricomincia dalla settimana 1 e usa tutto il tuo peso corporeo.</td></tr>
<tr><td>4.</td><td>1-1-1</td><td>2-1-1</td><td>2-2-1</td></tr>
<tr><td>5.</td><td>2-2-2</td><td>3-2-2</td><td>3-3-2</td></tr>
<tr><td>6.</td><td>3-3-3</td><td>4-3-3</td><td>4-4-3</td></tr>
</tbody></table>
<p class="foot">*Se sei riuscito a completare l’intera progressione, ora puoi ricominciare con l’esempio %</p></div>
<p>Puoi applicare questa progressione a ogni movimento di ginnastica. Questo è un approccio molto semplice e facile da applicare nella tua programmazione. Forse anche per la maggior parte della tua base di membri l’approccio migliore.</p>
<h2>Volume, Intensità e Frequenza</h2>
<p>Se vuoi giocare con volume, intensità e frequenza per la programmazione individuale e vuoi capirlo più a fondo, di seguito puoi trovare un altro esempio di progressione lineare con più variabilità di volume, intensità e frequenza.</p>
<div class="keep"><p class="foot">*L’esempio seguente si basa su un set massimo di 10 pull-up strict e virtuosi{pt("i16", ".")}</p>
<table class="prog vif"><thead><tr><th>{pt("i14", "Settimana")}</th><th>{pt("i14", "Intensità")}</th><th>{pt("i14", "Frequenza")}</th><th>Volume</th></tr></thead><tbody>
<tr><td>1.</td><td>{pt("i14", "3 serie al 40%")}<br>4-4-4</td><td>{pt("i14", "2 sessioni<br>a settimana")}</td><td>{pt("i14", "24 ripetizioni")}</td></tr>
<tr><td>2.</td><td>3 serie al 40%<br>4-4-4</td><td>2 sessioni<br>a settimana</td><td>24 ripetizioni</td></tr>
<tr><td>3.</td><td>3 serie al 50%<br>5-5-5</td><td>2 sessioni<br>a settimana</td><td>30 ripetizioni</td></tr>
<tr><td>4.</td><td>3 serie al 50%<br>5-5-5</td><td>2 sessioni<br>a settimana</td><td>30 ripetizioni</td></tr>
<tr><td>5.</td><td>4 serie al 40%<br>4-4-4-4</td><td>2 sessioni<br>a settimana</td><td>32 ripetizioni</td></tr>
<tr><td>6.</td><td>4 serie al 40%<br>4-4-4-4</td><td>2 sessioni<br>a settimana</td><td>32 ripetizioni</td></tr>
<tr><td>7.</td><td>3 serie al 40%<br>4-4-4</td><td>3 sessioni<br>a settimana</td><td>36 ripetizioni</td></tr>
<tr><td>8.</td><td>3 serie al 40%<br>4-4-4</td><td>3 sessioni<br>a settimana</td><td>36 ripetizioni</td></tr>
</tbody></table></div>
<p>Come puoi vedere l’intensità, il volume e la frequenza sono gli stessi per ogni due settimane. Dopo le prime due settimane abbiamo aumentato l’intensità. Dopo la terza e la quarta settimana abbiamo ridotto l’intensità per la quinta e la sesta settimana, ma abbiamo aumentato il volume. Nella settima e nell’ottava settimana abbiamo aumentato la frequenza. Giocando con il volume, l’intensità e la frequenza puoi vedere come stanno salendo quei numeri. Puoi applicarlo anche alle contrazioni isometriche o al carico eccentrico.</p>
<p>{pt("i15", "Nell’esempio puoi vedere che il volume nella ginnastica è basso. Nel sollevamento pesi non otterrai sovraccarico facendolo a questo volume. Nella ginnastica otteniamo un sovraccarico negli adattamenti in base al tempo sotto tensione e al tempo di lavoro, non in base al volume. Di tanto in tanto si può usare un volume più alto, ma è il tempo sotto tensione e il tempo che dobbiamo davvero usare.")}</p>
<p>Ciò significa che se eseguiamo la nostra serie di 4-4-4 pull-up strict rimarremo fermi in hollow per 5 secondi, faremo un concentrico di 3 secondi, terremo il mento sopra la barra per 3 secondi, faremo un eccentrico di 5 secondi verso il basso per tutte e 4 le ripetizioni. Vogliamo allenare posizioni e perfezione, non volume e intensità.</p>
<div class="notes-inline">{lines(10)}</div>
</section>
<section class="endblank"></section>
</body>
</html>
'''
open(OUT, "w").write(page)
print("wrote", OUT)
