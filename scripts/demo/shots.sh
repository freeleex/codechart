#!/usr/bin/env bash
# Regenerates the README feature screenshots in docs/images (map, flow,
# plan-map, plan-flow, infra). Needs a built dist/ and network for npm.
set -euo pipefail
demo="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$demo/../.." && pwd)"
cli="$root/dist/cli.js"
work=/tmp/demo-shots
rm -rf "$work" && mkdir -p "$work/pw"

"$demo/make-repo.sh" "$work/shop"

mkdir -p "$work/invites/app/api"
(cd "$work/invites" && git init -q && git config user.name demo && git config user.email demo@example.com)
printf '# invites\n' > "$work/invites/README.md"
(cd "$work/invites" && git add README.md && git commit -qm init)
cat > "$work/invites/app/api/invites.py" <<'EOF'
from app.lib.http import NotFound, Gone
from app.models import Membership, find_invite, is_member, now


def accept_invite(user, token):
    invite = find_invite(token)
    if invite is None:
        raise NotFound("invite")
    if invite.expires_at < now():
        raise Gone("invite expired")
    if is_member(user, invite.team):
        return {"status": "member"}
    m = Membership(user=user, team=invite.team)
    m.save()
    return {"status": "joined"}
EOF

mkdir -p "$work/infra/infra"
(cd "$work/infra" && git init -q && git config user.name demo && git config user.email demo@example.com)
cat > "$work/infra/infra/main.tf" <<'EOF'
module "vpc" {
  source = "./modules/vpc"
  name   = "shop"
}
EOF
cat > "$work/infra/infra/variables.tf" <<'EOF'
variable "log_retention_days" {
  type    = number
  default = 90
}
EOF
cat > "$work/infra/infra/alb.tf" <<'EOF'
resource "aws_lb" "api" {
  name            = "api"
  internal        = false
  security_groups = [aws_security_group.alb.id]
  subnets         = module.vpc.public_subnets
}
EOF
(cd "$work/infra" && git add -A && git commit -qm "Load balancer and network")
cat > "$work/infra/infra/alb.tf" <<'EOF'
resource "aws_lb" "api" {
  name            = "api"
  internal        = false
  security_groups = [aws_security_group.alb.id]
  subnets         = module.vpc.public_subnets

  access_logs {
    bucket  = aws_s3_bucket.logs.id
    enabled = true
  }
}
EOF
cat > "$work/infra/infra/logs.tf" <<'EOF'
resource "aws_s3_bucket" "logs" {
  bucket = "shop-alb-logs"
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire"
    status = "Enabled"

    expiration {
      days = var.log_retention_days
    }
  }
}
EOF

render() { (cd "$work/$1" && shift && HOME="$work" node "$cli" render "$@" --output web); }
render shop "$root/tests/fixtures/shop.spec.json" --git
render shop "$demo/specs/shop-plan.spec.json"
render invites "$demo/specs/invite.flow.json" --git
render invites "$demo/specs/invite-plan.flow.json"
render infra "$demo/specs/infra.spec.json" --git

(cd "$work/pw" && npm init -y >/dev/null && npm i --silent playwright >/dev/null)
cp "$demo/shot.mjs" "$work/pw/"
cache="$work/.cache/codechart"
shot() { node "$work/pw/shot.mjs" "$@"; }
shot "$(ls "$cache"/shop-*/*invoices-for-paid-orders.html)" "$root/docs/images/map.png" 1200 760 dark tbl.orders
shot "$(ls "$cache"/invites-*/*accept-a-team-invite.flow.html)" "$root/docs/images/flow.png" 1200 760 dark expired
shot "$(ls "$cache"/shop-*/*sequences-table.html)" "$root/docs/images/plan-map.png" 1200 640 dark
shot "$(ls "$cache"/invites-*/*reject-revoked-invites.flow.html)" "$root/docs/images/plan-flow.png" 1200 760 dark
shot "$(ls "$cache"/infra-*/*load-balancer.html)" "$root/docs/images/infra.png" 1200 640 light alb
ls -la "$root"/docs/images/*.png
