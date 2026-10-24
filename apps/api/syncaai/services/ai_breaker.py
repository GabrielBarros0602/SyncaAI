"""The circuit breaker of ADR-0006, read from the provider's latest calls (ADR-0046).

No state of its own: ``ai_usage`` records every call with its outcome (ADR-0041), and the
breaker is a reading of the last few, the same for the API and for every worker.

- **Open** while the provider's ``FAILURES_TO_OPEN`` latest calls all failed and the latest
  is younger than ``COOL_DOWN``.
- **Half-open** once that latest failure is older: the next call goes through as a probe. A
  probe that fails is a new latest failure, and the breaker is open again.
- **Closed** otherwise.
"""

import math
from datetime import datetime, timedelta

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from syncaai.errors import ProviderUnavailableError
from syncaai.models import AiUsage

FAILURES_TO_OPEN = 3
# Under the claim's 120-second lock, and a probe a minute costs nothing anyone notices.
COOL_DOWN = timedelta(seconds=60)


def latest_calls_statement(provider: str) -> Select[tuple[str, datetime]]:
    return (
        select(AiUsage.outcome, AiUsage.created_at)
        .where(AiUsage.provider == provider)
        .order_by(AiUsage.created_at.desc())
        .limit(FAILURES_TO_OPEN)
    )


def seconds_until_probe(session: Session, provider: str) -> float | None:
    """How long the breaker stays open; None while it lets a call through."""
    latest = latest_calls_statement(provider).subquery()
    calls, all_failed, wait = session.execute(
        select(
            func.count(),
            func.bool_and(latest.c.outcome == "failed"),
            func.extract("epoch", func.max(latest.c.created_at) + COOL_DOWN - func.now()),
        ).select_from(latest)
    ).one()
    if calls < FAILURES_TO_OPEN or not all_failed or wait is None or wait <= 0:
        return None
    return float(wait)


def refuse_while_open(session: Session, provider: str) -> None:
    wait = seconds_until_probe(session, provider)
    if wait is not None:
        raise ProviderUnavailableError(max(1, math.ceil(wait)))
