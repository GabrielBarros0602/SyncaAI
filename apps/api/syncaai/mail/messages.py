"""The messages this application sends.

Kept together so the pair that closes the enumeration leak can be read side by side. They
go to different people in different situations and must be equally plausible: whichever one
is sent, the *response* the caller saw was identical (ADR-0019).
"""

from syncaai.mail.base import Message


def verification_requested(to: str, verify_url: str) -> Message:
    """Sent when an address that had no account has just been registered."""
    return Message(
        to=to,
        subject="Confirm your address for SyncaAI",
        text=(
            "Someone created a SyncaAI account with this address.\n\n"
            f"Confirm it here:\n{verify_url}\n\n"
            "The link works once and expires in 24 hours.\n\n"
            "If this was not you, ignore this message. The account cannot be used until "
            "the address is confirmed."
        ),
    )


def registration_attempted(to: str) -> Message:
    """Sent when someone tries to register an address that already has an account.

    Not padding. Its recipient has just learned that somebody is probing their address,
    which is information they are entitled to and an attacker cannot see — the caller who
    triggered this got the same response either way.
    """
    return Message(
        to=to,
        subject="Someone tried to register with your address",
        text=(
            "Someone tried to create a SyncaAI account with this address, but it already "
            "has one.\n\n"
            "If it was you, sign in instead. If it was not, nothing has happened to your "
            "account — but somebody knows or guessed your address, which is worth knowing.\n\n"
            "No action is needed."
        ),
    )


def password_reset_requested(to: str, reset_url: str) -> Message:
    """Sent when a reset was asked for on an address that has an account.

    Nothing is sent when the address has no account. That is not only about not confirming
    which addresses exist — sending anyway would let anyone use this service to put mail in
    a stranger's inbox, which is a different and worse problem.
    """
    return Message(
        to=to,
        subject="Reset your SyncaAI password",
        text=(
            "Someone asked to reset the password for this address.\n\n"
            f"Set a new one here:\n{reset_url}\n\n"
            "The link works once and expires in an hour. Using it signs out every device "
            "currently signed in.\n\n"
            "If this was not you, nothing has changed and you can ignore this message."
        ),
    )
