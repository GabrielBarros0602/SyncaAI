"""Version 1 of the product API.

Health probes are not here on purpose: they describe the process rather than the product,
and must not move when the API is versioned.
"""

from fastapi import APIRouter

from syncaai.api.routes import auth, capacity, tasks

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router)
router.include_router(tasks.router)
router.include_router(capacity.router)
