"""The AI worker, run as ``python -m syncaai.worker`` (ADR-0003, ADR-0031).

It listens on the queue's channel and, woken by a knock or by the five-second sweep,
whichever comes first, sweeps and then runs every ready job until the queue is empty. The
sweep covers what a knock cannot: a notification sent while the worker was restarting, a job
whose lock ran out, and a job queued too long. Once an hour it also purges what is past its
margin (``services.purge``).

On SIGTERM it finishes the job in hand and exits. A job it cannot finish in time is left to
its lock, which the visibility timeout already handles. Several workers can run at once:
``SKIP LOCKED`` is what makes that safe, and every one hears the same knock.
"""

import logging
import signal
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from types import FrameType

import psycopg
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from syncaai.config import Settings, get_settings
from syncaai.db import get_session_factory
from syncaai.main import configure_logging
from syncaai.planning.generator import PlanGenerator, SampleGenerator
from syncaai.planning.ollama import OllamaGenerator
from syncaai.services.ai_breaker import seconds_until_probe
from syncaai.services.ai_queue import CHANNEL, claim_next, sweep
from syncaai.services.ai_spend import DEFAULT_CEILINGS, Ceilings, ceilings_from
from syncaai.services.plan_drafts import expire_drafts
from syncaai.services.plan_jobs import run_plan_job
from syncaai.services.purge import purge

# Named, not __name__: run as ``python -m`` the module is __main__, and the log would say so.
logger = logging.getLogger("syncaai.worker")

# How long the worker waits for a knock before sweeping anyway (ADR-0031).
SWEEP_INTERVAL_SECONDS = 5.0
# How often the same worker purges what is past its margin (ADR-0031).
PURGE_INTERVAL_SECONDS = 3600.0


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
        monotonic: Callable[[], float] = time.monotonic,
        ceilings: Ceilings = DEFAULT_CEILINGS,
    ) -> None:
        self._factory = factory
        self._generator = generator
        self._listen_url = listen_url
        self._clock = clock
        self._monotonic = monotonic
        self._ceilings = ceilings
        self._stopping = False
        self._purged_at: float | None = None

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
        self._purge_when_due()
        ran = 0
        while not self._stopping and not self._model_down():
            claimed = self._claim()
            if claimed is None:
                break
            job_id, attempt = claimed
            ran += 1
            try:
                outcome = run_plan_job(
                    self._factory,
                    self._generator,
                    job_id,
                    attempt=attempt,
                    clock=self._clock,
                    ceilings=self._ceilings,
                )
            except Exception:
                # Left to its lock: the next claim takes it back, with one attempt fewer, and
                # the sweep fails it once none are left (ADR-0031). The worker carries on.
                logger.exception("job %s, attempt %s: did not finish", job_id, attempt)
                continue
            logger.info("job %s, attempt %s: %s", job_id, attempt, outcome)
        return ran

    def _model_down(self) -> bool:
        """Whether the circuit breaker is open (ADR-0046). Asked before every claim, since
        the jobs of this very tick can be what opens it. Queued jobs wait meanwhile, and the
        sweep fails any that wait too long (ADR-0031)."""
        with self._factory() as session:
            wait = seconds_until_probe(session, self._generator.provider)
        if wait is None:
            return False
        logger.warning("model unavailable: claiming nothing for %.0f s", wait)
        return True

    def _sweep(self) -> None:
        with self._factory() as session:
            failed = sweep(session)
            expired = expire_drafts(session)
            session.commit()
        if failed or expired:
            logger.info("sweep: %s jobs failed, %s drafts expired", len(failed), len(expired))

    def _purge_when_due(self) -> None:
        """On the first tick, then once an hour. Every worker purges; the deletes are
        idempotent, so two doing it in the same hour cost a second pass over nothing."""
        started = self._monotonic()
        if self._purged_at is not None and started - self._purged_at < PURGE_INTERVAL_SECONDS:
            return
        with self._factory() as session:
            report = purge(session)
            session.commit()
        self._purged_at = started
        logger.info("purge: %s", report)

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


def generator_from(settings: Settings) -> PlanGenerator:
    """The model the settings name (ADR-0039). Neither costs money."""
    if settings.ai_provider == "ollama":
        assert settings.ollama_model is not None, "the settings refuse ollama without a model"
        return OllamaGenerator(base_url=settings.ollama_url, model=settings.ollama_model)
    return SampleGenerator()


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    worker = Worker(
        get_session_factory(),
        generator_from(settings),
        listen_url=listen_url(settings.database_url),
        ceilings=ceilings_from(settings),
    )
    signal.signal(signal.SIGTERM, worker.stop)
    signal.signal(signal.SIGINT, worker.stop)
    logger.info("worker listening on %s, answering with %s", CHANNEL, settings.ai_provider)
    worker.run()
    logger.info("worker stopped")


if __name__ == "__main__":
    main()
