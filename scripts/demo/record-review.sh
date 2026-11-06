#!/usr/bin/env bash
# Records docs/images/console-review.gif. Needs vhs and vim (brew install vhs), and a built dist/.
set -euo pipefail
demo="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$demo/../.." && pwd)"
work="$(mktemp -d /tmp/codechart-review-demo.XXXXXX)"
mkdir -p "$work/bin"

cat > "$work/bin/codechart" <<EOF
#!/usr/bin/env bash
HOME="$work" exec node "$root/dist/cli.js" "\$@"
EOF
chmod +x "$work/bin/codechart"

"$demo/make-repo.sh" "$work/shop"
(cd "$work/shop" && git checkout -qb feat/invoices && DEMO_BIN="$work/bin" DEMO_DIR="$demo" DEMO_HOME="$work" vhs "$demo/review.tape" &>/dev/null)
cp "$work/shop/review-term.gif" "$root/docs/images/console-review.gif"
ls -la "$root/docs/images/console-review.gif"
