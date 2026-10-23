"""The contract the model fills, and the two checks it passes (ADR-0005, ADR-0030).

No provider and no database: the responses here are the fixtures, written to sit exactly on
each boundary the records name. Golden responses captured from a real provider arrive in S7
and will run through the same checks.
"""

from typing import Any

import pytest
from pydantic import ValidationError

from syncaai.planning.contract import (
    MAX_DESCRIPTION_CHARS,
    MAX_LINK_LABEL_CHARS,
    MAX_LINKS_PER_ITEM,
    MAX_PLAN_ITEMS,
    MAX_TITLE_CHARS,
    MAX_URL_CHARS,
    PlanResponse,
    response_schema,
)
from syncaai.planning.notes import note_for
from syncaai.planning.validation import PlanReport, check_plan
from syncaai.schemas.tasks import MAX_NOTES_LENGTH

A_BLOCK = 60


def _item(**overrides: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "title": "Read chapter 1",
        "description": "",
        "estimated_minutes": 45,
        "depends_on": [],
        "links": [],
    }
    item.update(overrides)
    return item


def _checked(*items: dict[str, Any], block: int = A_BLOCK) -> PlanReport:
    return check_plan(PlanResponse.model_validate({"items": list(items)}), max_item_minutes=block)


def _titled(*titles: str) -> list[dict[str, Any]]:
    return [_item(title=title) for title in titles]


def _objects(node: Any) -> list[dict[str, Any]]:
    """Every object definition in a schema, however deep."""
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        if node.get("type") == "object":
            found.append(node)
        for value in node.values():
            found.extend(_objects(value))
    elif isinstance(node, list):
        for value in node:
            found.extend(_objects(value))
    return found


def _arrays(node: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        if node.get("type") == "array":
            found.append(node)
        for value in node.values():
            found.extend(_arrays(value))
    elif isinstance(node, list):
        for value in node:
            found.extend(_arrays(value))
    return found


# --- Layer 1: the schema the provider is held to -------------------------------------------


def test_every_object_in_the_schema_is_closed_and_fully_required() -> None:
    """What strict structured output demands, and what keeps the model from adding a field
    of its own: no extra properties, and every property required."""
    objects = _objects(response_schema())

    assert len(objects) == 3
    for definition in objects:
        assert definition.get("additionalProperties") is False
        assert set(definition["required"]) == set(definition["properties"])


def test_every_array_in_the_schema_is_bounded() -> None:
    """ADR-0005: an explicit maxItems on every array. An unbounded one is an unbounded
    output, and an unbounded output is a cost nobody can estimate."""
    arrays = _arrays(response_schema())

    assert len(arrays) == 3
    assert all("maxItems" in array for array in arrays)


@pytest.mark.parametrize("count", [0, MAX_PLAN_ITEMS + 1])
def test_a_plan_outside_one_to_twelve_items_is_not_a_plan(count: int) -> None:
    with pytest.raises(ValidationError):
        PlanResponse.model_validate({"items": _titled(*(f"step {n}" for n in range(count)))})


def test_a_field_the_contract_does_not_have_is_refused() -> None:
    with pytest.raises(ValidationError):
        PlanResponse.model_validate({"items": [_item(day="2026-10-24")]})


def test_too_many_links_on_one_item_is_refused() -> None:
    links = [{"label": f"l{n}", "url": "https://a.example"} for n in range(MAX_LINKS_PER_ITEM + 1)]

    with pytest.raises(ValidationError):
        PlanResponse.model_validate({"items": [_item(links=links)]})


# --- Layer 2: each item, on its own --------------------------------------------------------


def test_a_clean_plan_is_kept_whole_and_normalised() -> None:
    report = _checked(
        _item(title="  Read chapter 1 ", description=" Skim first. "),
        _item(
            title="Do the exercises",
            depends_on=[0],
            links=[{"label": " Exercises ", "url": "https://book.example/ch1"}],
        ),
    )

    assert report.discarded == ()
    first, second = report.kept
    assert (first.title, first.description) == ("Read chapter 1", "Skim first.")
    assert second.depends_on == (0,)
    assert second.links == (("Exercises", "https://book.example/ch1"),)


@pytest.mark.parametrize(
    ("minutes", "kept"),
    [(14, False), (15, True), (A_BLOCK, True), (A_BLOCK + 1, False), (-30, False)],
)
def test_minutes_sit_between_fifteen_and_the_persons_block(minutes: int, kept: bool) -> None:
    """The block is the ceiling (ADR-0032), so a sixty-minute block refuses a 61-minute step."""
    report = _checked(_item(estimated_minutes=minutes))

    assert bool(report.kept) is kept


def test_a_block_past_four_hours_is_held_to_four_hours() -> None:
    """The contract's own ceiling holds whatever block arrives."""
    report = _checked(_item(estimated_minutes=241), block=300)

    assert report.kept == ()


@pytest.mark.parametrize("title", ["", "   ", "x" * (MAX_TITLE_CHARS + 1)])
def test_a_title_that_cannot_be_a_task_title_is_discarded(title: str) -> None:
    assert _checked(_item(title=title)).kept == ()


def test_a_repeated_title_is_discarded_ignoring_case_and_spacing() -> None:
    report = _checked(*_titled("Read chapter 1", "read  CHAPTER 1"))

    assert [item.position for item in report.kept] == [0]
    assert report.discarded[0].reasons == ("the title repeats an earlier step's",)


def test_a_title_repeating_a_discarded_one_is_kept() -> None:
    """The first was dropped for its minutes. Dropping the second for repeating it would
    lose the step entirely."""
    report = _checked(_item(estimated_minutes=5), _item())

    assert [item.position for item in report.kept] == [1]


def test_a_description_past_its_bound_is_discarded() -> None:
    assert _checked(_item(description="x" * (MAX_DESCRIPTION_CHARS + 1))).kept == ()


@pytest.mark.parametrize("prerequisite", [1, 2, -1])
def test_a_dependency_has_to_point_backwards(prerequisite: int) -> None:
    """Itself, a later step, or nothing at all. Only backwards keeps cycles unwritable."""
    report = _checked(_item(title="first"), _item(title="second", depends_on=[prerequisite]))

    assert [item.position for item in report.kept] == [0]


def test_a_repeated_dependency_is_read_once() -> None:
    report = _checked(_item(title="first"), _item(title="second", depends_on=[0, 0]))

    assert report.kept[1].depends_on == (0,)


def test_a_discarded_prerequisite_takes_its_constraint_with_it() -> None:
    """The dependent step stays: still worth doing, with nothing left to order against."""
    report = _checked(
        _item(title="first", estimated_minutes=5),
        _item(title="second", depends_on=[0]),
    )

    assert [(item.position, item.depends_on) for item in report.kept] == [(1, ())]


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html,hi",
        "ftp://files.example/x",
        "/relative/path",
        "https://",
        "https://a.example/with space",
        "https://[::1",
        "https://a.example/" + "x" * MAX_URL_CHARS,
    ],
)
def test_a_link_has_to_be_an_absolute_web_address(url: str) -> None:
    """The scheme is the part that matters: a note's link rendered one day as ``javascript:``
    is a script, not a resource."""
    assert _checked(_item(links=[{"label": "a resource", "url": url}])).kept == ()


