"""Where each step of a plan goes: a real start, or a reason it has none (ADR-0005, ADR-0030).

The model decides what the steps are and how long each takes. It never decides when: it is
bad at arithmetic over constraints, and the database knows the answer exactly. This does it,
as a pure function over the day slots, so every placement can be explained line by line and
tested without a provider.

Greedy first fit, in list order, which is ADR-0005's v1 and the order the dependencies
already guarantee is valid. It packs the plan towards the first days rather than spreading
it; ADR-0030 asks for a measured reason before anything smarter.

A plan fills the current week first and on its own goes no further (ADR-0033): what does not
fit by Sunday waits for the person to send it to the days after.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from enum import StrEnum

from syncaai.planning.slots import DaySlots, Interval
from syncaai.time_windows import SECONDS_IN_A_MINUTE

# Starts land on five-minute marks: 14:20, not 14:17:42. Up to four minutes of a gap are
# given up per step for a plan a person reads as a plan.
GRID = timedelta(minutes=5)
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_TICK = timedelta(microseconds=1)


@dataclass(frozen=True)
class Step:
    """What the scheduler needs of a step, and nothing about what it is."""

    key: int
    minutes: int
    #: Keys of steps that must end before this one starts. Only earlier steps.
    after: tuple[int, ...] = ()


class Unplaced(StrEnum):
    """Why a step has no start, in the words a draft item stores (ADR-0033, ADR-0037)."""

    NO_ROOM = "no_room"
    NOT_THIS_WEEK = "not_this_week"
    AFTER_UNPLACED = "after_unplaced"


@dataclass(frozen=True)
class Placement:
    key: int
    start: datetime | None
    #: Why there is no start, as the draft stores it.
    unplaced: Unplaced | None = None
    #: The same, for the person reading the review: it says what to change.
    reason: str | None = None


@dataclass(frozen=True)
class Room:
    """What a day can take before anything is placed in it (ADR-0034)."""

    minutes: int
    #: The longest step that fits: one this long is placed on the day, one minute more is not.
    longest: int


@dataclass
class _Day:
    """A day's limits as they shrink while steps are placed."""

    free: list[Interval]
    budget: int


def schedule(
    steps: Sequence[Step],
    days: Sequence[DaySlots],
    *,
    now: datetime,
    placed: Mapping[int, datetime] | None = None,
) -> list[Placement]:
    """One placement per step, in the steps' order.

    Each step goes at the earliest start that is on a five-minute mark, after ``now``, after
    every placed prerequisite ends, and where it fits whole inside both of the day's limits.
    A step that fits nowhere, or whose prerequisite has no start, is left unplaced with its
    reason; the review can place it by hand (ADR-0030).

    ``placed`` gives the end of each step placed earlier and not being placed again, so a
    step sent to next week still waits for a prerequisite that stayed in this one. The days
    must already exclude the time those steps hold.
    """
    remaining = [_Day(list(day.free), day.budget_minutes) for day in days]
    ends: dict[int, datetime | None] = dict(placed or {})
    placements: list[Placement] = []

    for step in steps:
        prerequisite_ends = [ends.get(key) for key in step.after]
        if any(end is None for end in prerequisite_ends):
            ends[step.key] = None
            placements.append(
                Placement(
                    step.key,
                    None,
                    Unplaced.AFTER_UNPLACED,
                    "A step it depends on has no time yet. Place that first.",
                )
            )
            continue

        # Right after a prerequisite is fine: ranges are half-open, so back to back is not an
        # overlap.
        earliest = max([_earliest(now), *(e for e in prerequisite_ends if e is not None)])
        start = _place(step.minutes, earliest, remaining)
        if start is None:
            ends[step.key] = None
            placements.append(
                Placement(
                    step.key,
                    None,
                    Unplaced.NO_ROOM,
                    f"No free time in the plan's days holds {step.minutes} minutes in one piece.",
                )
            )
            continue

        ends[step.key] = start + timedelta(minutes=step.minutes)
        placements.append(Placement(step.key, start))

    return placements


