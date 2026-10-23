"""Where each step of a plan goes: a real start, or a reason it has none (ADR-0005, ADR-0030).

The model decides what the steps are and how long each takes. It never decides when: it is
bad at arithmetic over constraints, and the database knows the answer exactly. This does it,
as a pure function over the day slots, so every placement can be explained line by line and
tested without a provider.

Greedy first fit, in list order, which is ADR-0005's v1 and the order the dependencies
already guarantee is valid. It packs the plan towards the first days rather than spreading
it; ADR-0030 asks for a measured reason before anything smarter.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

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


@dataclass(frozen=True)
class Placement:
    key: int
    start: datetime | None
    #: Why there is no start. A person reads it in the review, so it says what to change.
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


def schedule(steps: Sequence[Step], days: Sequence[DaySlots], *, now: datetime) -> list[Placement]:
    """One placement per step, in the steps' order.

    Each step goes at the earliest start that is on a five-minute mark, after ``now``, after
    every placed prerequisite ends, and where it fits whole inside both of the day's limits.
    A step that fits nowhere, or whose prerequisite has no start, is left unplaced with its
    reason; the review can place it by hand (ADR-0030).
    """
    remaining = [_Day(list(day.free), day.budget_minutes) for day in days]
    ends: dict[int, datetime | None] = {}
    placements: list[Placement] = []

    for step in steps:
        prerequisite_ends = [ends.get(key) for key in step.after]
        if any(end is None for end in prerequisite_ends):
            ends[step.key] = None
            placements.append(
                Placement(step.key, None, "A step it depends on has no time yet. Place that first.")
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
                    f"No free time in the plan's days holds {step.minutes} minutes in one piece.",
                )
            )
            continue

        ends[step.key] = start + timedelta(minutes=step.minutes)
        placements.append(Placement(step.key, start))

    return placements


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
