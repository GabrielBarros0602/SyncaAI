"""Measuring each call as it ends (ADR-0041), with no database and no model."""

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from syncaai.errors import AllowanceSpentError
from syncaai.planning.context import build_plan_context
from syncaai.planning.generator import Generation, Repair
from syncaai.planning.metering import ERROR_CHARS, Call, MeteredGenerator

PROMPT = build_plan_context(
    "Plano de estudos para a prova de sábado",
    slots=[],
    horizon_days=1,
    days_off=frozenset({1}),
    block_minutes=60,
    zone_name="America/Sao_Paulo",
    now=datetime(2031, 6, 2, 15, 0, tzinfo=timezone.utc),
)


class _Model:
    """Asked for one model and answered by another, as a provider may name a snapshot."""

    provider = "ollama"
    model = "asked-model"

    def __init__(self, raises: Exception | None = None) -> None:
        self._raises = raises

    def generate(self, prompt: object, *, repair: Repair | None = None) -> Generation:
        if self._raises is not None:
            raise self._raises
        return Generation(raw="{}", model="answering-model", input_tokens=812, output_tokens=344)


def _metered(inner: _Model, recorded: list[Call]) -> MeteredGenerator:
    ticks = iter([10.0, 10.25])
    return MeteredGenerator(inner, recorded.append, monotonic=lambda: next(ticks))


def test_a_call_is_recorded_with_the_model_that_answered_its_tokens_and_its_time() -> None:
    recorded: list[Call] = []

    generation = _metered(_Model(), recorded).generate(PROMPT)

    assert generation.raw == "{}"
    assert recorded == [
        Call(
            position=0,
            model="answering-model",
            latency_ms=250,
            input_tokens=812,
            output_tokens=344,
            error=None,
        )
    ]


def test_a_repair_is_recorded_as_the_second_position() -> None:
    recorded: list[Call] = []

    _metered(_Model(), recorded).generate(PROMPT, repair=Repair("{}", "fix it"))

    assert [call.position for call in recorded] == [1]


def test_a_call_that_raises_is_recorded_as_failed_and_raises_unchanged() -> None:
    """A timeout here can still be billed there, so it is counted (ADR-0041)."""
    recorded: list[Call] = []
    timeout = TimeoutError("timed out")

    with pytest.raises(TimeoutError) as raised:
        _metered(_Model(raises=timeout), recorded).generate(PROMPT)

    assert raised.value is timeout
    assert recorded == [
        Call(
            position=0,
            model="asked-model",
            latency_ms=250,
            input_tokens=None,
            output_tokens=None,
            error="TimeoutError",
        )
    ]


def test_an_answer_that_could_not_be_recorded_never_reaches_the_ladder() -> None:
    def refuse(call: Call) -> None:
        raise ConnectionError("the database went away")

    metered = MeteredGenerator(_Model(), refuse)

    with pytest.raises(ConnectionError):
        metered.generate(PROMPT)


def test_an_error_type_longer_than_its_column_is_cut_rather_than_failing_the_write() -> None:
    long_named = type("E" * (ERROR_CHARS + 6), (Exception,), {})
    recorded: list[Call] = []

    with pytest.raises(long_named):
        _metered(_Model(raises=long_named()), recorded).generate(PROMPT)

    assert recorded[0].error == "E" * ERROR_CHARS


def test_it_answers_as_the_generator_it_measures() -> None:
    metered = MeteredGenerator(_Model(), lambda call: None)

    assert (metered.provider, metered.model) == ("ollama", "asked-model")


# --- Admitting a call ----------------------------------------------------------------------


class _Counting(_Model):
    def __init__(self, raises: Exception | None = None) -> None:
        super().__init__(raises)
        self.calls = 0

    def generate(self, prompt: object, *, repair: Repair | None = None) -> Generation:
        self.calls += 1
        return super().generate(prompt, repair=repair)


def test_a_call_past_a_ceiling_is_never_made_nor_recorded() -> None:
    """Refused before it starts: nothing was sent, so there is nothing to count (ADR-0044)."""
    inner = _Counting()
    recorded: list[Call] = []

    def refuse(prompt: object, repair: Repair | None) -> Decimal:
        raise AllowanceSpentError(60)

    with pytest.raises(AllowanceSpentError):
        MeteredGenerator(inner, recorded.append, admit=refuse).generate(PROMPT)

    assert (inner.calls, recorded) == (0, [])


def test_admit_is_asked_about_the_call_about_to_be_made() -> None:
    asked: list[tuple[object, Repair | None]] = []
    repair = Repair("{}", "fix it")

    def admit(prompt: object, repair: Repair | None) -> Decimal:
        asked.append((prompt, repair))
        return Decimal(0)

    MeteredGenerator(_Model(), lambda call: None, admit=admit).generate(PROMPT, repair=repair)

    assert asked == [(PROMPT, repair)]


def test_a_failed_call_carries_the_estimate_it_was_admitted_at() -> None:
    """What a failed call is charged: the most it could have cost (ADR-0041, ADR-0044)."""
    recorded: list[Call] = []
    ticks = iter([10.0, 10.25])
    metered = MeteredGenerator(
        _Model(raises=TimeoutError()),
        recorded.append,
        admit=lambda prompt, repair: Decimal("0.0022403"),
        monotonic=lambda: next(ticks),
    )

    with pytest.raises(TimeoutError):
        metered.generate(PROMPT)

    assert recorded[0].estimate == Decimal("0.0022403")
