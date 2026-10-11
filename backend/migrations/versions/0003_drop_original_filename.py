"""Stop storing upload filenames: the frontend promises they stay on the user's device.

Dropping the column also erases the names stored before this change.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-11
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("analysis_jobs", "original_filename")


def downgrade() -> None:
    op.add_column("analysis_jobs", sa.Column("original_filename", sa.String(255)))
