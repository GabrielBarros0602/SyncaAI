"""The AI worker, run as ``python -m syncaai.worker`` (ADR-0003, ADR-0031).

It listens on the queue's channel and, woken by a knock or by the five-second sweep,
whichever comes first, sweeps and then runs every ready job until the queue is empty. The
sweep covers what a knock cannot: a notification sent while the worker was restarting, a job
whose lock ran out, and a job queued too long.

On SIGTERM it finishes the job in hand and exits. A job it cannot finish in time is left to
its lock, which the visibility timeout already handles. Several workers can run at once:
``SKIP LOCKED`` is what makes that safe, and every one hears the same knock.
"""

import logging
import signal
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from types import FrameType

import psycopg
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from syncaai.config import get_settings
from syncaai.db import get_session_factory
from syncaai.main import configure_logging
from syncaai.planning.generator import PlanGenerator, SampleGenerator
from syncaai.services.ai_queue import CHANNEL, claim_next, sweep
from syncaai.services.plan_drafts import expire_drafts
from syncaai.services.plan_jobs import run_plan_job

# Named, not __name__: run as ``python -m`` the module is __main__, and the log would say so.
logger = logging.getLogger("syncaai.worker")

# How long the worker waits for a knock before sweeping anyway (ADR-0031).
SWEEP_INTERVAL_SECONDS = 5.0


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Worker:
    def __init__(
        self,
        factory: sessionmaker[Session],
        generator: PlanGenerator,
        *,
        listen_url: str,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._factory = factory
        self._generator = generator
        self._listen_url = listen_url
        self._clock = clock
        self._stopping = False

    def stop(self, _signal: int | None = None, _frame: FrameType | None = None) -> None:
        """Finish the job in hand, then leave. Shaped as a signal handler."""
        self._stopping = True

    def run(self) -> None:
        with psycopg.connect(self._listen_url, autocommit=True) as listener:
            listener.execute(f"LISTEN {CHANNEL}")
            while not self._stopping:
                self.tick()
                # A knock or the interval, whichever first; the knock carries nothing to read.
                for _ in listener.notifies(timeout=SWEEP_INTERVAL_SECONDS, stop_after=1):
                    pass

    def tick(self) -> int:
        """Sweep, then run every ready job; return how many were run."""
        self._sweep()
        ran = 0
        while not self._stopping:
            claimed = self._claim()
            if claimed is None:
                break
            job_id, attempt = claimed
            ran += 1
            try:
                outcome = run_plan_job(
                    self._factory, self._generator, job_id, attempt=attempt, clock=self._clock
                )
            except Exception:
                # Left to its lock: the next claim takes it back, with one attempt fewer, and
                # the sweep fails it once none are left (ADR-0031). The worker carries on.
                logger.exception("job %s, attempt %s: did not finish", job_id, attempt)
                continue
            logger.info("job %s, attempt %s: %s", job_id, attempt, outcome)
        return ran

    def _sweep(self) -> None:
        with self._factory() as session:
            failed = sweep(session)
            expired = expire_drafts(session)
            session.commit()
        if failed or expired:
            logger.info("sweep: %s jobs failed, %s drafts expired", len(failed), len(expired))

    def _claim(self) -> tuple[uuid.UUID, int] | None:
        # Committed at once, before any call to a model: a lock never spans a network call.
        with self._factory() as session:
            job = claim_next(session)
            if job is None:
                return None
            claimed = (job.id, job.attempts)
            session.commit()
            return claimed


def listen_url(database_url: str) -> str:
    """The same database, addressed for psycopg itself rather than through SQLAlchemy."""
    return make_url(database_url).set(drivername="postgresql").render_as_string(hide_password=False)


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    # The sample answer until S7 brings a real client; nothing here costs money (ADR-0003).
    worker = Worker(
        get_session_factory(), SampleGenerator(), listen_url=listen_url(settings.database_url)
    )
    signal.signal(signal.SIGTERM, worker.stop)
    signal.signal(signal.SIGINT, worker.stop)
    logger.info("worker listening on %s", CHANNEL)
    worker.run()
    logger.info("worker stopped")


if __name__ == "__main__":
    main()
