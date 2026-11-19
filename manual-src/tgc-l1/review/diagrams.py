# Redrawn TGC diagrams (proposals g008 and g010). Same words as the originals.
RED, DARK, INK, MUTED, TINT = "#9e2029", "#7e1820", "#16191d", "#5d6670", "#f8eeee"

def pyramid():
    # five tiers, bottom (nutrition) to top (sport); gymnastics highlighted
    tiers = [("NUTRITION", "#d9a3a7", INK), ("GYMNASTICS", RED, "#fff"), ("METABOLIC CONDITIONING", "#c56b72", "#fff"),
             ("WEIGHTLIFTING &amp; THROWING", "#d9a3a7", INK), ("SPORT", "#ecd2d4", INK)]
    W, H, n = 300, 300, 5
    th = H / n; out = []
    for i, (label, fill, fg) in enumerate(tiers):
        yb = H - i * th; yt = yb - th + 4
        def half(y): return (W / 2) * (y / H)
        xb, xt = half(yb), half(yt)
        pts = f"{W/2-xb:.1f},{yb:.1f} {W/2+xb:.1f},{yb:.1f} {W/2+xt:.1f},{yt:.1f} {W/2-xt:.1f},{yt:.1f}"
        out.append(f'<polygon points="{pts}" fill="{fill}"/>')
        size = 22 if label == "GYMNASTICS" else (11 if i in (2, 3) else 13)
        ty = (yb + yt) / 2 + size * 0.35 + (6 if i == 4 else 0)
        if i == 3:
            out.append(f'<text x="{W/2}" y="{ty-6:.1f}" text-anchor="middle" class="d" font-size="{size}" font-weight="700" fill="{fg}" letter-spacing=".5">WEIGHTLIFTING</text>')
            out.append(f'<text x="{W/2}" y="{ty+7:.1f}" text-anchor="middle" class="d" font-size="{size}" font-weight="700" fill="{fg}" letter-spacing=".5">&amp; THROWING</text>')
        else:
            out.append(f'<text x="{W/2}" y="{ty:.1f}" text-anchor="middle" class="d" font-size="{size}" font-weight="700" fill="{fg}" letter-spacing=".6">{label}</text>')
    return f'<svg viewBox="0 -4 {W} {H+8}" width="100%" role="img" aria-label="Hierarchy of development: nutrition, gymnastics, metabolic conditioning, weightlifting and throwing, sport">{"".join(out)}</svg>'

def mda():
    # Clear version: the three attempts run down the left (cue, constraint, intervention);
    # every positive result runs straight across into one Reinforce box on the right.
    FS, LH = 15, 18
    def box(x, y, w, h, lines, kind="plain"):
        fill = {"plain": "#fff", "red": TINT, "start": RED, "end": "#fff", "pos": "#fff"}[kind]
        stroke = {"plain": "#9aa4ae", "red": RED, "start": RED, "end": INK, "pos": INK}[kind]
        fg = "#fff" if kind == "start" else INK
        weight = "700" if kind in ("red", "start", "end") else "600"
        s = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="{fill}" stroke="{stroke}" stroke-width="{3 if kind == "end" else 2 if kind in ("red","pos") else 1.4}"/>'
        lh = LH + 5 if kind == "end" else LH
        y0 = y + h / 2 - (len(lines) - 1) * lh / 2 + FS * 0.35
        for i, t in enumerate(lines):
            s += f'<text x="{x + w/2}" y="{y0 + i*lh:.1f}" text-anchor="middle" font-size="{FS + 3 if kind == "end" else FS}" font-weight="{weight}" fill="{fg}">{t}</text>'
        return s
    def arrow(d, col=MUTED):
        return f'<path d="{d}" fill="none" stroke="{col}" stroke-width="2" marker-end="url(#ah)"/>'
    g = ['<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5d6670"/></marker></defs>']
    g.append(f'<text x="300" y="20" text-anchor="middle" class="d" font-size="24" font-weight="700" fill="{INK}" letter-spacing="1">MOVEMENT DEVELOPMENT APPROACH</text>')
    A, B, C, W = 0, 205, 420, 180          # column x positions, box width
    g.append(box(150, 36, 300, 40, ["The athlete presents movement"], "start"))
    g.append(arrow("M300,76 V88 H90 V100")); g.append(arrow("M300,76 V88 H510 V100"))
    g.append(box(A, 102, W, 40, ["Poor Movement"]))
    g.append(box(C, 102, W, 40, ["Good Movement"]))
    g.append(arrow("M90,142 V158"))
    g.append(box(A, 160, W, 52, ["Attempt to fix by", "using a cue."], "red"))
    g.append(arrow("M90,212 V228")); g.append(arrow("M180,186 H255 V228"))
    g.append(box(A, 230, W, 52, ["Negative correction", "with the cue."]))
    g.append(box(B, 230, 190, 52, ["Positive correction", "with the cue."], "pos"))
    g.append(arrow("M90,282 V298"))
    g.append(box(A, 300, W, 70, ["Attempt to correct", "athlete with a", "constraint."], "red"))
    g.append(arrow("M90,370 V386")); g.append(arrow("M180,335 H255 V386"))
    g.append(box(A, 388, W, 52, ["Negative correction", "with a constraint."]))
    g.append(box(B, 388, 190, 52, ["Positive correction", "with a constraint."], "pos"))
    g.append(arrow("M90,440 V456"))
    g.append(box(A, 458, 395, 56, ["Devise and develop interventions to do with the", "athlete to help improve their movement pattern"], "red"))
    # Reinforce: one tall box on the right, fed by good movement and both positive corrections
    g.append(box(C + 20, 230, W - 20, 210, ["Reinforce, cue", "and reward"], "end"))
    g.append(arrow("M510,142 V228")); g.append(arrow("M395,256 H438")); g.append(arrow("M395,414 H438"))
    return f'<svg viewBox="0 0 600 516" width="100%" role="img" aria-label="Movement development approach flow chart">{"".join(g)}</svg>'
