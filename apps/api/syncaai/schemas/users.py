"""What the application knows about the signed-in user."""

import uuid
from datetime import datetime, time

from pydantic import BaseModel, ConfigDict, field_validator


class MeRead(BaseModel):
    """The signed-in user, as the client needs them.

    ``timezone`` is the field with real work to do. Every local date the client sends to
    ``/capacity`` or ``/tasks`` is interpreted in the zone stored here, not in the
    browser's — and the two can differ, for a user who took the default at registration or
    for one who travelled. Without this, the client would compute "today" from the browser
    and receive an answer about a different day, quietly.

    ``password_hash`` is not absent by omission but by construction: this model declares
    what it carries, so a column added to ``users`` does not appear here by growing.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    timezone: str
    verified_at: datetime | None
    # The usable window, as wall-clock times in ``timezone`` (ADR-0029). The budget for a
    # given day comes from ``/capacity``, which is the only place that knows the day.
    day_starts_at: time
    day_ends_at: time


class MeUpdate(BaseModel):
    """A change to the account's own settings. The usable window only, for now.

    Either end may come alone. The service judges the window the request leaves behind,
    so moving one end is checked against the stored other (ADR-0029).
    """

    day_starts_at: time | None = None
    day_ends_at: time | None = None

    @field_validator("day_starts_at", "day_ends_at")
    @classmethod
    def a_wall_clock_minute(cls, value: time | None) -> time:
        """Refuse what a daily window cannot be.

        ``null``: neither end can be cleared, and absent already means "leave it". An offset:
        a time with one names an instant, and a window that repeats every day is not one.
        Seconds: the window is set and shown in minutes, and a stored 06:00:30 would make
        every figure derived from it a fraction nobody can see.
        """
        if value is None:
            message = "cannot be null; omit the field to leave it unchanged"
            raise ValueError(message)
        if value.tzinfo is not None:
            message = "is a time of day in the account's own zone, without an offset"
            raise ValueError(message)
        if value.second or value.microsecond:
            message = "is a whole minute, like 06:00"
            raise ValueError(message)
        return value
