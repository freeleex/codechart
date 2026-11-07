#!/usr/bin/env bash
# Records docs/images/page-review.gif. Needs vhs and ffmpeg (brew install vhs), and a built dist/.
set -euo pipefail
demo="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$demo/../.." && pwd)"
work="$(mktemp -d /tmp/codechart-page-review.XXXXXX)"
mkdir -p "$work/pw" "$work/bin"

cat > "$work/bin/codechart" <<EOT
#!/usr/bin/env bash
HOME="$work" exec node "$root/dist/cli.js" "\$@"
EOT
chmod +x "$work/bin/codechart"

"$demo/make-repo.sh" "$work/shop"
(cd "$work/shop" && "$work/bin/codechart" render "$root/tests/fixtures/shop.spec.json" --git --output web --theme dark >/dev/null)

(cd "$work/pw" && npm init -y >/dev/null && npm i --silent playwright@1.64.1 >/dev/null && npx playwright install chromium)
cp "$demo/page-review.mjs" "$work/pw/"
html="$(ls "$work"/.cache/codechart/shop-*/*.html | tail -1)"
node "$work/pw/page-review.mjs" "$html" "$work/vid" "$work/message.txt"
page="$(ls "$work"/vid/*.webm)"

cp "$work/message.txt" "$work/shop/review.txt"
(cd "$work/shop" && DEMO_BIN="$work/bin" vhs "$demo/page-review.tape" &>/dev/null)

# Page video starts blank while it loads and is sped up 1.3x; the terminal one ends on a hold.
dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$page")"
off="$(awk -v d="$dur" 'BEGIN { printf "%.2f", (d - 0.6) / 1.3 - 0.4 }')"
ffmpeg -loglevel error -y -i "$page" -i "$work/shop/page-review-term.mp4" -filter_complex "
  [0:v]trim=start=0.6,setpts=(PTS-STARTPTS)/1.3,fps=12,scale=960:-2:flags=lanczos,setpts=PTS-STARTPTS[p];
  [1:v]fps=12,scale=960:-2:flags=lanczos,setpts=PTS-STARTPTS[t];
  [p][t]xfade=transition=fade:duration=0.4:offset=$off,split[a][b];
  [a]palettegen=max_colors=80:stats_mode=diff[pal];
  [b][pal]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  "$root/docs/images/page-review.gif"
ls -la "$root/docs/images/page-review.gif"
echo "work dir (trash it when done): $work"
