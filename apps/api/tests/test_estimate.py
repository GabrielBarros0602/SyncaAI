"""The most a call can cost, before it is made (ADR-0044)."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from syncaai.planning.context import build_plan_context, build_repair_message
from syncaai.planning.contract import MAX_ANSWER_TOKENS
from syncaai.planning.estimate import estimate_cost, input_token_bound
from syncaai.planning.generator import Repair
from syncaai.planning.prices import cost_of
from syncaai.planning.slots import DaySlots

ZONE = ZoneInfo("America/Sao_Paulo")
MONDAY = datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc)
HAIKU = ("anthropic", "claude-haiku-5-5")


def _evenings() -> list[DaySlots]:
    """The week the local model was measured against (ADR-0040): weekday evenings and a
    Saturday afternoon."""
    first = MONDAY.astimezone(ZONE).date()
    days = []
    for offset in range(7):
        day = first + timedelta(days=offset)
        if day.isoweekday() == 7:
            continue
        start, end = (14, 18) if day.isoweekday() == 6 else (19, 22)
        opens = datetime(day.year, day.month, day.day, start, tzinfo=ZONE)
        closes = datetime(day.year, day.month, day.day, end, tzinfo=ZONE)
        days.append(
            DaySlots(
                day,
                ((opens.astimezone(timezone.utc), closes.astimezone(timezone.utc)),),
                (end - start) * 60,
            )
        )
    return days


def _prompt(request: str = "Organizar a mudança de apartamento no fim do mês") -> object:
    return build_plan_context(
        request,
        slots=_evenings(),
        horizon_days=7,
        days_off=frozenset({7}),
        block_minutes=60,
        zone_name="America/Sao_Paulo",
        now=MONDAY,
    )


def test_the_bound_covers_what_the_local_model_actually_read() -> None:
    """qwen3.5:4b read this prompt, with the schema, as 1,164 to 1,171 tokens (ADR-0040)."""
    assert input_token_bound(_prompt()) >= 1171


def test_a_request_in_a_costlier_script_is_counted_by_its_bytes() -> None:
    latin = input_token_bound(_prompt("a" * 100))
    emoji = input_token_bound(_prompt("\N{GRINNING FACE}" * 100))

    assert emoji - latin == 400 - 100


def test_a_repair_adds_the_first_answer_by_its_bytes_and_the_correction() -> None:
    previous = "ç" * 1000
    correction = build_repair_message(["items[0]: the title is empty"])

    with_repair = input_token_bound(_prompt(), Repair(previous, correction))

    assert with_repair - input_token_bound(_prompt()) >= 2000 + len(correction) // 2


@pytest.mark.parametrize("provider", ["sample", "ollama", "fake"])
def test_a_free_call_is_estimated_at_nothing(provider: str) -> None:
    assert estimate_cost(provider, "any-model", _prompt()) == 0


def test_a_paid_call_is_estimated_above_the_costliest_call_measured() -> None:
    """The longest answer measured was 1,050 tokens on 1,167 read; the estimate prices the
    full answer cap, so it covers that call and any up to the cap."""
    estimate = estimate_cost(*HAIKU, _prompt())

    assert estimate >= cost_of(*HAIKU, input_tokens=1171, output_tokens=1050)
    assert estimate >= cost_of(*HAIKU, input_tokens=0, output_tokens=MAX_ANSWER_TOKENS)
