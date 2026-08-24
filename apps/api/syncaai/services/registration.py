"""Opening an account, and proving the address behind it."""

from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from syncaai.config import Settings
from syncaai.errors import InvalidLinkTokenError
from syncaai.mail import Mailer, send_or_log
from syncaai.mail.messages import registration_attempted, verification_requested
from syncaai.models import User, VerificationToken
from syncaai.repositories.users import UserRepository
from syncaai.repositories.verification_tokens import VerificationTokenRepository
from syncaai.security.opaque import generate_token, hash_token
from syncaai.security.passwords import hash_password


class RegistrationService:
    def __init__(
        self,
        users: UserRepository,
        tokens: VerificationTokenRepository,
        mailer: Mailer,
        settings: Settings,
    ) -> None:
        self._users = users
        self._tokens = tokens
        self._mailer = mailer
        self._settings = settings

    def register(self, email: str, password: str, timezone_name: str) -> None:
        """Open an account, or tell the existing owner that somebody tried.

        Returns nothing in both cases, and the endpoint answers identically. Which of the
        two happened is visible only to whoever reads the address — which is the entire
        mechanism (ADR-0019).
        """
        existing = self._users.get_by_email(email)
        if existing is not None:
            send_or_log(self._mailer, registration_attempted(email))
            return

        user = User(email=email, password_hash=hash_password(password), timezone=timezone_name)
        self._users.add(user)
        self._send_verification(user)

    def resend(self, email: str) -> None:
        """Issue a fresh link, if there is an unverified account to issue it for.

        Silent otherwise, for the same reason registration is: answering differently would
        turn this into the oracle the sprint exists to remove.
        """
        user = self._users.get_by_email(email)
        if user is not None and user.verified_at is None:
            self._send_verification(user)

    def verify(self, raw_token: str) -> User:
        """Spend a token and mark its account confirmed.

        Unknown, expired and already spent raise the same error. A caller presenting a token
        learns whether it worked, and nothing else.
        """
        token = self._tokens.get_by_hash(hash_token(raw_token))
        now = datetime.now(timezone.utc)

        if token is None or token.used_at is not None or token.expires_at <= now:
            raise InvalidLinkTokenError

        token.used_at = now
        token.user.verified_at = now
        return token.user

    def _send_verification(self, user: User) -> None:
        raw = generate_token()
        self._tokens.add(
            VerificationToken(
                user_id=user.id,
                token_hash=hash_token(raw),
                expires_at=datetime.now(timezone.utc)
                + timedelta(hours=self._settings.verification_token_hours),
            )
        )
        query = urlencode({"token": raw})
        send_or_log(
            self._mailer,
            verification_requested(
                user.email, f"{self._settings.app_base_url.rstrip('/')}/verify?{query}"
            ),
        )
