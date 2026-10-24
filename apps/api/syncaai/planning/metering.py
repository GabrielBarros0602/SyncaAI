"""Every call a job makes, admitted before it starts and measured as it ends (ADR-0041,
ADR-0044).

``MeteredGenerator`` stands between the ladder and the generator. Before a call it asks
``admit`` whether the call may be made, which answers with the most the call can cost or
refuses it; no call is made past a ceiling. After a call it hands what it learned to
``record`` before the ladder sees the answer or the error, so a worker that dies a moment
later has already counted the call it paid for.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal

from syncaai.planning.context import PlanPrompt
from syncaai.planning.generator import Generation, PlanGenerator, Repair

# The width of ``ai_usage.error``. An exception's type is short; one longer than this is cut
# rather than allowed to fail the write that records it.
ERROR_CHARS = 64

Admit = Callable[[PlanPrompt, Repair | None], Decimal]


def admit_anything(prompt: PlanPrompt, repair: Repair | None) -> Decimal:  # noqa: ARG001
    """No ceiling and nothing to pay: what a generator is metered with outside a job."""
    return Decimal(0)


@dataclass(frozen=True)
class Call:
    #: 0 for the answer, 1 for its repair, as ``ai_job_answers`` numbers them.
    position: int
    #: The model that answered, or for a failed call the one that was asked.
    model: str
    latency_ms: int
    #: None when the call raised.
    input_tokens: int | None
    output_tokens: int | None
    #: The type of what the call raised. Never the message, which can carry what was sent.
    error: str | None
    #: The most the call could cost, as admitted: what a failed call is charged (ADR-0044).
    estimate: Decimal = Decimal(0)


class MeteredGenerator:
    def __init__(
        self,
        inner: PlanGenerator,
        record: Callable[[Call], None],
        *,
        admit: Admit = admit_anything,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._inner = inner
        self._record = record
        self._admit = admit
        self._monotonic = monotonic

    @property
    def provider(self) -> str:
        return self._inner.provider

    @property
    def model(self) -> str:
        return self._inner.model

    def generate(self, prompt: PlanPrompt, *, repair: Repair | None = None) -> Generation:
        position = 0 if repair is None else 1
        estimate = self._admit(prompt, repair)
        started = self._monotonic()
        try:
            generation = self._inner.generate(prompt, repair=repair)
        except Exception as error:
            failed = Call(
                position=position,
                model=self._inner.model,
                latency_ms=self._since(started),
                input_tokens=None,
                output_tokens=None,
                error=type(error).__name__[:ERROR_CHARS],
                estimate=estimate,
            )
            self._record(failed)
            raise
        self._record(
            Call(
                position=position,
                model=generation.model,
                latency_ms=self._since(started),
                input_tokens=generation.input_tokens,
                output_tokens=generation.output_tokens,
                error=None,
                estimate=estimate,
            )
        )
        return generation

    def _since(self, started: float) -> int:
        return round((self._monotonic() - started) * 1000)
