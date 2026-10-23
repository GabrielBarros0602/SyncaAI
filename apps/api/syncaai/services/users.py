"""Changes an account makes to itself."""

from syncaai.models import User
from syncaai.schemas.users import MeUpdate
from syncaai.services.capacity import UsableWindow


def change_usable_window(user: User, payload: MeUpdate) -> None:
    """Set the usable day, judging the window the request leaves behind (ADR-0029).

    Either end may arrive alone, so the pair is assembled from the request and the stored row
    before anything is checked. Checking each end on its own could not tell that moving the
    start past the stored end produces a window that ends before it starts.
    """
    window = UsableWindow(
        payload.day_starts_at if payload.day_starts_at is not None else user.day_starts_at,
        payload.day_ends_at if payload.day_ends_at is not None else user.day_ends_at,
    )
    window.check()
    user.day_starts_at = window.starts_at
    user.day_ends_at = window.ends_at
