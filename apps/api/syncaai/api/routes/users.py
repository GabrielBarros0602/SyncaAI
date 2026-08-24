"""Who the caller is."""

from fastapi import APIRouter

from syncaai.api.dependencies import CurrentUser
from syncaai.schemas.users import MeRead

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
