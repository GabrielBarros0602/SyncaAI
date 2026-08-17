"""Tests for turning an access token into the request's user.

A probe route is mounted on the test application because no endpoint requires
authentication yet — the enforcement point had to exist before the endpoints that use it,
which is why the sprint order was changed.
"""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from syncaai.api.dependencies import CurrentUserId
from syncaai.config import Settings
from syncaai.security.tokens import create_access_token

PROBE = "/_probe_requires_authentication"


@pytest.fixture
def protected(app: FastAPI) -> FastAPI:
    @app.get(PROBE)
    def _probe(user_id: CurrentUserId) -> dict[str, str]:
        return {"user_id": str(user_id)}

    return app


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_a_valid_token_identifies_the_request(
    protected: FastAPI, client: TestClient, settings: Settings
) -> None:
    user_id = uuid.uuid4()

    response = client.get(PROBE, headers=_bearer(create_access_token(user_id, settings)))

    assert response.status_code == 200
    assert response.json()["user_id"] == str(user_id)


def test_no_authorization_header_answers_401(protected: FastAPI, client: TestClient) -> None:
    response = client.get(PROBE)

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_a_forged_token_answers_401(protected: FastAPI, client: TestClient) -> None:
    response = client.get(PROBE, headers=_bearer("not.a.real.token"))

    assert response.status_code == 401


def test_a_token_signed_with_another_secret_answers_401(
    protected: FastAPI, client: TestClient, settings: Settings
) -> None:
    other = settings.model_copy(update={"jwt_secret": "a-different-secret-long-enough-x"})

    response = client.get(PROBE, headers=_bearer(create_access_token(uuid.uuid4(), other)))

    assert response.status_code == 401


def test_a_wrong_scheme_answers_401(
    protected: FastAPI, client: TestClient, settings: Settings
) -> None:
    """Basic credentials are not bearer credentials, however well formed."""
    token = create_access_token(uuid.uuid4(), settings)

    response = client.get(PROBE, headers={"Authorization": f"Basic {token}"})

    assert response.status_code == 401


def test_every_rejection_answers_identically(
    protected: FastAPI, client: TestClient, settings: Settings
) -> None:
    """Absent, malformed and forged produce the same body, so none of them is a hint."""
    other = settings.model_copy(update={"jwt_secret": "a-different-secret-long-enough-x"})
    responses = [
        client.get(PROBE),
        client.get(PROBE, headers=_bearer("not.a.real.token")),
        client.get(PROBE, headers=_bearer(create_access_token(uuid.uuid4(), other))),
    ]

    assert {response.status_code for response in responses} == {401}
    assert len({response.text for response in responses}) == 1
