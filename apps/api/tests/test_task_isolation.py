"""Threat 7, over HTTP, with two real accounts.

The repository suite already proves the owner filter is present in the statement, and that
PostgreSQL agrees. What it cannot prove is that the filter is reached — that every route
takes its owner from the token and never from the path, the body or a query string.

So nothing is faked here. Two accounts are created, both log in through the real endpoint,
and each then tries every way there is to touch the other's task. A single route that
forgot ``CurrentUserId``, or a service that trusted an id it was handed, fails this file
and passes everything else.
"""

import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete

from syncaai.api.dependencies import limit_login
from syncaai.db import get_session_factory
from syncaai.models import User
from syncaai.security.passwords import hash_password

pytestmark = pytest.mark.integration

TASKS = "/api/v1/tasks"
TAGS = "/api/v1/tags"
A_PASSWORD = "a-password-for-the-isolation-suite"


def _future(**offset: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(**offset)).isoformat()


@pytest.fixture
def accounts() -> Iterator[list[str]]:
    """Two verified accounts, removed afterwards along with everything they own.

    Committed rather than rolled back, because the application under test uses its own
    session and would not otherwise see them.
    """
    emails = [f"isolation-{uuid.uuid4()}@example.com" for _ in range(2)]
    # One hash, reused. argon2id is memory-hard on purpose (ADR-0014) and computing it per
    # account would put a second of pure key derivation into every run of this file.
    shared_hash = hash_password(A_PASSWORD)
    verified = datetime.now(timezone.utc)

    with get_session_factory()() as session:
        session.add_all(
            User(
                email=email,
                password_hash=shared_hash,
                timezone="America/Sao_Paulo",
                verified_at=verified,
            )
            for email in emails
        )
        session.commit()
    try:
        yield emails
    finally:
        with get_session_factory()() as session:
            session.execute(delete(User).where(User.email.in_(emails)))
            session.commit()


def _token(client: TestClient, email: str) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": A_PASSWORD})
    assert response.status_code == 200, response.text
    return str(response.json()["access_token"])


@pytest.fixture
def two_clients(
    app: FastAPI, client: TestClient, accounts: list[str]
) -> tuple[TestClient, TestClient]:
    """One client per account, each carrying its own real token."""
    # The limiter counts by client address, and both accounts share one here. Left in place
    # it would refuse the second login for reasons that have nothing to do with isolation.
    app.dependency_overrides[limit_login] = lambda: None

    first, second = (_token(client, email) for email in accounts)
    alice, bob = TestClient(app), TestClient(app)
    alice.headers["Authorization"] = f"Bearer {first}"
    bob.headers["Authorization"] = f"Bearer {second}"
    return alice, bob


def _schedule(client: TestClient, **overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "title": "alice's private task",
        "start_at": _future(days=1),
        "duration_minutes": 60,
        "notes": "something Bob should never read",
    }
    payload.update(overrides)
    response = client.post(TASKS, json=payload)
    assert response.status_code == 201, response.text
    return dict(response.json())


def test_a_stranger_reading_someone_elses_task_is_told_nothing(
    two_clients: tuple[TestClient, TestClient],
) -> None:
    """404, not 403. A 403 would confirm the id names something real (ADR-0016)."""
    alice, bob = two_clients
    task_id = _schedule(alice)["id"]

    response = bob.get(f"{TASKS}/{task_id}")

    assert response.status_code == 404
    assert "private" not in response.text


def test_a_real_id_and_an_invented_one_are_indistinguishable(
    two_clients: tuple[TestClient, TestClient],
) -> None:
    """Byte for byte. Any difference is an oracle for whether a task exists."""
    alice, bob = two_clients
    real = bob.get(f"{TASKS}/{_schedule(alice)['id']}")
    invented = bob.get(f"{TASKS}/{uuid.uuid4()}")

    assert real.status_code == invented.status_code
    assert real.json() == invented.json()


