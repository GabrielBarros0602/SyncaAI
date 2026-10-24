"""Plan payloads (ADR-0038)."""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator

from syncaai.models import MINUTES_IN_A_DAY
from syncaai.planning.contract import (
    MAX_DESCRIPTION_CHARS,
    MAX_HORIZON_DAYS,
    MAX_REQUEST_CHARS,
    MAX_TITLE_CHARS,
    MIN_HORIZON_DAYS,
)
from syncaai.schemas.tasks import reject_an_explicit_null, require_an_offset

ItemState = Literal["placed", "passed", "no_room", "not_this_week", "after_unplaced"]
JobStatus = Literal["queued", "running", "done", "failed"]


class PlanRequest(BaseModel):
    """What a person asks for. Stripped before it is measured, so a request of spaces is
    refused as empty rather than sent to a model as nothing."""

    request: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_REQUEST_CHARS)
    ]
    horizon_days: int = Field(default=MAX_HORIZON_DAYS, ge=MIN_HORIZON_DAYS, le=MAX_HORIZON_DAYS)


class JobRead(BaseModel):
    job_id: uuid.UUID
    status: JobStatus
    #: A sentence for the person, once the job has failed.
    failure_reason: str | None = None
    #: The plan the job produced, once there is one (ADR-0038).
    plan_id: uuid.UUID | None = None


class JobPage(BaseModel):
    """A slice of a person's plan requests, newest first, with no total, as tasks are paged
    (ADR-0020, ADR-0050)."""

    items: list[JobRead]
    limit: int
    offset: int


class PlanLinkRead(BaseModel):
    label: str
    url: str


class PlanItemRead(BaseModel):
    id: uuid.UUID
    position: int
    title: str
    description: str
    minutes: int
    start_at: datetime | None
    #: As stored, except that a placed step whose start has passed reads as passed.
    state: ItemState
    prerequisites: list[uuid.UUID]
    links: list[PlanLinkRead]


class PlanDiscardRead(BaseModel):
    position: int
    title: str
    reasons: list[str]


class PlanRead(BaseModel):
    id: uuid.UUID
    status: Literal["pending", "approved", "discarded", "expired"]
    request: str
    first_day: date
    last_day: date
    #: The Sunday a new plan fills up to on its own; what waits is offered the days after.
    week_ends_on: date
    items: list[PlanItemRead]
    discarded: list[PlanDiscardRead]


class PlanItemCreate(BaseModel):
    """A step a person adds to a plan, theirs or a model's (ADR-0047).

    No time: it is placed where the plan is placed again, at the earliest free time. Its
    minutes are a task's, as an edit's are (ADR-0032).
    """

    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TITLE_CHARS)
    ]
    minutes: int = Field(ge=1, le=MINUTES_IN_A_DAY)
    description: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=MAX_DESCRIPTION_CHARS)
    ] = ""


class PlanItemUpdate(BaseModel):
    """A partial change to one step (ADR-0030).

    None of the three can be cleared: a step always has a title and a length, and a step with
    no time is given one by setting its start. Its minutes are a task's, not the model's: the
    block bounds what the model proposes, never what the person edits (ADR-0032).
    """

    title: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TITLE_CHARS)
        ]
        | None
    ) = None
    minutes: int | None = Field(default=None, ge=1, le=MINUTES_IN_A_DAY)
    start_at: datetime | None = None

    @field_validator("title", "minutes", "start_at")
    @classmethod
    def refuse_a_null(cls, value: object) -> object:
        return reject_an_explicit_null(value)

    @field_validator("start_at")
    @classmethod
    def require_an_offset(cls, value: datetime) -> datetime:
        return require_an_offset(value)


class PlanCommitRead(BaseModel):
    """What a commit made: the tasks, in the plan's order. A repeat with the same key answers
    the plan's tasks as they are now (ADR-0030)."""

    plan_id: uuid.UUID
    task_ids: list[uuid.UUID]
