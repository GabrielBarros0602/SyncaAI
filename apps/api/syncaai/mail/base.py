"""What a message is, and what any mailer must do with one."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Message:
    """A message ready to send.

    Plain text only. Transactional mail is usually sent as HTML, and that can be added when
    there is a template worth rendering — carrying an unused ``html`` field now would be the
    same kind of lie as a configuration value nothing reads.

    Frozen because a message is a record of what was composed. A mailer that could alter it
    on the way out would make the recording implementation useless as evidence.
    """

    to: str
    subject: str
    text: str


class Mailer(Protocol):
    """Anything that can take a message off our hands.

    A protocol rather than a base class: an implementation does not need to know this exists
    to satisfy it, which keeps a test double from inheriting behaviour it did not ask for.
    """

    def send(self, message: Message) -> None:
        """Deliver the message, or raise if it certainly was not delivered.

        Returning normally is not a promise that the message arrives — no mailer can promise
        that. It means the message was handed on successfully, which is the only thing a
        caller can act upon.
        """
        ...
