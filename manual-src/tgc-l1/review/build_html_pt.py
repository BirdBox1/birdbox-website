# Portuguese edition of the TGC Seminar Guide, in the 2026 design.
# Wording: Amadeu's draft ("PDF Portuguese Translation.docx", 19 Nov 2026), verbatim, EXCEPT where
# Nathan's approved English decisions (review/decisions.json) change the meaning. Each such spot is
# wrapped in <span data-pt="gNNN"> so the review page can show it; the span has no visual effect.
# usage: build_html_pt.py <out.html>
import sys, html, json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from exercises import EX
from exercises_pt import EX_PT
from diagrams import pyramid, mda

OUT = sys.argv[1]
e = html.escape
_X = os.path.join(HERE, "extra-lines-pt.json")
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

assert len(EX) == len(EX_PT) == 52
ex_html = "\n".join(exercise(i, en[0], en[2], ptx[0], ptx[1]) for i, (en, ptx) in enumerate(zip(EX, EX_PT), 1))

CHAPTERS = ["INTRODUÇÃO", "A NOSSA MISSÃO", "DEFINIÇÕES E VOCABULÁRIO", "A NOSSA METODOLOGIA",
            "REGRAS DE TREINO", "O DESENVOLVIMENTO DO MOVIMENTO", "GUIA DE PROGRESSÃO DO MOVIMENTO", "PROGRAMAÇÃO"]
_T = os.path.join(HERE, "toc-pages-pt.json")
TOCP = json.load(open(_T)) if os.path.exists(_T) else {}
toc = "".join(f'<li><span class="toc-n">{i}</span><span class="toc-t">{t}</span><span class="toc-p" data-ch="Capítulo {i}">{TOCP.get(str(i), "")}</span></li>'
              for i, t in enumerate(CHAPTERS, 1))
def ch(i):
    return f'<section class="chapter" id="ch{i}"><header><p class="chapter-no">Capítulo {i}</p><h1>{CHAPTERS[i-1]}</h1></header>\n'

# Diagrams with Portuguese labels (layout identical to the approved English redraws g008/g010)
PYR = pyramid()
for a, b in [(">NUTRITION<", ">NUTRIÇÃO<"), (">GYMNASTICS<", ">GINÁSTICA<"), (">METABOLIC CONDITIONING<", ">CONDICIONAMENTO METABÓLICO<"),
             (">WEIGHTLIFTING<", ">HALTEROFILIA<"), (">&amp; THROWING<", ">E LANÇAMENTOS<"), (">SPORT<", ">DESPORTO<"),
             ('aria-label="Hierarchy of development: nutrition, gymnastics, metabolic conditioning, weightlifting and throwing, sport"',
              'aria-label="Hierarquia do desenvolvimento: nutrição, ginástica, condicionamento metabólico, halterofilia e lançamentos, desporto"')]:
    assert a in PYR, a; PYR = PYR.replace(a, b)
PYR = PYR.replace('font-size="11"', 'font-size="9.5"', 1).replace('font-size="11"', 'font-size="11"')
MDA = mda()
for a, b in [(">MOVEMENT DEVELOPMENT APPROACH<", ">ABORDAGEM AO DESENVOLVIMENTO DO MOVIMENTO<"),
             (">The athlete presents movement<", ">O atleta apresenta o movimento<"),
             (">Poor Movement<", ">Movimento incorreto<"), (">Good Movement<", ">Movimento correto<"),
             (">Attempt to fix by<", ">Tentar corrigir<"), (">using a cue.<", ">com uma indicação (cue).<"),
             (">Negative correction<", ">Correção negativa<"), (">with the cue.<", ">com a indicação.<"),
             (">Positive correction<", ">Correção positiva<"),
             (">Attempt to correct<", ">Tentar corrigir<"), (">athlete with a<", ">o atleta com<"), (">constraint.<", ">uma limitação.<"),
             (">with a constraint.<", ">com a limitação.<"),
             (">Reinforce, cue<", ">Reforçar, dar indicações<"), (">and reward<", ">e recompensar<"),
             (">Devise and develop interventions to do with the<", ">Criar e desenvolver intervenções com o atleta<"),
             (">athlete to help improve their movement pattern<", ">para ajudar a melhorar o seu padrão de movimento<"),
             ('aria-label="Movement development approach flow chart"', 'aria-label="Fluxograma da abordagem ao desenvolvimento do movimento"')]:
    assert a in MDA, a; MDA = MDA.replace(a, b)
