"""A mailer that writes to the log instead of sending."""

import logging

from syncaai.mail.base import Message

logger = logging.getLogger(__name__)


class ConsoleMailer:
    """Prints the message where a developer will see it.

    This is what makes local development work without a provider account: a verification
    link is one copy away in the terminal. It is deliberately readable rather than
    structured, because the person reading it is a human looking for a URL.
    """

    def send(self, message: Message) -> None:
        logger.info(
            "\n--- mail ---\nto: %s\nsubject: %s\n\n%s\n--- end ---",
            message.to,
            message.subject,
            message.text,
        )