@pytest.mark.parametrize("label", ["", "  ", "x" * (MAX_LINK_LABEL_CHARS + 1)])
def test_a_link_needs_a_label_a_person_can_read(label: str) -> None:
    assert _checked(_item(links=[{"label": label, "url": "https://a.example"}])).kept == ()


def test_the_errors_address_items_as_the_model_does() -> None:
    """Zero-based, the numbering the model used in depends_on, so the repair attempt reads
    the same language it wrote."""
    report = _checked(_item(title="first"), _item(title="second", estimated_minutes=600))

    assert report.errors == [
        "items[1]: it takes 600 minutes, and a step has to take between 15 and 60"
    ]


def test_every_reason_an_item_fails_is_reported_not_only_the_first() -> None:
    report = _checked(_item(title="", estimated_minutes=0))

    assert len(report.discarded[0].reasons) == 2


# --- The note ------------------------------------------------------------------------------


def test_the_note_is_the_description_then_the_links() -> None:
    report = _checked(
        _item(
            description="Skim first.",
            links=[
                {"label": "Chapter", "url": "https://book.example/1"},
                {"label": "Notes", "url": "https://notes.example"},
            ],
        )
    )

    assert note_for(report.kept[0]) == (
        "Skim first.\n\nLinks\n- Chapter — https://book.example/1\n- Notes — https://notes.example"
    )


def test_an_item_with_nothing_to_say_has_no_note() -> None:
    assert note_for(_checked(_item()).kept[0]) is None


def test_the_largest_note_the_contract_allows_fits_a_note() -> None:
    """Asserted, not assumed: every field at its bound still fits what a task's note holds."""
    longest_url = "https://a.example/" + "x" * (MAX_URL_CHARS - len("https://a.example/"))
    links = [{"label": "x" * MAX_LINK_LABEL_CHARS, "url": longest_url}] * MAX_LINKS_PER_ITEM
    report = _checked(_item(description="x" * MAX_DESCRIPTION_CHARS, links=links))

    note = note_for(report.kept[0])
    assert note is not None
    assert len(note) <= MAX_NOTES_LENGTH
