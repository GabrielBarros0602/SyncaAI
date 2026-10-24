"""Every call a job makes, measured as it ends (ADR-0041).

``MeteredGenerator`` stands between the ladder and the generator. It times each call and hands
what it learned to ``record`` before the ladder sees the answer or the error, so a worker that
dies a moment later has already counted the call it paid for.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass

from syncaai.planning.context import PlanPrompt
from syncaai.planning.generator import Generation, PlanGenerator, Repair

# The width of ``ai_usage.error``. An exception's type is short; one longer than this is cut
# rather than allowed to fail the write that records it.
ERROR_CHARS = 64


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


class MeteredGenerator:
    def __init__(
        self,
        inner: PlanGenerator,
        record: Callable[[Call], None],
        *,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._inner = inner
        self._record = record
        self._monotonic = monotonic

    @property
    def provider(self) -> str:
        return self._inner.provider

    @property
    def model(self) -> str:
        return self._inner.model

    def generate(self, prompt: PlanPrompt, *, repair: Repair | None = None) -> Generation:
        position = 0 if repair is None else 1
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
            )
        )
        return generation

    def _since(self, started: float) -> int:
        return round((self._monotonic() - started) * 1000)
