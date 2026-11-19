#!/bin/zsh
# Build a course manual's two PDFs with Chrome:
#   out/<name>-manual-web.pdf    A4, light cover        -> the download on the website
#   out/<name>-manual-print.pdf  A4 + Lulu bleed (216.41 x 303.28) -> Lulu softback interior (no cover; even page count)
# Usage: manual-src/build.sh tcc-l1
set -e
cd "$(dirname "$0")/$1"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$(mktemp -d)"
mkdir -p out
pdf() { "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --allow-file-access-from-files \
    --virtual-time-budget=8000 --user-data-dir="$PROFILE" --print-to-pdf="$2" "file://$PWD/manual.html#$1" >/dev/null 2>&1; }
pages() { /usr/bin/python3 -c "import re,sys;d=open(sys.argv[1],'rb').read();print(len(re.findall(rb'/Type\s*/Page[^s]',d)))" "$1"; }
pdf web "out/$1-manual-web.pdf"
pdf print "out/$1-manual-print.pdf"
n=$(pages "out/$1-manual-print.pdf")
if (( n % 2 )); then pdf print-odd "out/$1-manual-print.pdf"; n=$(pages "out/$1-manual-print.pdf"); fi
echo "built out/$1-manual-web.pdf ($(pages out/$1-manual-web.pdf) pages)"
echo "built out/$1-manual-print.pdf ($n pages)"
rm -rf "$PROFILE"
