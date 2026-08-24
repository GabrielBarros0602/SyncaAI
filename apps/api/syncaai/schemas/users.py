"""What the application knows about the signed-in user."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


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
