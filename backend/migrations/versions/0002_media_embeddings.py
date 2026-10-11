"""CLIP embeddings with pgvector for near-duplicate ("seen before") search.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-11
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Neon ships pgvector; this enables it for the database.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("""
        CREATE TABLE media_embeddings (
            media_id   uuid PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
            model      varchar(64) NOT NULL,
            embedding  vector(512) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    # HNSW gives fast approximate nearest-neighbour search on cosine distance.
    op.execute("""
        CREATE INDEX ix_media_embeddings_hnsw
        ON media_embeddings USING hnsw (embedding vector_cosine_ops)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS media_embeddings")
