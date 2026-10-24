"""The ladder an answer climbs before it becomes a draft (ADR-0005, ADR-0035).

The scenario is the one ADR-0035 was decided on: a request to learn SQL in two weeks comes
back with twelve steps, three of them invalid. Every answer is scripted, so each test says
exactly what the model returned and asserts what the pipeline did with it.
"""

import json
from datetime import date, datetime, timezone

import pytest

from syncaai.planning.context import PlanPrompt, build_plan_context, build_repair_message
from syncaai.planning.generator import FakeGenerator, SampleGenerator
from syncaai.planning.ladder import NO_USABLE_PLAN, LadderResult, run_ladder

PROMPT = PlanPrompt(
    version="plan-1", instructions="instructions", message="{}", fingerprint="0" * 64
)
BLOCK = 60


def _item(title: str, minutes: int = 45, depends_on: tuple[int, ...] = ()) -> dict[str, object]:
    return {
        "title": title,
        "description": "",
        "estimated_minutes": minutes,
        "depends_on": list(depends_on),
        "links": [],
    }


def _answer(*items: dict[str, object]) -> str:
    return json.dumps({"items": list(items)})


def _steps(count: int, *, broken: frozenset[int] = frozenset()) -> str:
    """``count`` steps, each one listed in ``broken`` taking longer than the block."""
    return _answer(*(_item(f"Step {n}", 300 if n in broken else 45) for n in range(count)))


# Twelve steps, three invalid: the seventh repeats the third's title, the eleventh takes 300
# minutes against a block of 60, and the twelfth depends on a step after it.
NINE_OF_TWELVE = _answer(
    *(_item(f"Step {n}") for n in range(6)),
    _item("Step 2"),
    *(_item(f"Step {n}") for n in range(7, 10)),
    _item("Step 10", minutes=300),
    _item("Step 11", depends_on=(12,)),
)
TWELVE_OF_TWELVE = _steps(12)
TEN_OF_TWELVE = _steps(12, broken=frozenset({10, 11}))
SEVEN_OF_TWELVE = _steps(12, broken=frozenset({7, 8, 9, 10, 11}))
NOTHING_KEPT = _steps(3, broken=frozenset({0, 1, 2}))
NOT_A_PLAN = "Here is your plan: first, learn SELECT."


def _run(*answers: str) -> tuple[LadderResult, FakeGenerator]:
    generator = FakeGenerator(answers)
    return run_ladder(generator, PROMPT, max_item_minutes=BLOCK), generator


def test_a_clean_answer_is_used_with_one_call() -> None:
    result, generator = _run(TWELVE_OF_TWELVE)

    assert len(generator.calls) == 1
    assert generator.calls[0] == (PROMPT, None)
    assert result.chosen == 0
    assert result.report is not None and len(result.report.kept) == 12


def test_any_step_that_fails_asks_for_the_one_repair() -> None:
    """Nine of twelve would already be a draft. The repair is asked for anyway, carrying the
    first answer verbatim and one line per error, addressed the way the model numbers steps."""
    result, generator = _run(NINE_OF_TWELVE, TWELVE_OF_TWELVE)

    [_, (prompt, repair)] = generator.calls
    assert prompt == PROMPT
    assert repair is not None
    assert repair.previous == NINE_OF_TWELVE
    assert repair.message == build_repair_message(
        [
            "items[6]: the title repeats an earlier step's",
            "items[10]: it takes 300 minutes, and a step has to take between 15 and 60",
            "items[11]: it depends on items[12], which does not come before it",
        ]
    )
    assert result.chosen == 1
    assert result.report is not None and len(result.report.kept) == 12


def test_an_answer_that_is_not_a_plan_asks_for_the_repair_too() -> None:
    result, generator = _run(NOT_A_PLAN, TWELVE_OF_TWELVE)

    repair = generator.calls[1][1]
    assert repair is not None
    assert repair.previous == NOT_A_PLAN
    assert "- the answer: Invalid JSON" in repair.message
    assert result.chosen == 1


