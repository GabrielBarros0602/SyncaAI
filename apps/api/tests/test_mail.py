"""Tests for the mail seam.

Small, because the value of this code is that it lets other tests assert things. What is
worth pinning is that a message cannot be altered on its way out, that the console mailer
actually writes where a developer would look, and that the configured backend is the one
handed to the application.
"""

import logging

import pytest
from fastapi import FastAPI

from syncaai.api.dependencies import get_mailer
from syncaai.config import Settings
from syncaai.mail import ConsoleMailer, Message, RecordingMailer

A_MESSAGE = Message(to="gabriel@example.com", subject="Verify your address", text="Here: ...")


def test_a_message_cannot_be_altered_after_it_is_composed() -> None:
    """Frozen on purpose: a recording mailer is only evidence if nothing rewrites it."""
    with pytest.raises(AttributeError):
        A_MESSAGE.to = "somebody@example.com"  # type: ignore[misc]


def test_the_recording_mailer_keeps_what_it_was_given() -> None:
    mailer = RecordingMailer()

    mailer.send(A_MESSAGE)

    assert mailer.sent == [A_MESSAGE]


def test_messages_can_be_read_back_by_recipient() -> None:
    mailer = RecordingMailer()
    other = Message(to="someone@example.com", subject="Other", text="...")
    mailer.send(A_MESSAGE)
    mailer.send(other)

    assert mailer.to("gabriel@example.com") == [A_MESSAGE]
    assert mailer.to("nobody@example.com") == []


def test_clearing_forgets_everything() -> None:
    mailer = RecordingMailer()
    mailer.send(A_MESSAGE)

    mailer.clear()

    assert mailer.sent == []


def test_the_console_mailer_writes_the_recipient_subject_and_body(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A developer reading the terminal needs the link, so the body has to be there."""
    with caplog.at_level(logging.INFO, logger="syncaai.mail.console"):
        ConsoleMailer().send(A_MESSAGE)

    written = caplog.text
    assert A_MESSAGE.to in written
    assert A_MESSAGE.subject in written
    assert A_MESSAGE.text in written


def test_the_application_gets_the_configured_backend(app: FastAPI, settings: Settings) -> None:
    settings.mail_backend = "recording"

    assert isinstance(get_mailer(settings), RecordingMailer)


def test_the_default_backend_is_the_console_one(settings: Settings) -> None:
    assert isinstance(get_mailer(settings), ConsoleMailer)


def test_the_mailer_survives_between_requests(settings: Settings) -> None:
    """One instance per process. A rebuilt recorder would forget what it was recording."""
    settings.mail_backend = "recording"

    assert get_mailer(settings) is get_mailer(settings)