MDA = MDA.replace('font-size="24"', 'font-size="20"', 1)
# "Reforçar, dar indicações e recompensar" is too wide for two lines: set it on three
_m = re.search(r'<text x="([\d.]+)" y="([\d.]+)"([^>]*)>Reforçar, dar indicações</text><text x="[\d.]+" y="([\d.]+)"[^>]*>e recompensar</text>', MDA)
assert _m, "reinforce box"
_x, _y1, _attrs, _y2 = _m.group(1), float(_m.group(2)), re.sub(r'font-size="[\d.]+"', 'font-size="16"', _m.group(3)), float(_m.group(4))
_mid = (_y1 + _y2) / 2
MDA = MDA.replace(_m.group(0), "".join(f'<text x="{_x}" y="{_mid + d:.1f}"{_attrs}>{t}</text>' for d, t in ((-20, "Reforçar,"), (1, "dar indicações"), (22, "e recompensar"))))

page = f'''<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<title>The Gymnastics Course – Guia do seminário</title>
<link rel="stylesheet" href="../manual.css">
<link rel="stylesheet" href="tgc.css">
<style>
/* Portuguese running head on right-hand pages */
@page :right {{ @top-right {{ content: "Guia do seminário"; }} }}
@page titlep:right {{ @top-right {{ content: none; }} }}
/* Portuguese runs longer than English: slightly smaller photos so each chapter keeps its pages */
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
<!-- The Gymnastics Course – Guia do seminário (Portuguese). Generated by review/build_html_pt.py from Amadeu's
     translation; spots changed to follow Nathan's English decisions are marked data-pt="gNNN". -->
<div class="cover">
  <div class="photo" style="background-image:url('img/cover-top.jpg')"></div>
  <div class="photo2" style="background-image:url('img/cover-photo.jpg')"></div>
  <div class="body">
    <img class="logo dark" src="../../brand/tgc-mark.png" alt="TGC">
    <img class="logo light" src="img/tgc-logo-on-light.png" alt="TGC">
    <p class="kicker">Guia do seminário</p>
    <h1 class="title">{pt("g001", "The Gymnastics Course")}</h1>
  </div>
</div>
<section class="halftitle"><p>Guia do seminário</p></section>
<section class="titlepage">
<img class="tp-logo" src="img/tgc-logo-on-light.png" alt="TGC">
<p class="tp-kicker">The Gymnastics Course</p>
<h1 class="tp-title">Guia do seminário</h1>
<p class="tp-sub">{pt("g003", "Manual do participante")}</p>
<div class="tp-foot"><img class="tp-ceu" src="img/ceu-approved.png" alt="CrossFit Approved CEU Provider"><p>{pt("g003", "Edição de 2026")}</p><p>{pt("g003", "© 2026 BirdBox Coaching Limited. Todos os direitos reservados.<br>Nenhuma parte deste manual pode ser copiada ou partilhada sem autorização por escrito.")}</p><p>BirdBox Coaching Limited · 19 Baggot Street Lower, Dublin 2, D02 X658, Ireland<br>birdboxcoaching.com</p></div>
</section>
<section class="toc"><h1 class="toc-h">{pt("g004", "Índice")}</h1><ol class="toc-list">{toc}</ol></section>

{ch(1)}<p>The Gymnastics Course é um seminário de desenvolvimento do coaching profissional. É dirigido e desenvolvido por uma equipa de treinadores especializados provenientes de várias partes do mundo, que têm como objetivo criar e alcançar o maior potencial possível de treinadores profissionais, proprietários de ginásios e atletas. Esperamos desempenhar um papel na sua capacidade de treinar melhor, para que possam crescer e aproximar-se cada vez mais dos seus objetivos de fitness. O nosso objetivo é aplicar a informação e metodologia da ginástica e do movimento do próprio corpo para melhorar o treino e o coaching, tal como temos feito ao longo destes últimos dez anos.</p>
<figure class="team"><img src="img/photo-team-2026.jpg" alt="A equipa de treinadores TGC, 2026"><figcaption>{pt("g050", "Team Summit 2026: Maiorca, Espanha")}</figcaption></figure>
<p>{pt("g013", "Este manual")} é um documento que acompanha tudo aquilo que irão descobrir ao participar no nosso seminário presencial. Foi concebido para iniciar, relembrar e facilitar a aprendizagem. Permite-lhes aprender de forma ativa enquanto participam no seminário. Por favor, tenham em atenção que {pt("g013", "este manual")} não contém toda a informação mencionada durante o fim de semana.</p>
<p>Suponhamos que gostariam de continuar a aprender com The Gymnastics Course de forma mais aprofundada, para complementar o que foi visto no seminário presencial. Se for esse o caso, podem estudar ao vosso próprio ritmo com o nosso curso online. Pode ser oferecido a todos aqueles que participaram no seminário presencial um desconto significativo, ajudando assim a construir uma experiência de aprendizagem mais profunda e completa. {pt("g013", "Este manual")} contém imagens, textos explicativos e informativos que acompanham os pontos-chave do {pt("g005", "seminário The Gymnastics Course")}. Haverá espaços reservados para que possam tomar os vossos próprios apontamentos ao longo do curso, ajudando assim a reter a informação da melhor forma possível.</p>
</section>

{ch(2)}<ol class="mission-list">
<li>Pretendemos ajudar-vos a compreender os benefícios de perseguir o virtuosismo, especialmente quando se trata de o aplicar aos movimentos ginásticos.</li>
<li>O nosso objetivo é fornecer-vos a capacidade de identificar erros nos movimentos ginásticos com base na avaliação de limitações físicas, as ferramentas para aplicar intervenções e progressões adequadas, e implementar com sucesso um treino de ginástica que, através de um bom coaching, melhore a segurança, a eficácia e a eficiência.</li>
<li>Trabalharemos para desenvolver de forma substancial o olhar técnico do coach, o que irá melhorar a capacidade de diagnosticar erros tanto nos vossos próprios movimentos como nos dos outros. Isto será alcançado através da simplificação dos pontos-chave de desempenho dos movimentos ginásticos, da compreensão da antropometria de cada indivíduo e de princípios básicos de física, e, por fim, da análise crítica do movimento.</li>
<li>Queremos ajudar-vos a reconhecer o valor de desenvolver movimentos estritos antes de passar para os movimentos com kipping, devido às adaptações neurológicas e físicas proporcionadas pelo trabalho estrito – especialmente quando o objetivo é alcançar o virtuosismo.</li>
<li>Ajudaremos a criar uma mentalidade de crescimento aplicada ao vosso próprio treino e desempenho.</li>
</ol>
<figure class="fill-bottom"><img src="img/photo-p03.jpg" alt=""></figure>
</section>

{ch(3)}<div class="terms">
<p class="term"><b>Atleta</b> – Um atleta é alguém capaz de competir e vencer outros no escalão de elite. {pt("g006", "Um critério seria competir ao mais alto nível do seu desporto, ou terminar no top 5 de uma prova nacional ou internacional.")}</p>
<p class="term"><b>Análise de necessidades</b> – Processo formal e sistemático para identificar e avaliar o treino necessário para ajudar o atleta a melhorar no seu desporto, vida ou recuperação de lesões.</p>
<p class="term"><b>Regras</b> – Baseadas em princípios, são normas sugeridas para corrigir e desenvolver o atleta em segurança. Podem ser adaptadas pelo treinador.</p>
<p class="term"><b>Leis</b> – Normas rigorosas que devem ser cumpridas, baseadas em ciência. Não podem ser quebradas (ex: a lei da gravidade de Newton).</p>
<p class="term"><b>Virtuosismo</b> – Em ginástica: “fazer o comum tão bem que se torna extraordinário” (Greg Glassman, 2005).</p>
<p class="term"><b>Mestria</b> – “Melhoria da capacidade de um atleta usar eficazmente o seu potencial motor” {pt("g023", "(BirdBox Coaching, 2020)")}.</p>
<p class="term"><b>Tecido muscular ativo</b> – Tecido contraído que ajuda a manter posturas estáveis. Considerado “ativo” quando está em contração.</p>
<p class="term"><b>Hollow</b> – Postura de estabilidade, com contração do core e alinhamento dos dedos dos pés às mãos. Inclui retroversão pélvica.</p>
<p class="term"><b>Strict (Estrito)</b> – Movimento sem kip, baseado em controlo e força muscular.</p>
<p class="term"><b>Kip</b> – Alteração rápida de direção com velocidade, provocando mudança no padrão ou plano de movimento.</p>
<p class="term"><b>Forma</b> – Método para executar um movimento corretamente, visando a perfeição.</p>
<p class="term"><b>Aparelho estático</b> – Estável e fixo (ex: chão, barras).</p>
<p class="term"><b>Aparelho dinâmico</b> – Instável e em movimento (ex: argolas, corda).</p>
<p class="term"><b>Mobilidade</b> – Movimento à volta de uma articulação.</p>
<p class="term"><b>Flexibilidade ativa</b> – Alcance máximo de uma articulação sem ajuda externa, apenas com controlo muscular.</p>
<p class="term"><b>Flexibilidade passiva</b> – Alcance máximo de uma articulação com ajuda externa (parceiro, aparelho, peso corporal, etc.).</p>
<p class="term"><b>ROM</b> – Amplitude de movimento.</p>
<p class="term"><b>EROM</b> – Amplitude de movimento em extensão.</p>
<p class="term"><b>Spotting</b> – Assistência ao atleta durante uma progressão ou para prevenir lesões.</p>
<p class="term"><b>Tensão</b> – Estado de estiramento e firmeza máximos. O oposto seria estar “laxo” ou “relaxado”. (Fowler &amp; Crystal, 2010)</p>
</div>
<figure class="fill-bottom"><img src="img/photo-p05.jpg" alt=""></figure>
</section>

{ch(4)}<h2>Pirâmide do desenvolvimento teórico de um atleta segundo The Gymnastics Course</h2>
<div class="pyr-split">
<div><p>No curso de ginástica destacamos que o CrossFit é um programa de treino de força e de condicionamento físico. Por isso, ao trabalhar com um atleta ou cliente, devemos começar por fazer uma análise das suas necessidades. Compreender o que o atleta precisa – seja no desporto ou na sua vida diária – e desenhar um programa de treino baseado nas discrepâncias entre essas necessidades e os seus objetivos.</p>
<p>A ginástica é puro movimento do peso corporal. Ou seja, trata-se de como o corpo se move através do espaço. Na verdade, considera-se que, teoricamente, devemos dar prioridade à ginástica antes do condicionamento metabólico, uma vez que ela constitui a nossa base de movimento. Falamos de biomecânica. Se um indivíduo apresentar uma má biomecânica (movimento humano), a sua capacidade de alcançar um bom condicionamento metabólico será nula ou acabará por resultar em lesão.</p></div>
<figure class="pyramid-img">{pt("g008", PYR)}</figure>
</div>
<figure class="fill-bottom"><img src="img/photo-p06.jpg" alt=""></figure>
</section>

{ch(5)}<p class="rule">Regra #1: <span>Estático antes de Dinâmico</span></p>
<p class="rule">Regra #2: <span>Strict antes de Kipping</span></p>
<p>A força é essencial para alcançar uma forma adequada, e uma forma adequada é essencial para a consciência e o controlo corporal.</p>
<p>A ginástica dá um claro ênfase aos movimentos com peso corporal. Mais do que tudo, um movimento estrito demonstra domínio sobre esse movimento — é por isso que promovemos o treino estrito antes de adicionar inércia. A força adquirida através do trabalho estrito compensa, pois reduz substancialmente o risco de lesões.</p>
<p>Pequenos passos trarão grandes recompensas. Evita pressas — os movimentos aprendem-se e conquistam-se.</p>
<p>Para demonstrar domínio em todos os movimentos, é necessário ter consciência e controlo corporal virtuoso. Para adquirir isso, é fundamental executar cada ação com a forma correta. Para atingir a forma correta, é preciso ter força suficiente para realizar a amplitude total do movimento, do início ao fim. A falta de força compromete a posição, o que faz com que as forças se distribuam de forma incorreta. Além disso, sem força, o movimento simplesmente não acontece.</p>
<p>O nosso objetivo é desenvolver o movimento de um atleta. Para isso, explicamos um processo que permitirá ao treinador encontrar a forma mais eficaz de o fazer. Para desenvolver um movimento, o treinador tem três ferramentas principais:</p>
<ul class="bullets"><li>utilizar indicações (cues),</li><li>utilizar limitações,</li><li>ou aplicar intervenções.</li></ul>
<blockquote class="big">“A força é essencial para alcançar uma forma adequada, e a forma adequada é essencial para a consciência e o controlo corporal.”</blockquote>
<figure class="quote-photo"><img src="img/photo-p07.jpg" alt=""></figure>
<p class="rule">Regra #3:<br><span>Constrói uma base isométrica</span></p>
<p class="rule">Regra #4:<br><span>Utiliza a carga Excêntrica como ferramenta para o desenvolvimento da força e das posições.</span></p>
<p>As contrações isométricas são aquelas em que o músculo mantém o mesmo comprimento enquanto está sob carga ou tensão. Treinar isometria é essencial para a estabilização articular e o desenvolvimento do tecido conjuntivo.</p>
<p>As contrações excêntricas são aquelas em que o músculo se alonga enquanto está sob carga ou tensão. Os benefícios das cargas excêntricas são muitos, especialmente quando falamos em alterações na estrutura muscular para o desenvolvimento da força.</p>
<p>As contrações concêntricas são aquelas em que o músculo se encurta enquanto está sob carga ou tensão. {pt("g009", "No treino")}, realizam-se muitas contrações concêntricas. Devemos considerar como queremos desenvolver a força dos nossos atletas e quais os riscos associados a cada tipo de contração. Esses riscos são explicados em detalhe na nossa palestra sobre programação.</p>
<div class="notes-inline">{lines(7)}</div>
</section>

{ch(6)}<p>As <b><i>indicações (cues)</i></b> são dirigidas diretamente ao atleta com o objetivo de provocar uma alteração posicional, recorrendo à comunicação verbal.</p>
<p>As <b><i>restrições ou limitações</i></b> são tarefas ou exercícios que não interferem com o comprimento ou força do músculo, mas que ajudam o indivíduo a esforçar-se mais para manter melhores formas e posições durante um movimento.</p>
<p>As <b><i>intervenções</i></b> são usadas quando as indicações e limitações não foram eficazes. Procuram provocar uma alteração no comprimento e na força do tecido muscular de forma a melhorar o movimento.</p>
<p>Durante o seminário presencial, abordamos diversos aspetos sobre indicações, intervenções e limitações. Abaixo, poderão ver uma ilustração que ajuda a decidir, de forma eficaz, se devem utilizar uma indicação, uma limitação ou uma intervenção.</p>
<figure class="mda">{pt("g010", MDA)}</figure>
</section>

{ch(7)}<p>Como atleta e/ou treinador, é crucial compreender as posições envolvidas nos movimentos. A seguir, apresentamos uma série de imagens que mostram as posições-chave para o desenvolvimento. Ao compreender e praticar estas posições fundamentais, poderão desenvolver as vossas competências, melhorar o desempenho e reduzir o risco de lesão.</p>
<p>Encorajamos-vos a adicionar notas às imagens durante o seminário e a integrar estas posições na vossa rotina diária de treino.</p>
<h2 class="mv">Movimentos</h2>
{ex_html}
</section>

{ch(8)}<p>Durante a nossa conversa sobre programação, entraremos em mais detalhes. A seguir, partilhamos alguns elementos chave dessa discussão. Abrangemos muita informação importante e destacamos alguns aspetos chave.</p>
<h2>Progressão linear</h2>
<p>A progressão linear é um método no qual se aumenta gradualmente a dificuldade ou o volume de um exercício ao longo do tempo para estimular a progressão e a adaptação do corpo. Este método é usado comumente nos treinos de força para ajudar os atletas a desenvolver a força e a resistência necessárias para realizar movimentos avançados ou levantamentos.</p>
<p>Ao utilizar uma progressão linear no treino, os atletas podem aumentar gradualmente a sua força e resistência de forma segura e eficaz. É importante salientar que a progressão linear deve ser realizada em conjunto com uma boa forma e técnica para evitar lesões e garantir os melhores resultados possíveis.</p>
<p>Gostamos de usar este método de progressão linear nas nossas programações de ginástica.</p>
<p>Muitas pessoas usam percentagens para os seus levantamentos, mas não para os movimentos gímnicos. Na ginástica, a intensidade é a % da repetição máxima (1 RM) ou do TUT (tempo sob tensão). O volume total é o total de repetições ou tempo sob tensão.</p>
<p>A seguir, encontrarão um exemplo de uma progressão linear para o desenvolvimento da strict pull-up. Verão que se carrega sempre a primeira série da sessão para poder criar uma sobrecarga progressiva. Gostamos de começar esta progressão com 40%. Este primeiro exemplo baseia-se numa série máxima de 10 strict pull-ups.</p>
<div class="keep"><p class="tcap">Exemplo de progressão linear com % de 1 RM:</p>
<table class="prog"><thead><tr><th>Semana</th><th>Sessão 1</th><th>Sessão 2</th><th>Sessão 3</th></tr></thead><tbody>
<tr><td>1.</td><td>4-4-4</td><td>5-4-4</td><td>5-5-4</td></tr>
<tr><td>2.</td><td>5-5-5</td><td>6-5-5</td><td>6-6-5</td></tr>
<tr><td>3.</td><td>6-6-6</td><td>7-6-6</td><td>7-7-6</td></tr>
<tr><td>4.</td><td>7-7-7</td><td>8-7-7</td><td>8-8-7</td></tr>
<tr><td>5.</td><td>8-8-8</td><td>9-8-8</td><td>9-9-8</td></tr>
<tr><td>6.</td><td colspan="3">Retest / Repetição do teste</td></tr>
</tbody></table>
<p class="foot">*Começa este ciclo novamente com o teu novo número da série máxima.</p></div>
<p>Se não conseguires fazer uma strict pull-up, precisamos desenvolver força e vamos fazê-lo trabalhando o tempo sob tensão. Neste caso, começa com o exemplo da progressão abaixo. O primeiro número é para uma manutenção do queixo acima da barra (top hold) e o segundo número é para a fase excêntrica (controlo da descida). Salta até à posição para começar a tua série. Se não conseguires controlar e manter estas posições com o teu peso corporal completo, reduz a dificuldade usando um apoio com os dedos dos pés (Toe spotted).</p>
<div class="keep"><p class="tcap">Exemplo de progressão linear com TUT:</p>
<table class="prog"><thead><tr><th>Semana</th><th>Sessão 1</th><th>Sessão 2</th><th>Sessão 3</th></tr></thead><tbody>
<tr><td>1.</td><td>3/3 - 3/3 - 3/3</td><td>4/4 - 3/3 - 3/3</td><td>4/4 - 4/4 - 3/3</td></tr>
<tr><td>2.</td><td>4/4 - 4/4 - 4/4</td><td>5/5 - 4/4 - 4/4</td><td>5/5 - 5/5 - 4/4</td></tr>
<tr><td>3.</td><td>5/5 - 5/5 - 5/5</td><td>6/6 - 5/5 - 5/5</td><td>6/6 - 6/6 - 5/5</td></tr>
<tr><td>Retest / Repetição do teste</td><td colspan="3" class="note">Retesta a tua Strict pull-up. Se conseguires fazer uma, continua com a sessão 1 da semana 4. Se não conseguires, continua a aumentar os segundos no teu set. Se usaste apoio com os dedos nas primeiras três semanas, começa novamente a semana 1 usando o teu peso corporal completo.</td></tr>
<tr><td>4.</td><td>1-1-1</td><td>2-1-1</td><td>2-2-1</td></tr>
<tr><td>5.</td><td>2-2-2</td><td>3-2-2</td><td>3-3-2</td></tr>
<tr><td>6.</td><td>3-3-3</td><td>4-3-3</td><td>4-4-3</td></tr>
</tbody></table>
<p class="foot">*Se conseguiste completar toda a progressão, podes agora começar de novo com o exemplo de %.</p></div>
<p>Podes aplicar esta progressão a qualquer movimento gímnico. Esta é uma abordagem muito simples e fácil de aplicar na tua programação. Talvez seja mesmo a melhor abordagem para a maior parte da tua base de atletas.</p>
<h2>Volume, Intensidade e Frequência</h2>
<p>Se quiseres brincar com o volume, intensidade e frequência para programações individuais e quiseres entender isto mais a fundo, abaixo podes encontrar outro exemplo de progressão linear com mais variabilidade em volume, intensidade e frequência.</p>
<div class="keep"><p class="foot">*O exemplo abaixo baseia-se numa série máxima de 10 strict pull-ups virtuosas</p>
<table class="prog vif"><thead><tr><th>Semana</th><th>Intensidade</th><th>Frequência</th><th>Volume</th></tr></thead><tbody>
<tr><td>1.</td><td>3 séries a 40%<br>4-4-4</td><td>2 sessões/<br>semana</td><td>24 reps</td></tr>
<tr><td>2.</td><td>3 séries a 40%<br>4-4-4</td><td>2 sessões/<br>semana</td><td>24 reps</td></tr>
<tr><td>3.</td><td>3 séries a 50%<br>5-5-5</td><td>2 sessões/<br>semana</td><td>30 reps</td></tr>
<tr><td>4.</td><td>3 séries a 50%<br>5-5-5</td><td>2 sessões/<br>semana</td><td>30 reps</td></tr>
<tr><td>5.</td><td>4 séries a 40%<br>4-4-4-4</td><td>2 sessões/<br>semana</td><td>32 reps</td></tr>
<tr><td>6.</td><td>4 séries a 40%<br>4-4-4-4</td><td>2 sessões/<br>semana</td><td>32 reps</td></tr>
<tr><td>7.</td><td>3 séries a 40%<br>4-4-4</td><td>3 sessões/<br>semana</td><td>36 reps</td></tr>
<tr><td>8.</td><td>3 séries a 40%<br>4-4-4</td><td>3 sessões/<br>semana</td><td>36 reps</td></tr>
</tbody></table></div>
<p>Como podem ver, a intensidade, volume e frequência são os mesmos a cada duas semanas. Após as primeiras duas semanas, aumentámos a intensidade. Depois da terceira e quarta semana, reduzimos a intensidade nas semanas cinco e seis, mas aumentámos o volume. Nas semanas sete e oito, aumentámos a frequência. Ao ajustar o volume, a intensidade e a frequência, podem observar como esses números vão aumentando. Também podem aplicar isto a contrações isométricas ou a cargas excêntricas.</p>
<p>No exemplo, podem ver que o volume na ginástica é baixo. No levantamento de pesos, não se obtém sobrecarga com este volume. Na ginástica, ganhamos sobrecarga nas adaptações através do tempo sob tensão e do trabalho de ritmo (tempo), não pelo volume. Ocasionalmente, podemos usar um volume maior, mas o que realmente precisamos de usar é o tempo sob tensão e o ritmo.</p>
<p>Isto significa que, se fizermos a nossa série de 4-4-4 de strict pull-ups, vamos manter a posição de hollow durante 5 segundos, fazer a fase concêntrica durante 3 segundos, manter o queixo acima da barra durante 3 segundos, e fazer a fase excêntrica a descer durante 5 segundos para todas as 4 repetições.</p>
<p>Queremos treinar posições e perfeição, não volume e intensidade.</p>
<div class="notes-inline">{lines(10)}</div>
</section>
<section class="endblank"></section>
</body>
</html>
'''
open(OUT, "w").write(page)
print("wrote", OUT)
