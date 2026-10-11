"""Upload limits that protect the free tiers (Neon storage, Render hours).

Two layers:
- per client IP, a sliding one-hour window kept in memory (one API instance is enough);
- a global 24-hour cap counted in Postgres, so it survives restarts and redeploys.
"""

import threading
import time
from collections import defaultdict, deque

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models

HOUR = 3600.0


class RateLimited(Exception):
    def __init__(self, message: str, retry_after: int):
        super().__init__(message)
        self.retry_after = retry_after


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_s: float = HOUR, clock=time.monotonic):
        self.limit, self.window_s, self.clock = limit, window_s, clock
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        """Record one hit for key, or raise RateLimited if the window is full."""
        now = self.clock()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] >= self.window_s:
                hits.popleft()
            if len(hits) >= self.limit:
                retry = int(self.window_s - (now - hits[0])) + 1
                raise RateLimited(
                    f"Upload limit reached ({self.limit} per hour). Try again in "
                    f"{max(1, retry // 60)} min.", retry)
            hits.append(now)
            if len(self._hits) > 10_000:  # forget idle clients so memory stays bounded
                for k in [k for k, v in self._hits.items() if not v]:
                    del self._hits[k]


def check_daily_cap(session: Session, cap: int) -> None:
    since = func.now() - func.make_interval(0, 0, 0, 1)  # one day
    count = session.scalar(
        select(func.count()).select_from(models.AnalysisJob)
        .where(models.AnalysisJob.created_at >= since)
    )
    if count >= cap:
        raise RateLimited("MetaProof has reached its daily analysis limit. Please try again "
                          "tomorrow.", retry_after=3600)
