"""A mailer that keeps messages instead of sending them."""

from syncaai.mail.base import Message


class RecordingMailer:
    """Collects what would have been sent.

    Used by tests, and usable for a local run where console output would be noise. It is the
    only way the enumeration guarantee can be asserted at all: registration answers
    identically whether or not the address exists (ADR-0019), so the *response* carries no
    evidence. The difference lives entirely in which message was produced, and this is what
    holds it.
    """

    def __init__(self) -> None:
        self.sent: list[Message] = []

    def send(self, message: Message) -> None:
        self.sent.append(message)

    def to(self, address: str) -> list[Message]:
        """Return the messages addressed to someone, oldest first."""
        return [message for message in self.sent if message.to == address]

    def clear(self) -> None:
        self.sent.clear()
