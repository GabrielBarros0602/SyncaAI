"""Plan payloads (ADR-0038)."""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from syncaai.planning.contract import MAX_HORIZON_DAYS, MAX_REQUEST_CHARS, MIN_HORIZON_DAYS

ItemState = Literal["placed", "passed", "no_room", "not_this_week", "after_unplaced"]


class PlanRequest(BaseModel):
    """What a person asks for. Stripped before it is measured, so a request of spaces is
    refused as empty rather than sent to a model as nothing."""

    request: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_REQUEST_CHARS)
    ]
    horizon_days: int = Field(default=MAX_HORIZON_DAYS, ge=MIN_HORIZON_DAYS, le=MAX_HORIZON_DAYS)


class JobRead(BaseModel):
    job_id: uuid.UUID
    status: Literal["queued", "running", "done", "failed"]
    #: A sentence for the person, once the job has failed.
    failure_reason: str | None = None
    #: The plan the job produced, once there is one (ADR-0038).
    plan_id: uuid.UUID | None = None


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
