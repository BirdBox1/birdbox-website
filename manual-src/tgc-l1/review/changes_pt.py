# Portuguese edition: every place the built manual differs from Amadeu's draft, plus translation
# questions for Amadeu. "applied" = already in manual-pt.html (following Nathan's English decision),
# "query" = not applied, needs Amadeu/Nathan. seek = text on the Portuguese page, show = text on the English page.
C = []
def add(id, type, now, proposed, note, seek, show, status="applied"):
    C.append(dict(id=id, type=type, now=now, proposed=proposed, note=note, seek=seek, show=show, status=status))

add("p01", "crossfit", "Capa: Curso de CrossFit Gymnastics", "Capa: The Gymnastics Course",
    "Same as your English decision (TGC is stand-alone)", "THE GYMNASTICS COURSE", "THE GYMNASTICS COURSE")
add("p02", "layout", "(new) Title page in Portuguese: “Manual do participante”, “Edição de 2026”, copyright lines",
    "Keep", "My translation of the English title page. Amadeu to check", "Manual do participante", "Participant Manual")
add("p03", "layout", "(new) Contents page titled “Índice”, chapters as “Capítulo 1–8”", "Keep",
    "Chapter names are Amadeu's headings", "Índice", "Contents")
add("p04", "images", "Team photo caption", "Team Summit 2026: Maiorca, Espanha",
    "My translation of your caption", "Team Summit 2026", "2026 Team Summit")
add("p05", "consistency", "Este PDF … este PDF … Este PDF contém", "Este manual … este manual … Este manual contém",
    "Same as your English decision (PDF → manual)", "Este manual é um documento", "This manual is a supporting")
add("p06", "crossfit", "pontos-chave do seminário de CrossFit Gymnastics", "pontos-chave do seminário The Gymnastics Course",
    "Same as your English decision", "seminário The Gymnastics Course", "The Gymnastics Course seminar")
add("p07", "crossfit", "Um critério seria ter competido nos CrossFit Games ou ficado no top 5 de uma semifinal.",
    "Um critério seria competir ao mais alto nível do seu desporto, ou terminar no top 5 de uma prova nacional ou internacional.",
    "Same meaning as your English decision. My Portuguese, Amadeu to check", "Um critério seria competir", "competing at the highest level")
add("p08", "consistency", "(Birdbox Coaching Development, 2020)", "(BirdBox Coaching, 2020)",
    "Same as your English wording", "BirdBox Coaching, 2020", "evelopment, 2020")
add("p09", "spelling", "A NOSSA METODOLOGÍA", "A NOSSA METODOLOGIA",
    "Accent is Spanish; Portuguese has no accent", "METODOLOGIA", "METHODOLOGY OUTLINE")
add("p10", "images", "Pyramid in English (CrossFit graphic)", "TGC-red pyramid with Portuguese labels: DESPORTO, HALTEROFILIA E LANÇAMENTOS, CONDICIONAMENTO METABÓLICO, GINÁSTICA, NUTRIÇÃO",
    "Same redraw as English. Labels are my translation, Amadeu to check", "GINÁSTICA", "GYMNASTICS")
add("p11", "crossfit", "No CrossFit®, realizam-se muitas contrações concêntricas.", "No treino, realizam-se muitas contrações concêntricas.",
    "Same as your English decision", "No treino, realizam-se", "We perform concentric contractions in training")
add("p12", "layout", "Heading “REGRAS DE TREINO – CONTINUAÇÃO”", "Removed: rules 3 and 4 follow straight on",
    "Same as your English decision", "Regra #3", "Rule number 3")
add("p13", "grammar", "Regra #3: Constrói um base Isométrica", "Regra #3: Constrói uma base isométrica",
    "“base” is feminine (uma). NOT applied yet", "Constrói um base", "Build an isometric base", "query")
add("p14", "images", "Movement development diagram in English", "Same clear flow chart as English, words in Portuguese",
    "Box words are my translation, using Amadeu's terms (indicação, limitação, intervenção). Amadeu to check",
    "ABORDAGEM AO DESENVOLVIMENTO", "MOVEMENT DEVELOPMENT APPROACH")
add("p15", "layout", "Mission: Amadeu's text runs points 1–2 and 4–5 together", "Five numbered points, as in English",
    "Wording unchanged, only split", "Ajudaremos a criar", "We will help you cultivate")
add("p16", "accuracy", "Hollow completo / Arch assistido / Arch completo: “Procurar compressão e tensão”",
    "“Procurar comprimento e tensão”", "English says “Look for length and tension” on these three. NOT applied yet",
    "Procurar compressão e tensão", "Look for length and tension", "query")
add("p17", "accuracy", "Joelhos aos Cotovelos (Strict knees to chest)", "Joelhos aos Cotovelos (Strict knees-to-elbow)",
    "English is knees-to-elbow. NOT applied yet", "Strict knees to chest", "Strict knees-to-elbow", "query")
add("p18", "accuracy", "V-up: “As pernas mantêm-se totalmente esticadas…”", "“Os braços e as pernas mantêm-se totalmente esticados…”",
    "English says arms AND legs stay straight. NOT applied yet", "V-up", "V-up", "query")
