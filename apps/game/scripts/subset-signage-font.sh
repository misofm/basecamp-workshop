#!/usr/bin/env bash
# Rebuild public/fonts/nozomi-jp-signs.woff2: Noto Sans JP (SIL OFL 1.1) instanced at
# Bold (wght 700) and subset to every non-ASCII character in src/world/signage.ts plus all
# hiragana, katakana and Japanese punctuation. Needs Python with fonttools + brotli:
#   python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools brotli
#   FT=/tmp/ft/bin ./scripts/subset-signage-font.sh path/to/NotoSansJP[wght].ttf
# Source font: https://github.com/google/fonts/tree/main/ofl/notosansjp
set -euo pipefail
SRC="${1:?usage: subset-signage-font.sh NotoSansJP[wght].ttf}"
FT="${FT:-}"
PY="${FT:+$FT/}python3"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
"$PY" - "$HERE/src/world/signage.ts" > "$TMP/chars.txt" <<'PYEOF'
import sys
text = open(sys.argv[1], encoding="utf-8").read()
chars = {c for c in text if ord(c) > 0x7F}
chars |= {chr(c) for c in range(0x3000, 0x3040)}   # CJK punctuation
chars |= {chr(c) for c in range(0x3040, 0x30A0)}   # hiragana
chars |= {chr(c) for c in range(0x30A0, 0x3100)}   # katakana
chars |= {chr(c) for c in range(0xFF01, 0xFF5F)}   # full-width forms
sys.stdout.write("".join(sorted(chars)))
PYEOF
"$PY" -m fontTools.varLib.instancer "$SRC" wght=700 -o "$TMP/bold.ttf" -q
"$PY" -m fontTools.subset "$TMP/bold.ttf" --text-file="$TMP/chars.txt" \
  --unicodes="U+0020-007E" --flavor=woff2 --layout-features='*' \
  --output-file="$HERE/public/fonts/nozomi-jp-signs.woff2"
rm -rf "$TMP"
ls -l "$HERE/public/fonts/nozomi-jp-signs.woff2"
