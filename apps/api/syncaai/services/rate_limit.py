"""Fixed-window rate limiting.

Counting happens in one statement. An ``INSERT ... ON CONFLICT DO UPDATE ... RETURNING``
increments and reads the counter atomically, so two concurrent requests cannot both read
the same value and both decide they are under the limit — which is precisely the race an
attacker sending requests in parallel would be exploiting.

Reading first and writing second would be simpler and wrong.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from syncaai.errors import RateLimitExceededError

WINDOW = timedelta(hours=1)

# One statement: increment if the row exists, create it otherwise, and return the value
# after the change.
_INCREMENT = text("""
    INSERT INTO rate_limit_counters (id, bucket, window_start, hits, created_at, updated_at)
    VALUES (gen_random_uuid(), :bucket, :window_start, 1, now(), now())
    ON CONFLICT (bucket, window_start)
    DO UPDATE SET hits = rate_limit_counters.hits + 1, updated_at = now()
    RETURNING hits
""")


class RateLimiter:
    def __init__(self, session: Session) -> None:
        self._session = session

    def check(self, bucket: str, limit: int, *, now: datetime | None = None) -> None:
        """Record one hit against the bucket and raise if the allowance is spent.

        Counting the attempt before deciding is deliberate: a rejected request still cost
        the server the work of handling it, and not counting it would let a caller keep
        knocking for free once it was over the limit.
        """
        moment = now or datetime.now(timezone.utc)
        window_start = self._window_start(moment)

        hits = self._session.scalar(_INCREMENT, {"bucket": bucket, "window_start": window_start})

        # Committed here, before the endpoint runs. A failed login raises, the request's
        # transaction is discarded, and with it the increment would be — so the one case
        # the limit exists for would not be counted at all.
        self._session.commit()

        if hits is not None and hits > limit:
            raise RateLimitExceededError(self._seconds_until(window_start + WINDOW, moment))

    @staticmethod
    def _window_start(moment: datetime) -> datetime:
        """Truncate to the hour, so every caller shares the same window boundaries."""
        return moment.replace(minute=0, second=0, microsecond=0)

    @staticmethod
    def _seconds_until(deadline: datetime, moment: datetime) -> int:
        return max(1, int((deadline - moment).total_seconds()))
