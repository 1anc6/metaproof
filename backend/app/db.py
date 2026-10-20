from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

# pool_pre_ping matters on Neon: idle computes scale to zero and drop connections.
# connect_timeout bounds a stalled connect (a waking or unreachable database) so a request
# fails with an error instead of hanging until Render's proxy gives up.
engine = create_engine(get_settings().database_url, pool_pre_ping=True, pool_size=5,
                       connect_args={"connect_timeout": 15})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one session per request."""
    with SessionLocal() as session:
        yield session
