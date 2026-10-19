"""Record which analyzer a running job is on, so the progress screen shows real state.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-20
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("analysis_jobs", sa.Column("current_step", sa.String(32)))


def downgrade() -> None:
    op.drop_column("analysis_jobs", "current_step")
