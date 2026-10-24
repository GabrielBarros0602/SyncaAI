"""Real answers from the local model, labelled by a person (ADR-0005, ADR-0048).

Each file in ``tests/golden`` is what the model answered, once or with its repair, to a
synthetic request against a synthetic week, captured by ``scripts/capture_golden.py`` and then
labelled by hand. The answers are replayed through the ladder and the scheduler with no model,
and three things are held: the prompt the answer came from is still the prompt the code builds;
the validator keeps and discards what the label says, for the reason it gives; and the plan
kept is placed where a plan may be. Nothing is a snapshot of what the code happened to do.
"""

import json
from datetime import date, datetime, timedelta
from itertools import pairwise
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from syncaai.planning.context import PlanPrompt, build_plan_context, prompt_digest
from syncaai.planning.generator import FakeGenerator
from syncaai.planning.ladder import LadderResult, run_ladder
from syncaai.planning.scheduler import Step, schedule_this_week, week_end
from syncaai.planning.slots import DaySlots

FIXTURES = sorted((Path(__file__).parent / "golden").glob("*.json"))
RECAPTURE = (
    "the prompt changed since this answer was captured: run scripts/capture_golden.py, "
    "relabel, and replace the fixtures in the same pull request (ADR-0005, ADR-0048)"
)


def _load(path: Path) -> dict[str, Any]:
    fixture: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return fixture


def _days(context: dict[str, Any]) -> list[DaySlots]:
    return [
        DaySlots(
            date.fromisoformat(day["day"]),
            tuple(
                (datetime.fromisoformat(start), datetime.fromisoformat(end))
                for start, end in day["free"]
            ),
            day["budget_minutes"],
        )
        for day in context["days"]
    ]


def _prompt(fixture: dict[str, Any]) -> PlanPrompt:
    context = fixture["context"]
    return build_plan_context(
        fixture["request"],
        slots=_days(context),
        horizon_days=context["horizon_days"],
        days_off=frozenset(context["days_off"]),
        block_minutes=context["block_minutes"],
        zone_name=context["zone"],
        now=datetime.fromisoformat(context["now"]),
    )


def _replayed(fixture: dict[str, Any]) -> LadderResult:
    answers = [answer["raw"] for answer in fixture["answers"]]
    return run_ladder(
        FakeGenerator(answers),
        _prompt(fixture),
        max_item_minutes=fixture["context"]["block_minutes"],
    )


def _invalid(answer: dict[str, Any]) -> bool:
    """Not a plan, a step discarded, or a dependency the validator had to drop (ADR-0049)."""
    return (
        not answer["parses"]
        or bool(answer["discarded"])
        or bool(answer.get("dropped_dependencies"))
    )


def test_the_batch_holds_what_adr_0005_asked_for() -> None:
    """Five to ten real answers, at least two of them invalid."""
    labels = [_load(path)["label"] for path in FIXTURES]
    invalid = [
        label for label in labels if label and any(_invalid(answer) for answer in label["answers"])
    ]

    assert 5 <= len(FIXTURES) <= 10
    assert len(invalid) >= 2


@pytest.mark.parametrize("path", FIXTURES, ids=lambda path: path.stem)
def test_the_answer_came_from_the_prompt_the_code_builds(path: Path) -> None:
    fixture = _load(path)
    prompt = _prompt(fixture)

    assert prompt.version == fixture["captured"]["prompt_version"], RECAPTURE
    assert prompt_digest(prompt) == fixture["captured"]["prompt_sha256"], RECAPTURE


@pytest.mark.parametrize("path", FIXTURES, ids=lambda path: path.stem)
def test_the_validator_agrees_with_the_label(path: Path) -> None:
    fixture = _load(path)
    label = fixture["label"]
    assert label is not None, "a fixture is labelled by a person before it is kept"

    result = _replayed(fixture)

    # The ladder asks again exactly when the model was asked again.
    assert len(result.attempts) == len(fixture["answers"])
    for attempt, answer, expected in zip(
        result.attempts, fixture["answers"], label["answers"], strict=True
    ):
        assert (attempt.report is not None) == expected["parses"], label["note"]
        if attempt.report is None:
            continue
        discarded = {item.position: item.reasons for item in attempt.report.discarded}
        assert sorted(discarded) == sorted(int(p) for p in expected["discarded"]), label["note"]
        for position, why in expected["discarded"].items():
            assert any(why in reason for reason in discarded[int(position)]), label["note"]
        kept = {item.position: item.depends_on for item in attempt.report.kept}
        written = json.loads(answer["raw"])["items"]
        for position, dropped in expected.get("dropped_dependencies", {}).items():
            # The model wrote them, and the validator kept the step without them.
            assert set(dropped) <= set(written[int(position)]["depends_on"]), label["note"]
            assert not set(dropped) & set(kept[int(position)]), label["note"]
    assert result.chosen == label["chosen"], label["note"]


@pytest.mark.parametrize("path", FIXTURES, ids=lambda path: path.stem)
def test_the_plan_kept_is_placed_where_a_plan_may_be(path: Path) -> None:
    fixture = _load(path)
    report = _replayed(fixture).report
    if report is None:
        pytest.skip("no plan was kept from this answer")
    context = fixture["context"]
    days = _days(context)
    now = datetime.fromisoformat(context["now"])
    zone = ZoneInfo(context["zone"])
    steps = [Step(item.position, item.minutes, item.depends_on) for item in report.kept]

    placements = schedule_this_week(
        steps, days, now=now, week_ends=week_end(now.astimezone(zone).date())
    )

    minutes = {step.key: step.minutes for step in steps}
    spans = {
        p.key: (p.start, p.start + timedelta(minutes=minutes[p.key]))
        for p in placements
        if p.start is not None
    }
    free = [span for day in days for span in day.free]
    for start, end in spans.values():
        assert start > now
        assert any(opens <= start and end <= closes for opens, closes in free)
    ordered = sorted(spans.values())
    assert all(a_end <= b_start for (_, a_end), (b_start, _) in pairwise(ordered))
    for step in steps:
        for prerequisite in step.after:
            if step.key in spans:
                assert prerequisite in spans
                assert spans[prerequisite][1] <= spans[step.key][0]
    for day in days:
        spent = sum(
            (end - start).total_seconds() // 60
            for start, end in spans.values()
            if start.astimezone(zone).date() == day.day
        )
        assert spent <= day.budget_minutes
