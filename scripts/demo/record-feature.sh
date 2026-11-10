#!/usr/bin/env bash
# Records one feature GIF in docs/images: flow, plan-vs-built, page-review (short cut), release-map or console-review-short.
# Needs ffmpeg, vhs and vim (brew install vhs), and a built dist/.
set -euo pipefail
mode="${1:?usage: record-feature.sh flow|plan-vs-built|page-review|release-map|console-review-short}"
demo="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$demo/../.." && pwd)"
work="$(mktemp -d /tmp/codechart-feature.XXXXXX)"
mkdir -p "$work/pw" "$work/bin"

cat > "$work/bin/codechart" <<EOT
#!/usr/bin/env bash
HOME="$work" exec node "$root/dist/cli.js" "\$@"
EOT
chmod +x "$work/bin/codechart"
cc="$work/bin/codechart"

"$demo/make-repo.sh" "$work/shop"
cd "$work/shop"

# gif <video> <out> <speed>: 720 px wide, 12 fps, the page's blank load frames cut, the last frame held for 1 s.
gif() {
  ffmpeg -loglevel error -y -i "$1" -filter_complex "
    [0:v]trim=start=0.7,setpts=(PTS-STARTPTS)/$3,fps=12,scale=720:-2:flags=lanczos,tpad=stop_mode=clone:stop_duration=1,split[a][b];
    [a]palettegen=max_colors=32:stats_mode=diff[pal];
    [b][pal]paletteuse=dither=none:diff_mode=rectangle" "$2"
  ls -la "$2"
}
page() { # <script> <html> [args]: records the page with Playwright
  (cd "$work/pw" && npm init -y >/dev/null && npm i --silent playwright@1.64.1 >/dev/null && npx playwright install chromium)
  cp "$demo"/{feature-lib,flow,plan-vs-built,page-review,release-map}.mjs "$work/pw/"
  node "$work/pw/$1" "${@:2}"
}
latest() { ls -t "$work"/.cache/codechart/shop-*/*"$1" | head -1; }

case "$mode" in
  flow)
    "$cc" render "$demo/specs/refund.flow.json" --git --output web >/dev/null
    page flow.mjs "$(latest refund-an-order.flow.html)" "$work/vid"
    gif "$(ls "$work"/vid/*.webm)" "$root/docs/images/flow.gif" 1.0 ;;
  plan-vs-built)
    "$cc" render "$demo/specs/refund-plan.spec.json" --output web >/dev/null
    "$cc" render "$demo/specs/refund-built.spec.json" --git --output web >/dev/null
    page plan-vs-built.mjs "$(latest refunds-and-invoices.html)" "$work/vid"
    gif "$(ls "$work"/vid/*.webm)" "$root/docs/images/plan-vs-built.gif" 1.5 ;;
  page-review)
    "$cc" render "$root/tests/fixtures/shop.spec.json" --git --output web --theme dark >/dev/null
    page page-review.mjs "$(latest invoices-for-paid-orders.html)" "$work/vid" "$work/message.txt" short
    gif "$(ls "$work"/vid/*.webm)" "$root/docs/images/page-review.gif" 1.4 ;;
  release-map)
    cp "$root/docs/images/logo.svg" logo.svg
    printf 'release:\n  product: Acme Shop\n  logo: logo.svg\n' > .codechart.yaml
    "$cc" render "$demo/specs/release.spec.json" --output web >/dev/null
    page release-map.mjs "$(latest .business.html)" "$work/vid"
    gif "$(ls "$work"/vid/*.webm)" "$root/docs/images/release-map.gif" 1.2 ;;
  console-review-short)
    git checkout -qb feat/invoices
    DEMO_BIN="$work/bin" DEMO_SPEC="$root/tests/fixtures/shop.spec.json" vhs "$demo/console-review-short.tape" &>/dev/null
    ffmpeg -loglevel error -y -i console-review-short.mp4 -filter_complex "
      setpts=PTS/1.3,fps=12,scale=720:-2:flags=lanczos,tpad=stop_mode=clone:stop_duration=1,split[a][b];
      [a]palettegen=max_colors=32:stats_mode=diff[pal];
      [b][pal]paletteuse=dither=none:diff_mode=rectangle" "$root/docs/images/console-review-short.gif"
    ls -la "$root/docs/images/console-review-short.gif" ;;
  *) echo "unknown mode $mode" >&2; exit 1 ;;
esac
echo "work dir (trash it when done): $work"
