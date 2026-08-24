"""Setting a new password without knowing the old one."""

from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from syncaai.config import Settings
from syncaai.errors import InvalidLinkTokenError
from syncaai.mail import Mailer, send_or_log
from syncaai.mail.messages import password_reset_requested
from syncaai.models import PasswordResetToken
from syncaai.repositories.password_reset_tokens import PasswordResetTokenRepository
from syncaai.repositories.refresh_tokens import RefreshTokenRepository
from syncaai.repositories.users import UserRepository
from syncaai.security.opaque import generate_token, hash_token
from syncaai.security.passwords import hash_password


class PasswordResetService:
    """Five collaborators, because the flow genuinely touches five things.

    Splitting it would mean two services coordinating on one transaction, which is worse
    than a wide constructor for a flow this linear.
    """

    def __init__(
        self,
        users: UserRepository,
        tokens: PasswordResetTokenRepository,
        sessions: RefreshTokenRepository,
        mailer: Mailer,
        settings: Settings,
    ) -> None:
        self._users = users
        self._tokens = tokens
        self._sessions = sessions
        self._mailer = mailer
        self._settings = settings

    def request(self, email: str) -> None:
        """Issue a reset link, if there is an account to issue it for.

        Silent otherwise, and the endpoint answers identically either way — a specific
        answer here would restore the oracle the whole sprint removed.

        Nothing is sent to an address with no account. That is not only about disclosure:
        mailing an address that never signed up would turn this endpoint into a way to put
        mail in a stranger's inbox on demand.
        """
        user = self._users.get_by_email(email)
        if user is None or user.verified_at is None:
            return

        raw = generate_token()
        self._tokens.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_token(raw),
                expires_at=datetime.now(timezone.utc)
                + timedelta(hours=self._settings.password_reset_token_hours),
            )
        )
        query = urlencode({"token": raw})
        send_or_log(
            self._mailer,
            password_reset_requested(
                user.email, f"{self._settings.app_base_url.rstrip('/')}/reset?{query}"
            ),
        )

    def reset(self, raw_token: str, new_password: str) -> None:
        """Spend a token, set the password, and end every open session.

        Ending sessions is the part that is easy to leave out and makes the rest pointless:
        whoever knew the old password would otherwise keep a live session for up to thirty
        days, and the reset would have secured nothing.
        """
        token = self._tokens.get_by_hash(hash_token(raw_token))
        now = datetime.now(timezone.utc)

        if token is None or token.used_at is not None or token.expires_at <= now:
            raise InvalidLinkTokenError

        token.used_at = now
        token.user.password_hash = hash_password(new_password)
        self._sessions.revoke_all_for(token.user_id)
