#!/bin/zsh
# pdf.sh <html file in tgc-l1> <out pdf> [hash]
cd /Users/nathanbird/Developer/birdbox-website/manual-src/tgc-l1
P=$(mktemp -d)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-pdf-header-footer --allow-file-access-from-files --virtual-time-budget=8000 --user-data-dir="$P" --print-to-pdf="$2" "file://$PWD/$1#${3:-web}" >/dev/null 2>&1
rm -rf "$P"
