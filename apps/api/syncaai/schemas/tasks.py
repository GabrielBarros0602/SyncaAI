"""Task payloads."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from syncaai.models import MINUTES_IN_A_DAY

MAX_CHECKLIST_ITEMS = 50
MAX_TAG_LENGTH = 50

# Every other free-text field here is bounded by the column behind it — a title is 200
# because `String(200)` is. `notes` is `Text`, so the schema is the only place a bound can
# exist, and until the screen offered a textarea nobody could write into it anyway.
#
# The reason it needs one is not storage. It is that ADR-0004 puts exactly one note in front
# of a paid provider: UC2 excludes notes entirely, and UC1 sends the invoked task's
# description. ADR-0006 estimates spend *before* the call, and an unbounded field makes the
# worst case of that estimate unbounded too.
#
# Four thousand characters is roughly a thousand tokens and about two pages of prose — past
# anything somebody writes on a calendar entry, and small enough that one note cannot be the
# thing that moves a prompt's cost. The number is a judgement; that there must be one is not.
MAX_NOTES_LENGTH = 4000


def _require_an_offset(value: datetime) -> datetime:
    """Refuse a naive timestamp.

    Accepting one would mean guessing which zone the caller meant, and a calendar that
    guesses is a calendar that is wrong twice a year (ADR-0009).
    """
    if value.tzinfo is None:
        message = "start_at must carry a UTC offset"
        raise ValueError(message)
    return value


def _reject_an_explicit_null(value: object) -> object:
    """Refuse ``null`` for a field that cannot be cleared.

    A validator does not run on a default, so this only fires when the client actually sent
    ``null``. That is the distinction PATCH needs: absent means "leave it", and null on a
    column that cannot be null is a mistake worth naming rather than ignoring in silence.
    """
    if value is None:
        message = "cannot be null; omit the field to leave it unchanged"
        raise ValueError(message)
    return value


def _normalise_tag(value: str | None) -> str | None:
    """One spelling per tag.

    ``Deep Work`` and ``deep work`` become the same row, which is the reason ADR-0020 chose
    a table over a free string — a string would have kept them apart forever.
    """
    if value is None:
        return None
    normalised = " ".join(value.split()).lower()
    return normalised or None


class ChecklistItemCreate(BaseModel):
    label: str = Field(min_length=1, max_length=200)


class ChecklistItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    position: int
    completed_at: datetime | None


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    start_at: datetime
    duration_minutes: int = Field(gt=0, le=MINUTES_IN_A_DAY)
    notes: str | None = Field(default=None, max_length=MAX_NOTES_LENGTH)
    tag: str | None = Field(default=None, max_length=MAX_TAG_LENGTH)
    items: list[ChecklistItemCreate] = Field(default_factory=list, max_length=MAX_CHECKLIST_ITEMS)

    @field_validator("tag")
    @classmethod
    def normalise_tag(cls, value: str | None) -> str | None:
        return _normalise_tag(value)

    @field_validator("start_at")
    @classmethod
    def require_an_offset(cls, value: datetime) -> datetime:
        return _require_an_offset(value)


class TaskUpdate(BaseModel):
    """A partial change.

    Every field is optional, and for the two nullable columns an explicit ``null`` is a real
    instruction — it clears them. The service tells the two apart through
    ``model_fields_set``; without that, a note could be written but never removed.
    """

    title: str | None = Field(default=None, min_length=1, max_length=200)
    start_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, gt=0, le=MINUTES_IN_A_DAY)
    notes: str | None = Field(default=None, max_length=MAX_NOTES_LENGTH)
    tag: str | None = Field(default=None, max_length=MAX_TAG_LENGTH)
    completed: bool | None = None

    @field_validator("title", "start_at", "duration_minutes", "completed")
    @classmethod
    def refuse_a_null(cls, value: object) -> object:
        return _reject_an_explicit_null(value)

    @field_validator("start_at")
    @classmethod
    def require_an_offset(cls, value: datetime) -> datetime:
        return _require_an_offset(value)

    @field_validator("tag")
    @classmethod
    def normalise_tag(cls, value: str | None) -> str | None:
        return _normalise_tag(value)


class TagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    notes: str | None
    start_at: datetime
    end_at: datetime
    duration_minutes: int
    completed_at: datetime | None
    tag: TagRead | None
    items: list[ChecklistItemRead]


class Page(BaseModel):
    """A slice of a listing.

    ``total`` is deliberately absent. Counting every row a user owns to render one page is
    work nobody asked for, and offset pagination does not need it (ADR-0020).
    """

    items: list[TaskRead]
    limit: int
    offset: int


class DayCapacityRead(BaseModel):
    """One day's aggregate.

    No task appears here. ADR-0004 sends the provider capacity and never content, and the
    cheapest way to keep that true is for the shape carrying it to have nowhere to put a
    title.
    """

    model_config = ConfigDict(from_attributes=True)

    day: date
    weekday: int
    #: The real length of the local day. Drives the geometry, and is the reason a
    #: daylight-saving day still looks different from its neighbours.
    total_minutes: int
    #: What the day actually offers. Every figure below is measured against this.
    usable_minutes: int
    occupied_minutes: int
    free_minutes: int
    #: What is left of the whole day, which is what the heaviest two messages report. Against
    #: the budget it would read zero at every level that shows it.
    unbooked_minutes: int
    task_count: int
    over_capacity: bool
    load: Literal["fine", "heavy", "strained", "unsustainable"]
