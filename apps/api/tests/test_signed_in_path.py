"""The signed-in path, end to end, with nothing between the request and PostgreSQL.

Every other test of this flow substitutes something. The endpoint tests replace the
repositories and the session, so a route and its repository can drift apart and both keep
passing. The service tests replace the mailer. Each proves its own piece, and none of them
proves the pieces fit: a token the real ``VerificationTokenRepository`` cannot find, a
``used_at`` that never reaches disk because a route forgot to commit, a cookie the browser
is set but never gets to send back. Those live only in the seams.

So here the only doubles are the two rate limiters, and the reason is in ``_without_rate_limits``.
Repositories, services, sessions, argon2, the JWT and the cookie are all the real ones.

This is also the only integration test in the suite that cannot roll back. The endpoints
commit — that is the behaviour under test — so the account is deleted in teardown instead,
and every row hanging off it goes with it through ``ON DELETE CASCADE``.
"""

import uuid
from collections.abc import Iterator
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete

from syncaai.api.dependencies import get_mailer, limit_login, limit_registration
from syncaai.config import Settings
from syncaai.db import get_session_factory
from syncaai.mail import RecordingMailer
from syncaai.models import User
from syncaai.security.tokens import decode_access_token

pytestmark = pytest.mark.integration

REGISTER = "/api/v1/auth/register"
VERIFY = "/api/v1/auth/verify"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
ME = "/api/v1/me"
COOKIE = "syncaai_refresh"

A_PASSWORD = "a decent password"


@pytest.fixture
def address() -> Iterator[str]:
    """An address nothing else has used, removed when the test ends.

    Fresh per test rather than fixed, because these rows are committed: a fixed address
    would collide with whatever the previous run left behind if a teardown ever failed to
    reach the database, and the failure would land on the next run rather than the one that
    caused it.
    """
    email = f"probe-{uuid.uuid4()}@example.com"
    yield email

    with get_session_factory()() as session:
        session.execute(delete(User).where(User.email == email))
        session.commit()


def _without_rate_limits(app: FastAPI) -> None:
    """Substitute the two limiters this path crosses.

    They are the one thing here that cannot be real. The counters are rows in this same
    database, keyed by the caller's address and bucketed by the hour, so they outlive the
    test that created them: registration is capped at five per hour, and the sixth run of
    the suite within an hour would fail on a rule this test is not about. The counting
    itself is asserted against the same database in ``test_rate_limiting``.
    """
    app.dependency_overrides[limit_registration] = lambda: None
    app.dependency_overrides[limit_login] = lambda: None


def _recording_mailer(settings: Settings) -> RecordingMailer:
    """Point the real dependency at the implementation that keeps what it is given.

    A ``mail_backend`` change rather than a dependency override, so ``get_mailer`` stays in
    the path: choosing the mailer by configuration is what the application does, and an
    override here would be the one seam this test exists to stop skipping.
    """
    settings.mail_backend = "recording"
    mailer = get_mailer(settings)
    # Narrows the Mailer protocol to the implementation that can be read back, and fails
    # loudly rather than at an attribute error if that wiring ever changes.
    assert isinstance(mailer, RecordingMailer)
    return mailer


def _confirmation_token(mailer: RecordingMailer, address: str) -> str:
    """Take the token out of the most recent message, the way the browser does.

    Parsed as a URL rather than sliced out of the text: what the mail has to carry is a
    usable link, and a slice would go on passing if the query string changed shape. The
    mailer is process-wide, so the messages are filtered to this test's address.
    """
    message = mailer.to(address)[-1]
    link = next(line for line in message.text.splitlines() if line.startswith("http"))
    return parse_qs(urlparse(link).query)["token"][0]


def _register(client: TestClient, address: str) -> None:
    assert client.post(REGISTER, json={"email": address, "password": A_PASSWORD}).status_code == 202


