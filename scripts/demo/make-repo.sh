#!/usr/bin/env bash
# Builds the made-up shop repo the demo GIF records: one commit, then the
# uncommitted change that scripts/demo/shop.spec.json describes.
set -euo pipefail
dir="${1:?usage: make-repo.sh <empty dir>}"
mkdir -p "$dir" && cd "$dir"
git init -q && git config user.name demo && git config user.email demo@example.com
mkdir -p shop/models shop/api db/migrations config tests

cat > shop/models/customer.py <<'EOF'
from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import UUID
from shop.db import Base


class Customer(Base):
    __tablename__ = "customers"
    id = Column(UUID, primary_key=True)
    email = Column(Text, nullable=False, unique=True)
EOF

cat > shop/models/order_status.py <<'EOF'
import enum


class OrderStatus(str, enum.Enum):
    PENDING = "pending"
    PAID = "paid"
    SHIPPED = "shipped"
EOF

cat > shop/models/payment.py <<'EOF'
import enum


class PaymentMethod(str, enum.Enum):
    CARD = "card"
    PAYPAL = "paypal"
EOF

cat > shop/models/order.py <<'EOF'
from sqlalchemy import Column, Enum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from shop.db import Base
from shop.models.order_status import OrderStatus


class Order(Base):
    __tablename__ = "orders"
    id = Column(UUID, primary_key=True)
    customer_id = Column(UUID, ForeignKey("customers.id"), nullable=False)
    status = Column(Enum(OrderStatus, name="order_status"), nullable=False)
EOF

cat > shop/settings.py <<'EOF'
import os

DATABASE_URL = os.environ["DATABASE_URL"]
INVOICE_PREFIX = os.environ.get("INVOICE_PREFIX", "INV-")
EOF

cat > config/flags.yaml <<'EOF'
checkoutV2: true
EOF

cat > shop/api/orders.py <<'EOF'
from fastapi import APIRouter

router = APIRouter(prefix="/orders")
EOF

printf '# Changelog\n' > CHANGELOG.md
printf 'DATABASE_URL=postgres://localhost/shop\n' > .env.example
git add -A && git commit -qm "Shop: orders and customers"

# --- the agent's change, left uncommitted ---

cat > shop/models/order_status.py <<'EOF'
import enum


class OrderStatus(str, enum.Enum):
    PENDING = "pending"
    PAID = "paid"
    SHIPPED = "shipped"
    REFUNDED = "refunded"
EOF

cat > shop/models/payment.py <<'EOF'
import enum


class PaymentMethod(str, enum.Enum):
    CARD = "card"
    PAYPAL = "paypal"
    BANK_TRANSFER = "bank_transfer"
EOF

cat > shop/models/order.py <<'EOF'
from sqlalchemy import Column, Enum, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from shop.db import Base
from shop.models.order_status import OrderStatus


class Order(Base):
    __tablename__ = "orders"
    id = Column(UUID, primary_key=True)
    customer_id = Column(UUID, ForeignKey("customers.id"), nullable=False)
    status = Column(Enum(OrderStatus, name="order_status"), nullable=False,
                    default=OrderStatus.PENDING)
    coupon_code = Column(Text, nullable=True)

    def mark_refunded(self):
        self.status = OrderStatus.REFUNDED
EOF

cat > shop/models/invoice.py <<'EOF'
from sqlalchemy import Column, Enum, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from shop.db import Base
from shop.models.payment import PaymentMethod


class Invoice(Base):
    __tablename__ = "invoices"
    id = Column(UUID, primary_key=True)
    order_id = Column(UUID, ForeignKey("orders.id"), nullable=False, unique=True)
    method = Column(Enum(PaymentMethod, name="payment_method"), nullable=False)
    number = Column(Text, nullable=False, unique=True)
EOF

cat > shop/api/refunds.py <<'EOF'
from fastapi import APIRouter, HTTPException
from shop.flags import flag
from shop.models.order_status import OrderStatus
from shop.orders import get_order

router = APIRouter(prefix="/orders")


@router.post("/{order_id}/refund")
def refund(order_id: str):
    if not flag("refundsEnabled"):
        raise HTTPException(404)
    order = get_order(order_id)
    if order.status != OrderStatus.PAID:
        raise HTTPException(409, "only paid orders can be refunded")
    order.mark_refunded()
    return order
EOF

cat > db/migrations/0042_invoices.py <<'EOF'
from alembic import op
from shop.settings import INVOICE_PREFIX


def upgrade():
    op.execute("ALTER TYPE order_status ADD VALUE 'refunded'")
    op.execute("ALTER TYPE payment_method ADD VALUE 'bank_transfer'")
    op.add_column("orders", op.Column("coupon_code", op.Text(), nullable=True))
    op.create_table("invoices", ...)
    op.execute(f"""
        INSERT INTO invoices (id, order_id, method, number)
        SELECT gen_random_uuid(), id, 'card',
               '{INVOICE_PREFIX}' || row_number() OVER (ORDER BY id)
        FROM orders WHERE status = 'paid'
    """)
EOF

printf 'checkoutV2: true\nrefundsEnabled: false\n' > config/flags.yaml
printf 'def test_one_invoice_per_paid_order(db):\n    ...\n' > tests/test_invoice_backfill.py
printf '# Changelog\n\n- Invoices for paid orders; refunds behind refundsEnabled\n' > CHANGELOG.md
printf 'DATABASE_URL=postgres://localhost/shop\nINVOICE_PREFIX=INV-\n' > .env.example