def week_end(today: date) -> date:
    """The Sunday that ends the Monday-to-Sunday week holding ``today``: the week the screen
    opens on (ADR-0033)."""
    return today + timedelta(days=7 - today.isoweekday())


def schedule_this_week(
    steps: Sequence[Step],
    days: Sequence[DaySlots],
    *,
    now: datetime,
    week_ends: date,
    placed: Mapping[int, datetime] | None = None,
) -> list[Placement]:
    """Place on the days up to ``week_ends`` only, as a new plan is placed (ADR-0033).

    When the plan's days go on past that Sunday, what did not fit is marked as not fitting
    this week, so the draft can offer to send it on. A step waiting for one of those goes
    with it. When they do not, there is nowhere to send it, and the reason stays as it was.
    """
    placements = schedule(
        steps, [day for day in days if day.day <= week_ends], now=now, placed=placed
    )
    if not any(day.day > week_ends for day in days):
        return placements
    return [
        placement if placement.start is not None else _not_this_week(placement)
        for placement in placements
    ]


def schedule_next_week(
    steps: Sequence[Step],
    days: Sequence[DaySlots],
    *,
    now: datetime,
    week_ends: date,
    placed: Mapping[int, datetime],
) -> list[Placement]:
    """Place the steps a person sent on, over the days after ``week_ends`` (ADR-0033)."""
    later = [day for day in days if day.day > week_ends]
    return schedule(steps, later, now=now, placed=placed)


def _not_this_week(placement: Placement) -> Placement:
    reason = (
        "It does not fit before Sunday. It can go next week."
        if placement.unplaced is Unplaced.NO_ROOM
        else "A step it depends on goes next week, so this one does too."
    )
    return Placement(placement.key, None, Unplaced.NOT_THIS_WEEK, reason)


def room(day: DaySlots, *, now: datetime) -> Room:
    """The room the model is told a day has, measured the way ``schedule`` measures it.

    Each free piece counts from the first start a step could have in it, and both figures are
    capped by the day's budget. Computed here rather than beside the prompt so that the two
    cannot disagree about a day (ADR-0034).
    """
    earliest = _earliest(now)
    pieces = [
        int((closes - _on_grid(max(opens, earliest))).total_seconds()) // SECONDS_IN_A_MINUTE
        for opens, closes in day.free
    ]
    usable = [piece for piece in pieces if piece > 0]
    return Room(
        minutes=min(sum(usable), day.budget_minutes),
        longest=min(max(usable, default=0), day.budget_minutes),
    )


def _earliest(now: datetime) -> datetime:
    """Strictly after now, as a task's start has to be (ADR-0012): a now that sits exactly on a
    mark would otherwise round to itself."""
    return _on_grid(now + _TICK)


def _place(minutes: int, earliest: datetime, days: list[_Day]) -> datetime | None:
    length = timedelta(minutes=minutes)
    for day in days:
        # The budget binds even when the window has room: occupancy outside the window has
        # already spent part of it (ADR-0030).
        if day.budget < minutes:
            continue
        for index, (opens, closes) in enumerate(day.free):
            start = _on_grid(max(opens, earliest))
            if start + length > closes:
                continue
            # Carve the step out and keep both remainders: the gap before a rounded start
            # is small, but a later, shorter step may still be glad of the gap after it.
            day.free[index : index + 1] = [
                piece for piece in ((opens, start), (start + length, closes)) if piece[0] < piece[1]
            ]
            day.budget -= minutes
            return start
    return None


def _on_grid(moment: datetime) -> datetime:
    """Round up to the next five-minute mark, measured in UTC.

    The same marks in local time for every zone in use, whose offsets are all whole
    multiples of five minutes.
    """
    elapsed = moment - _EPOCH
    remainder = elapsed % GRID
    return moment if not remainder else moment + (GRID - remainder)
