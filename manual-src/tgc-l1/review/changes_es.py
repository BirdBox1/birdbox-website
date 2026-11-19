# Spanish edition: every place the built manual differs from the 2023 Spanish guide.
# All are already applied in manual-es.html (preview); Nathan approves or rejects each on the review page.
C = []
def add(id, type, now, proposed, note, seek, show):
    C.append(dict(id=id, type=type, now=now, proposed=proposed, note=note, seek=seek, show=show))

add("s01", "crossfit", "Portada: Curso de CrossFit Gymnastics", "Portada: The Gymnastics Course", "Same as your English decision", "THE GYMNASTICS COURSE", "THE GYMNASTICS COURSE")
add("s02", "layout", "(new) Title page in Spanish: “Manual del participante”, “Edición 2026”, copyright lines", "Keep", "My translation of the English title page. Mel to check", "Manual del participante", "Participant Manual")
add("s03", "layout", "(new) Contents page titled “Índice”, chapters as “Capítulo 1–8”", "Keep", "Chapter names are the 2023 Spanish headings", "Índice", "Contents")
add("s04", "images", "Team photo caption", "Team Summit 2026: Mallorca, España", "My translation of your caption", "Team Summit 2026", "2026 Team Summit")
add("s05", "consistency", "Este PDF … este PDF … Este PDF contiene", "Este manual … este manual … Este manual contiene", "Same as your English decision (PDF → manual)", "Este manual es un documento", "This manual is a supporting")
add("s06", "crossfit", "puntos clave del seminario de CrossFit Gymnastics", "puntos clave del seminario The Gymnastics Course", "Same as your English decision", "seminario The Gymnastics Course", "The Gymnastics Course seminar")
add("s07", "crossfit", "…haber competido en los CrossFit Games o haber quedado en el top 5 de algún evento de semifinales.", "…competir al más alto nivel de su deporte, o quedar en el top 5 de una competición nacional o internacional.", "Same meaning as your English decision. My Spanish, Mel to check", "competir al más alto nivel", "competing at the highest level")
add("s08", "consistency", "(BirdBox Coaching Development, 2020)", "(BirdBox Coaching, 2020)", "Same as your English wording", "BirdBox Coaching, 2020", "BirdBox Coaching, 2020")
add("s09", "accuracy", "Tejido muscular estirado (stretched muscle tissue)", "Tejido activo (active tissue)", "English term is “Active Tissue”; “estirado” means stretched, which is the opposite idea", "Tejido activo", "Active Tissue")
add("s10", "images", "Pyramid in English (CrossFit graphic)", "TGC-red pyramid with Spanish labels: DEPORTE, HALTEROFILIA Y LANZAMIENTOS, ACONDICIONAMIENTO METABÓLICO, GIMNASIA, NUTRICIÓN", "Same redraw as English. Labels are my translation, Mel to check", "GIMNASIA", "GYMNASTICS")
add("s11", "crossfit", "En CrossFit®, se realizan muchas contracciones concéntricas.", "En el entrenamiento, se realizan muchas contracciones concéntricas.", "Same as your English decision", "En el entrenamiento, se", "We perform concentric contractions in training")
add("s12", "images", "Movement development diagram in English", "Same clear flow chart as English, words in Spanish", "Box words are my translation, using the guide's own terms (indicación, limitación, intervención). Mel to check", "ENFOQUE DEL DESARROLLO", "MOVEMENT DEVELOPMENT APPROACH")
add("s13", "layout", "Headings “REGLAS DE ENTRENAMIENTO CONTINUACIÓN…” and “CONTINUACIÓN DE LAS REGLAS DEL ENTRENAMIENTO...”", "Removed: rules 3 and 4 follow straight on", "Same as your English decision (the old page had it twice)", "Regla #3", "Rule number 3")
add("s14", "layout", "Mission point 5 was broken across lines in the old PDF", "Point 5 in one piece, five points as in English", "Wording unchanged", "Ayudaremos a crear", "We will help you cultivate")
add("s15", "accuracy", "Hollow completo / Arco asistido / Arco completo: “Busca la compresión y tensión”", "“Busca la longitud y tensión”", "Same fix you approved for Portuguese (English says length and tension)", "Busca la longitud y tensión", "Look for length and tension")
add("s16", "accuracy", "V-up: “Las piernas se mantienen totalmente rectas…”", "“Los brazos y las piernas se mantienen totalmente rectos…”", "Same fix you approved for Portuguese", "Los brazos y las piernas", "Arms and legs remain")
add("s17", "clarity", "“Pass-out” en anillas bajas (twice, same name)", "“Pass-out” en anillas bajas – brazos hacia los lados / – brazos hacia delante", "Same as your English decision", "brazos hacia los lados", "arm out wide")
add("s18", "accuracy", "(missing) The 2023 Spanish guide leaves out 6 movements: Tuck no virtuoso, Tuck virtuoso, L-sit con una pierna extendida, L-sit, V-sit, Manna", "Added, with their photos and points, translated in the guide's own words", "My Spanish (Codos supinos, Hombros en posición neutra…). Mel to check", "Tuck no virtuoso", "Non-virtuous tuck")
