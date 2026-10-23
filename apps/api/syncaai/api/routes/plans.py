"""The plan endpoints (ADR-0003, ADR-0038).

A request goes to the queue and answers at once with its job; the job, once done, names its
plan; and everything a person does to a plan happens under the plan's own id.
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, status

from syncaai.api.dependencies import CurrentUserId, SessionDep
from syncaai.schemas.plans import JobRead, PlanItemRead, PlanItemUpdate, PlanRead, PlanRequest
from syncaai.services.plans import PlanService

router = APIRouter(tags=["plans"])


def get_plan_service(session: SessionDep, user_id: CurrentUserId) -> PlanService:
    return PlanService(session, user_id)


ServiceDep = Annotated[PlanService, Depends(get_plan_service)]


@router.post(
    "/ai/plans",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ask for a plan; it is made in the background",
)
def request_plan(payload: PlanRequest, service: ServiceDep, session: SessionDep) -> JobRead:
    job = service.request(payload.request, horizon_days=payload.horizon_days)
    # The commit is what delivers the worker's notification (ADR-0031).
    session.commit()
    return JobRead(job_id=job.id, status="queued")


@router.get("/ai/plans/{job_id}", summary="How a plan request is going")
def read_job(job_id: uuid.UUID, service: ServiceDep) -> JobRead:
    return service.job(job_id)


@router.get("/plans/{plan_id}", summary="Read a plan for review")
def read_plan(plan_id: uuid.UUID, service: ServiceDep) -> PlanRead:
    # One clock read, so every step's "passed" is measured against the same instant.
    return service.plan(plan_id, now=datetime.now(timezone.utc))


@router.patch("/plans/{plan_id}/items/{item_id}", summary="Rename, resize or move a step")
def update_item(
    plan_id: uuid.UUID,
    item_id: uuid.UUID,
    changes: PlanItemUpdate,
    service: ServiceDep,
    session: SessionDep,
) -> PlanItemRead:
    item = service.update_item(plan_id, item_id, changes, now=datetime.now(timezone.utc))
    session.commit()
    return item


@router.delete(
    "/plans/{plan_id}/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a step from the plan",
)
def remove_item(
    plan_id: uuid.UUID, item_id: uuid.UUID, service: ServiceDep, session: SessionDep
) -> None:
    service.remove_item(plan_id, item_id)
    session.commit()


@router.post(
    "/plans/{plan_id}/discard",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Set the plan aside",
)
def discard_plan(plan_id: uuid.UUID, service: ServiceDep, session: SessionDep) -> None:
    # A POST, not a DELETE: the plan stays thirty days before it goes (ADR-0037, ADR-0038).
    service.discard(plan_id)
    session.commit()
