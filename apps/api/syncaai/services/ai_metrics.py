"""What the AI layer's own records say about it (ADR-0006, ADR-0045).

Readings over the jobs, for deciding with numbers. Nothing on a request's path reads them.
"""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import ColumnElement, SQLColumnExpression, and_, exists, func, select
from sqlalchemy.orm import Session, aliased

from syncaai.models import AiJob

# ADR-0006's "a few hours".
CACHE_WINDOW = timedelta(hours=6)


@dataclass(frozen=True)
class WouldBeCacheHits:
    #: Jobs that could be measured: those still holding their request and fingerprint, which
    #: means the last thirty days.
    jobs: int
    #: Of those, how many an earlier job would have answered from a cache.
    hits: int


def _normalised(request: SQLColumnExpression[str | None]) -> ColumnElement[str]:
    """Trimmed, its runs of whitespace one space, lowercased: what a cache would compare."""
    return func.lower(func.regexp_replace(func.btrim(request), r"\s+", " ", "g"))


def would_be_cache_hits(session: Session, *, within: timedelta = CACHE_WINDOW) -> WouldBeCacheHits:
    """How many requests a response cache would have answered (ADR-0045).

    A job counts as a hit when an earlier job of the same person, built from the same prompt
    version, the same request and the same context fingerprint, had finished as a plan before
    it was asked for, and no longer than ``within`` before. The model is not compared: one is
    named (ADR-0043), so a measurement spanning a change of model is split at the change.
    """
    later = aliased(AiJob)
    earlier = aliased(AiJob)
    answered_before = exists().where(
        earlier.user_id == later.user_id,
        earlier.status == "done",
        earlier.prompt_version == later.prompt_version,
        earlier.context_fingerprint == later.context_fingerprint,
        _normalised(earlier.request) == _normalised(later.request),
        earlier.finished_at < later.created_at,
        earlier.finished_at >= later.created_at - within,
    )
    measured = and_(later.context_fingerprint.is_not(None), later.request.is_not(None))
    jobs, hits = session.execute(
        select(func.count(), func.count().filter(answered_before)).where(measured)
    ).one()
    return WouldBeCacheHits(jobs=int(jobs), hits=int(hits))
