"""Two writes at once, against a real PostgreSQL (the audit of 2026-10-24, items 2 and 3).

Each test holds the first write open in one session, starts the second in a thread, waits
until PostgreSQL reports that thread blocked on a lock, and only then commits the first. That
is the interleaving the code has to survive, produced on purpose rather than hoped for.
"""

import threading
import time
import uuid
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from sqlalchemy import delete, text
from sqlalchemy.orm import Session

from syncaai.db import get_session_factory
from syncaai.models import User
from syncaai.repositories.tags import TagRepository

pytestmark = pytest.mark.integration


@pytest.fixture
def owner() -> Iterator[uuid.UUID]:
    with get_session_factory()() as session:
        user = User(email=f"races-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
        session.add(user)
        session.commit()
        user_id = user.id
    try:
        yield user_id
    finally:
        with get_session_factory()() as session:
            session.execute(delete(User).where(User.id == user_id))
            session.commit()


def _in_a_thread(
    work: Callable[[Session], object], session: Session
) -> tuple[threading.Thread, dict[str, Any]]:
    """Run ``work`` and commit it in a thread, keeping what it returned or raised."""
    outcome: dict[str, Any] = {}

    def run() -> None:
        try:
            outcome["value"] = work(session)
            session.commit()
        except Exception as error:  # reported by the test's assertion, never swallowed
            outcome["error"] = error
            session.rollback()

    thread = threading.Thread(target=run)
    thread.start()
    return thread, outcome


def _backend(session: Session) -> int:
    """The server process behind ``session``, read before any thread shares it."""
    pid = session.scalar(text("SELECT pg_backend_pid()"))
    assert isinstance(pid, int)
    return pid


def _until_blocked(pid: int) -> None:
    """Wait until the backend ``pid`` waits on a lock, so the commit that releases it comes
    after the second write has started, never before."""
    deadline = time.monotonic() + 10
    with get_session_factory()() as watcher:
        while time.monotonic() < deadline:
            waiting = watcher.scalar(
                text("SELECT wait_event_type FROM pg_stat_activity WHERE pid = :pid"),
                {"pid": pid},
            )
            watcher.rollback()
            if waiting == "Lock":
                return
            time.sleep(0.05)
    pytest.fail("the second write never waited for the first")


def test_two_tasks_naming_the_same_new_tag_at_once_share_it(owner: uuid.UUID) -> None:
    """Both find no tag and both insert it; the second waits for the first and then takes
    its row, where it used to fail on the unique constraint and answer 500."""
    factory = get_session_factory()
    with factory() as first, factory() as second:
        tag_id = TagRepository(first, owner).get_or_create("faculdade").id
        pid = _backend(second)

        thread, outcome = _in_a_thread(
            lambda session: TagRepository(session, owner).get_or_create("faculdade").id, second
        )
        _until_blocked(pid)
        first.commit()
        thread.join(timeout=10)

    assert outcome == {"value": tag_id}