def test_the_signed_in_path_works_end_to_end(
    app: FastAPI, client: TestClient, settings: Settings, address: str
) -> None:
    """Register, confirm, sign in as a browser, renew from the cookie alone, and ask who you are.

    Nothing is arranged between the steps: each one's input is the previous one's output.
    The token comes out of the message the service actually produced, and the cookie out of
    the response a browser would actually have received.
    """
    _without_rate_limits(app)
    mailer = _recording_mailer(settings)

    _register(client, address)

    assert (
        client.post(VERIFY, json={"token": _confirmation_token(mailer, address)}).status_code == 204
    )

    signed_in = client.post(LOGIN, json={"email": address, "password": A_PASSWORD})
    assert signed_in.status_code == 200
    # ADR-0017 makes the two channels exclusive, so there is no body token for the renewal
    # below to fall back on. That is what makes the next step a test of the cookie.
    assert signed_in.json()["refresh_token"] is None
    assert COOKIE in client.cookies

    renewed = client.post(REFRESH, json={})
    assert renewed.status_code == 200

    access_token = renewed.json()["access_token"]
    # The cookie is scoped to /api/v1/auth, so it is not sent here at all. This request
    # carries the access token and nothing else, which is the whole point of the split.
    me = client.get(ME, headers={"Authorization": f"Bearer {access_token}"})

    assert me.status_code == 200
    assert me.json()["email"] == address
    assert me.json()["verified_at"] is not None
    assert decode_access_token(access_token, settings) == uuid.UUID(me.json()["id"])


def test_only_the_cookie_carries_the_browser_session(
    app: FastAPI, client: TestClient, settings: Settings, address: str
) -> None:
    """Guards the renewal above, which would pass just as well on something else.

    A test client quietly carrying a second credential — a header, a body field left over
    from an earlier call — would keep that step green while the browser path was broken.
    Taking the cookie away is what makes the difference observable, and the assertion before
    it is what says there was nothing else in the jar to begin with.
    """
    _without_rate_limits(app)
    mailer = _recording_mailer(settings)
    _register(client, address)
    client.post(VERIFY, json={"token": _confirmation_token(mailer, address)})
    client.post(LOGIN, json={"email": address, "password": A_PASSWORD})

    assert set(client.cookies.keys()) == {COOKIE}
    client.cookies.clear()

    assert client.post(REFRESH, json={}).status_code == 401


def test_signing_in_is_refused_until_the_address_is_confirmed(
    app: FastAPI, client: TestClient, settings: Settings, address: str
) -> None:
    """The confirmation step has to be load-bearing, not decorative.

    The endpoint test for this runs against a fake user whose ``verified_at`` was set by
    hand in the fixture. Here the column starts null because registration left it null, and
    changes because the verify endpoint wrote it through the real repository — which is the
    part that can actually be wrong.
    """
    _without_rate_limits(app)
    mailer = _recording_mailer(settings)
    _register(client, address)

    refused = client.post(LOGIN, json={"email": address, "password": A_PASSWORD})

    assert refused.status_code == 403
    assert refused.json()["detail"] == "Confirm your address before signing in."

    client.post(VERIFY, json={"token": _confirmation_token(mailer, address)})

    assert client.post(LOGIN, json={"email": address, "password": A_PASSWORD}).status_code == 200


def test_a_confirmation_token_cannot_be_spent_twice(
    app: FastAPI, client: TestClient, settings: Settings, address: str
) -> None:
    """``used_at`` has to survive the request that set it.

    Against a fake repository this passes for free: the second call reads the same object
    the first one mutated, still in memory. Here the second call is a new session reading a
    committed row, so it fails only if the write actually landed — which makes this the one
    version of the claim that would catch a route that forgot to commit.
    """
    _without_rate_limits(app)
    mailer = _recording_mailer(settings)
    _register(client, address)
    token = _confirmation_token(mailer, address)

    assert client.post(VERIFY, json={"token": token}).status_code == 204

    spent_again = client.post(VERIFY, json={"token": token})

    assert spent_again.status_code == 400
    assert spent_again.json()["detail"] == "That confirmation link is not valid. Request a new one."
