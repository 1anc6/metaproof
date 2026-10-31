"""Record why a verdict is inconclusive: too little evidence, or evidence pointing more than one way.

Existing inconclusive verdicts are filled in from their stored scores with the engine's rules as
they stand at this revision, so older reports explain themselves too.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-31
"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

# app/engine.py at engine 0.2.0, copied so this revision never changes when the engine does.
MIN_SUPPORT = 1.0
MIN_AUTHENTIC_SUPPORT = 2.0


def upgrade() -> None:
    op.add_column("verdicts", sa.Column("inconclusive_reason", sa.String(16)))

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, scores FROM verdicts WHERE label = 'inconclusive'"))
    for verdict_id, scores in rows.all():
        scores = scores or {}
        # Ties go to the first outcome, as in the engine's stable sort.
        best = max(("authentic", "edited", "ai"), key=lambda k: scores.get(k, 0.0))
        needed = MIN_AUTHENTIC_SUPPORT if best == "authentic" else MIN_SUPPORT
        reason = "insufficient" if scores.get(best, 0.0) < needed else "conflicting"
        conn.execute(sa.text("UPDATE verdicts SET inconclusive_reason = :r WHERE id = :id"),
                     {"r": reason, "id": verdict_id})


def downgrade() -> None:
    op.drop_column("verdicts", "inconclusive_reason")
