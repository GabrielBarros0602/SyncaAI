"""Liveness and readiness probes.

Two endpoints, deliberately. An orchestrator *restarts* a container when liveness
fails, and merely *stops routing traffic* to it when readiness fails. Collapsing both
into one endpoint that queries the database means a transient Postgres blip restarts
the application for no reason.

This is the degradation principle from ADR-0006 at its smallest scale: a failing
dependency should not take down what still works.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from syncaai.db import get_session

router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness probe")
def liveness() -> dict[str, str]:
    """Report that the process is running.

    Declares no dependencies on purpose: this must answer while the database is down.
    """
    return {"status": "alive"}


@router.get("/health/ready", summary="Readiness probe")
def readiness(
    response: Response,
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    """Report whether the service can serve traffic.

    Returns 503 rather than 500 when the database is unreachable: the service is
    temporarily unable to serve, which is what a load balancer needs to hear, and it
    is not an internal error in the request itself.

    Creating a session does not open a connection — SQLAlchemy connects lazily — so
    the failure surfaces on ``execute``, which is why the guard is here and not around
    the dependency.
    """
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unavailable", "database": "unreachable"}
    return {"status": "ready", "database": "reachable"}