@pytest.mark.parametrize(
    ("first", "repaired", "chosen"),
    [
        pytest.param(NINE_OF_TWELVE, TWELVE_OF_TWELVE, 1, id="the repair kept more"),
        pytest.param(NINE_OF_TWELVE, SEVEN_OF_TWELVE, 0, id="the repair kept fewer"),
        pytest.param(NINE_OF_TWELVE, NOT_A_PLAN, 0, id="the repair is not a plan"),
        pytest.param(NINE_OF_TWELVE, NINE_OF_TWELVE, 1, id="a tie goes to the repair"),
        pytest.param(NOT_A_PLAN, TEN_OF_TWELVE, 1, id="only the repair is a plan"),
    ],
)
def test_the_answer_that_kept_more_steps_is_the_one_used(
    first: str, repaired: str, chosen: int
) -> None:
    """ADR-0035's table, row by row: the person never gets less than the first call had."""
    result, _ = _run(first, repaired)

    assert result.chosen == chosen
    assert result.failure is None
    assert result.report is result.attempts[chosen].report


@pytest.mark.parametrize(
    ("first", "repaired"),
    [
        pytest.param(NOT_A_PLAN, NOT_A_PLAN, id="neither is a plan"),
        pytest.param(NOTHING_KEPT, NOTHING_KEPT, id="neither kept a step"),
        pytest.param(NOT_A_PLAN, NOTHING_KEPT, id="one is no plan, one kept nothing"),
    ],
)
def test_with_no_step_kept_by_either_the_job_fails_visibly(first: str, repaired: str) -> None:
    result, _ = _run(first, repaired)

    assert result.chosen is None
    assert result.report is None
    assert result.failure == NO_USABLE_PLAN


def test_there_is_never_a_second_repair() -> None:
    """A third answer is scripted and never asked for: one repair, however bad it was."""
    result, generator = _run(NOT_A_PLAN, NOT_A_PLAN, TWELVE_OF_TWELVE)

    assert len(generator.calls) == 2
    assert result.failure == NO_USABLE_PLAN


def test_both_attempts_are_returned_raw_with_their_errors() -> None:
    """The job keeps both (ADR-0035): a regression in the repair only shows if it is there."""
    result, _ = _run(NINE_OF_TWELVE, SEVEN_OF_TWELVE)

    first, second = result.attempts
    assert (first.generation.raw, second.generation.raw) == (NINE_OF_TWELVE, SEVEN_OF_TWELVE)
    assert len(first.errors) == 3
    assert len(second.errors) == 5


def test_the_person_s_block_bounds_the_steps() -> None:
    """Steps of 45 minutes are fine against a block of 60 and all fail against one of 30."""
    generator = FakeGenerator([TWELVE_OF_TWELVE, TWELVE_OF_TWELVE])

    result = run_ladder(generator, PROMPT, max_item_minutes=30)

    assert len(generator.calls) == 2
    assert result.failure == NO_USABLE_PLAN


def test_schema_errors_are_addressed_like_the_domain_s_and_never_echo_the_answer() -> None:
    answer = json.dumps(
        {
            "items": [
                {**_item("Step 0"), "estimated_minutes": "a whole afternoon"},
                {**_item("Step 1"), "colour": "blue"},
            ]
        }
    )

    result, _ = _run(answer, TWELVE_OF_TWELVE)

    errors = result.attempts[0].errors
    assert any(line.startswith("items[0].estimated_minutes: ") for line in errors), errors
    assert any(line.startswith("items[1].colour: ") for line in errors), errors
    assert not any("afternoon" in line or "blue" in line for line in errors), errors


def test_the_fake_refuses_a_call_it_was_not_given_an_answer_for() -> None:
    generator = FakeGenerator([])

    with pytest.raises(RuntimeError, match="call 1 was not scripted"):
        generator.generate(PROMPT)


@pytest.mark.parametrize("block", [15, 60, 240])
def test_the_sample_answer_passes_whole_whatever_the_person_s_block(block: int) -> None:
    """The development worker's answer is a plan the ladder keeps whole, with one call, for
    any block a person can set: a draft made locally never starts with a repair."""
    prompt = build_plan_context(
        "Plano de estudos",
        slots=[],
        horizon_days=1,
        days_off=frozenset({date(2031, 6, 2).isoweekday()}),
        block_minutes=block,
        zone_name="America/Sao_Paulo",
        now=datetime(2031, 6, 2, 15, 0, tzinfo=timezone.utc),
    )

    result = run_ladder(SampleGenerator(), prompt, max_item_minutes=block)

    assert len(result.attempts) == 1 and result.chosen == 0
    assert result.report is not None
    assert [item.minutes for item in result.report.kept] == [block] * 3
    assert [item.depends_on for item in result.report.kept] == [(), (0,), (1,)]
