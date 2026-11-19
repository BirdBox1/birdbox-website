# German edition: every place the built manual differs from the 2023 German guide (all applied in the preview).
C = []
def add(id, type, now, proposed, note, seek, show):
    C.append(dict(id=id, type=type, now=now, proposed=proposed, note=note, seek=seek, show=show))

add("d01", "crossfit", "Titelseite: CrossFit Gymnastics Course", "Titelseite: The Gymnastics Course", "Same as your English decision", "THE GYMNASTICS COURSE", "THE GYMNASTICS COURSE")
add("d02", "layout", "(new) Title page in German: “Teilnehmerhandbuch”, “Ausgabe 2026”, copyright lines", "Keep", "My translation of the English title page. Michaela to check", "Teilnehmerhandbuch", "Participant Manual")
add("d03", "layout", "(new) Contents page titled “Inhalt”, chapters as “Kapitel 1–8”", "Keep", "Chapter names are the 2023 German headings", "Inhalt", "Contents")
add("d04", "images", "Team photo caption", "Team Summit 2026: Mallorca, Spanien", "My translation of your caption", "Team Summit 2026", "2026 Team Summit")
add("d05", "consistency", "Dieses PDF … Die folgende PDF-Datei", "Dieses Handbuch … Das folgende Handbuch", "Same as your English decision (PDF → manual); the German already calls it “Handbuch” elsewhere", "Dieses Handbuch ist ein", "This manual is a supporting")
add("d06", "crossfit", "…die Teilnahme an den CrossFit Games oder eine Top-5-Platzierung bei einem CrossFit Sanctional Event oder den Semi-Finals.", "…ein Wettkampf auf höchstem Niveau seiner Sportart oder eine Top-5-Platzierung bei einem nationalen oder internationalen Wettkampf.", "Same meaning as your English decision. My German, Michaela to check", "höchstem Niveau", "competing at the highest level")
add("d07", "consistency", "(Birdbox Coaching Cevelopment, 2020)", "(BirdBox Coaching, 2020)", "Same as your English wording (the old one also had a typo, “Cevelopment”)", "BirdBox Coaching, 2020", "BirdBox Coaching, 2020")
add("d08", "images", "Pyramid in English (CrossFit graphic)", "TGC-red pyramid with German labels: SPORT, GEWICHTHEBEN & WERFEN, METABOLISCHE KONDITIONIERUNG, TURNEN, ERNÄHRUNG", "Same redraw as English. Labels are my translation, Michaela to check", "TURNEN", "GYMNASTICS")
add("d09", "crossfit", "Im CrossFit® führen wir ständig konzentrische Kontraktionen aus.", "Im Training führen wir ständig konzentrische Kontraktionen aus.", "Same as your English decision", "Im Training führen wir", "We perform concentric contractions in training")
add("d10", "images", "Movement development diagram in English", "Same clear flow chart as English, words in German", "Box words are my translation, keeping the guide's own terms (Cue, Constraint, Intervention). Michaela to check", "ANSATZ ZUR BEWEGUNGSENTWICKLUNG", "MOVEMENT DEVELOPMENT APPROACH")
add("d11", "spelling", "Heading “Volume, Intensität and Häufigkeit”", "“Volumen, Intensität und Häufigkeit”", "Two English words (Volume, and) left in the heading", "Volumen, Intensität und", "Volume, Intensity and Frequency")
add("d12", "layout", "Heading “WEITERE TRAININGSREGELN”", "Removed: rules 3 and 4 follow straight on", "Same as your English decision", "Regel Nr. 3", "Rule number 3")
add("d13", "spelling", "Typos: “Werkzeuge dir wir” · “Isometrische Kontraktion bedeuten” · “Kraftübertagung” · “spiegelt … wieder” · “mit beispielsweise mit”", "“Werkzeuge die wir” · “Isometrische Kontraktionen bedeuten” · “Kraftübertragung” · “spiegelt … wider” · “beispielsweise mit”", "Five small typing slips", "Werkzeuge die wir", "tools")
