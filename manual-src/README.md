# Course manuals

Each manual is one HTML file that prints to two PDFs:

- **web**: A4 with a light cover (saves ink at home). This is the PDF on the website manuals page.
- **print**: A4 plus 3.175 mm bleed and no cover, the interior for the Lulu hardback. The wrap-around hardback cover is a separate file.

Build: `manual-src/build.sh tcc-l1` writes both into `manual-src/tcc-l1/out/`.

- `manual.css` is the shared design. `print-bleed.css` only changes the page size for the hardback.
- Fonts are Barlow Condensed and Source Sans 3 (SIL Open Font License, fine to sell).
- `tcc-l1/manual.html` is the source of truth for The Coaches Course Level 1. The wording matches the Word file of October 2024. Nathan approves every change before it goes in.
- This folder is hidden from the live site in `_redirects`.