def test_a_stranger_cannot_change_someone_elses_task(
    two_clients: tuple[TestClient, TestClient],
) -> None:
    alice, bob = two_clients
    task_id = _schedule(alice)["id"]

    assert bob.patch(f"{TASKS}/{task_id}", json={"title": "owned"}).status_code == 404
    assert alice.get(f"{TASKS}/{task_id}").json()["title"] == "alice's private task"


def test_a_stranger_cannot_delete_someone_elses_task(
    two_clients: tuple[TestClient, TestClient],
) -> None:
    alice, bob = two_clients
    task_id = _schedule(alice)["id"]

    assert bob.delete(f"{TASKS}/{task_id}").status_code == 404
    assert alice.get(f"{TASKS}/{task_id}").status_code == 200


def test_a_listing_only_ever_contains_your_own_tasks(
    two_clients: tuple[TestClient, TestClient],
) -> None:
    alice, bob = two_clients
    mine = _schedule(alice)["id"]
    theirs = _schedule(bob, title="bob's task")["id"]

    assert [task["id"] for task in alice.get(TASKS).json()["items"]] == [mine]
    assert [task["id"] for task in bob.get(TASKS).json()["items"]] == [theirs]


def test_paging_past_your_own_rows_does_not_reach_anyone_elses(
    two_clients: tuple[TestClient, TestClient],
) -> None:
    """The obvious way to break a scoped listing is to walk off the end of it."""
    alice, bob = two_clients
    _schedule(alice)
    _schedule(bob, title="bob's task")

    assert bob.get(TASKS, params={"limit": 100, "offset": 1}).json()["items"] == []


def test_two_owners_can_hold_the_very_same_hour(
    two_clients: tuple[TestClient, TestClient],
) -> None:
    """The exclusion constraint is scoped by owner. If it were global, this would be a
    conflict — and one user's calendar would be able to block another's."""
    alice, bob = two_clients
    at_the_same_time = _future(days=2)

    _schedule(alice, start_at=at_the_same_time)
    response = bob.post(
        TASKS, json={"title": "bob", "start_at": at_the_same_time, "duration_minutes": 60}
    )

    assert response.status_code == 201


def test_the_same_owner_cannot_hold_an_hour_twice(
    two_clients: tuple[TestClient, TestClient],
) -> None:
    """The other half of the same claim, and the only place the real constraint fires."""
    alice, _ = two_clients
    start = _future(days=3)
    _schedule(alice, start_at=start, duration_minutes=60)

    overlapping = alice.post(
        TASKS,
        json={
            "title": "double booked",
            "start_at": _future(days=3, minutes=30),
            "duration_minutes": 60,
        },
    )

    assert overlapping.status_code == 409


def test_touching_ends_are_not_an_overlap(two_clients: tuple[TestClient, TestClient]) -> None:
    """A range half-open at the end, so 09:00-10:00 and 10:00-11:00 fit. If they did not,
    a full day could never be scheduled back to back."""
    alice, _ = two_clients
    _schedule(alice, start_at=_future(days=4), duration_minutes=60)

    adjacent = alice.post(
        TASKS,
        json={
            "title": "right after",
            "start_at": _future(days=4, minutes=60),
            "duration_minutes": 60,
        },
    )

    assert adjacent.status_code == 201


def test_a_tag_belongs_to_the_owner_who_used_it(
    two_clients: tuple[TestClient, TestClient],
) -> None:
    """Same spelling, two rows. A shared tag table would leak what other people work on."""
    alice, bob = two_clients
    _schedule(alice, tag="deep work")
    _schedule(bob, title="bob", tag="deep work")

    alice_tag = alice.get(TAGS).json()
    bob_tag = bob.get(TAGS).json()

    assert [tag["name"] for tag in alice_tag] == ["deep work"]
    assert [tag["name"] for tag in bob_tag] == ["deep work"]
    assert alice_tag[0]["id"] != bob_tag[0]["id"]


def test_a_token_that_names_nobody_is_refused(app: FastAPI) -> None:
    """The endpoints take the owner from a signature, so a forged one has to fail here."""
    with TestClient(app) as anonymous:
        anonymous.headers["Authorization"] = "Bearer not-a-real-token"

        assert anonymous.get(TASKS).status_code == 401
