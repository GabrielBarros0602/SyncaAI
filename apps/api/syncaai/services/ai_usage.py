"""Writing what a call used, one row per call, as it ends (ADR-0041)."""

import uuid
from collections.abc import Callable

from sqlalchemy.orm import Session, sessionmaker

from syncaai.models import AiUsage
from syncaai.planning.metering import Call
from syncaai.planning.prices import cost_of


def usage_recorder(
    factory: sessionmaker[Session],
    *,
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    attempt: int,
    provider: str,
    prompt_version: str,
) -> Callable[[Call], None]:
    """What a job's calls are recorded with. Each row is committed on its own, outside the
    job's transaction: a call is counted even if the attempt that made it never writes."""

    def record(call: Call) -> None:
        measured: dict[str, object]
        if call.input_tokens is None or call.output_tokens is None:
            measured = {"outcome": "failed", "error": call.error}
        else:
            cost = cost_of(
                provider,
                call.model,
                input_tokens=call.input_tokens,
                output_tokens=call.output_tokens,
            )
            measured = {
                "outcome": "completed",
                "input_tokens": call.input_tokens,
                "output_tokens": call.output_tokens,
                "cost_usd": cost,
            }
        with factory() as session, session.begin():
            session.add(
                AiUsage(
                    user_id=user_id,
                    job_id=job_id,
                    attempt=attempt,
                    position=call.position,
                    provider=provider,
                    model=call.model,
                    prompt_version=prompt_version,
                    latency_ms=call.latency_ms,
                    **measured,
                )
            )

    return record
