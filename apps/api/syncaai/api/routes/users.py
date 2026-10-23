"""Who the caller is."""

from fastapi import APIRouter

from syncaai.api.dependencies import CurrentUser, SessionDep
from syncaai.schemas.users import MeRead, MeUpdate
from syncaai.services.users import change_usable_window

router = APIRouter(tags=["users"])


@router.get("/me", summary="The signed-in user")
def read_me(user: CurrentUser) -> MeRead:
    """Identity, separate from the session that proves it.

    Deliberately not folded into the login and refresh responses. A token is carried on
    every request and should stay small, and identity is a resource that will grow —
    ADR-0004 already names preferred block length, days off and working hours as things the
    planner needs. Those belong to a user, not to a session.
    """
    return MeRead.model_validate(user)


@router.patch("/me", summary="Change your own settings")
def update_me(payload: MeUpdate, user: CurrentUser, session: SessionDep) -> MeRead:
    """The usable window only, for now (ADR-0029). The working hours ADR-0004 named have
    arrived here, as the first preference the account sets for itself."""
    change_usable_window(user, payload)
    session.commit()
    return MeRead.model_validate(user)
