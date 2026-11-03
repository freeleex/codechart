#!/usr/bin/env bash
# Records docs/images/demo.gif. Needs vhs and ffmpeg (brew install vhs), and a built dist/.
set -euo pipefail
demo="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$demo/../.." && pwd)"
work="$(mktemp -d /tmp/codechart-demo.XXXXXX)"
mkdir -p "$work/pw"

"$demo/make-repo.sh" "$work/shop"
(cd "$work/shop" && DEMO_BIN="$demo" DEMO_HOME="$work" vhs "$demo/demo.tape" &>/dev/null)

(cd "$work/pw" && npm init -y >/dev/null && npm i --silent playwright@1.64.1 >/dev/null && npx playwright install chromium)
cp "$demo/page.mjs" "$work/pw/"
html="$(ls "$work"/.cache/codechart/shop-*/*.html | tail -1)"
node "$work/pw/page.mjs" "$html" "$work/vid"
page="$(ls "$work"/vid/*.webm)"

# Page video starts blank while it loads; the terminal one ends on a 3 s hold.
ffmpeg -loglevel error -y -i "$work/shop/demo-term.mp4" -i "$page" -filter_complex "
  [0:v]fps=12,scale=960:-2:flags=lanczos,setpts=PTS-STARTPTS[t];
  [1:v]trim=start=0.6,fps=12,scale=960:-2:flags=lanczos,setpts=PTS-STARTPTS[p];
  [t][p]xfade=transition=fade:duration=0.4:offset=8.6,split[a][b];
  [a]palettegen=max_colors=128:stats_mode=diff[pal];
  [b][pal]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  "$root/docs/images/demo.gif"
ls -la "$root/docs/images/demo.gif"

cp "$demo/card.mjs" "$work/pw/"
node "$work/pw/card.mjs" "$demo/card.html" "$root/docs/images/logo.svg" "$work/vid/shot.png" "$work/social-card.png"
cp "$work/social-card.png" "$root/docs/images/social-card.png"
