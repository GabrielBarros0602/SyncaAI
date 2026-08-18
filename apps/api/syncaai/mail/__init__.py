"""Outgoing mail.

One interface, several implementations, chosen by configuration. Tests never send, local
development never needs a network call or a key, and the code that composes a message does
not know which of those is happening.

See ADR-0018 for why this seam is worth more here than provider portability would be.
"""

import logging

from syncaai.mail.base import Mailer, Message
from syncaai.mail.console import ConsoleMailer
from syncaai.mail.recording import RecordingMailer

__all__ = ["ConsoleMailer", "Mailer", "Message", "RecordingMailer", "send_or_log"]

logger = logging.getLogger(__name__)


def send_or_log(mailer: Mailer, message: Message) -> None:
    """Send, and survive a provider that is having a bad day.

    ADR-0018 decided that a failed send must not fail the operation that triggered it:
    losing an account because a third party had an outage is worse than an account that has
    to ask for another mail. The user has a resend path; the outage has a log line.

    The address is logged as a digest rather than in the clear, so a log aggregator does not
    become a list of who uses this service.
    """
    try:
        mailer.send(message)
    except Exception:
        from syncaai.security.opaque import hash_token

        logger.exception(
            "mail could not be sent; recipient digest %s, subject %r",
            hash_token(message.to)[:12],
            message.subject,
        )
