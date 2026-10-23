"""The plan endpoints (ADR-0003, ADR-0038).

A request goes to the queue and answers at once with its job; the job, once done, names its
plan; and everything a person does to a plan happens under the plan's own id.
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, status

from syncaai.api.dependencies import CurrentUserId, SessionDep
from syncaai.schemas.plans import JobRead, PlanRead, PlanRequest
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
