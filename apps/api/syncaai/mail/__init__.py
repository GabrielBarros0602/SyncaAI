"""Outgoing mail.

One interface, several implementations, chosen by configuration. Tests never send, local
development never needs a network call or a key, and the code that composes a message does
not know which of those is happening.

See ADR-0018 for why this seam is worth more here than provider portability would be.
"""

from syncaai.mail.base import Mailer, Message
from syncaai.mail.console import ConsoleMailer
from syncaai.mail.recording import RecordingMailer

__all__ = ["ConsoleMailer", "Mailer", "Message", "RecordingMailer"]
