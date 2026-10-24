"""Measuring each call as it ends (ADR-0041), with no database and no model."""

from datetime import datetime, timezone

import pytest

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
