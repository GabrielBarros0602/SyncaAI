"""Refresh tokens.

Opaque and random, unlike the access token, so that a session can be revoked by deleting a
row rather than by rotating a signing secret and logging everyone out (ADR-0015).

The primitives moved to ``syncaai.security.opaque`` when verification tokens turned out to
want exactly the same thing. These names are kept because they read better at the call
sites, where "refresh" is the point.
"""

from syncaai.security.opaque import TOKEN_HASH_LENGTH, generate_token, hash_token

__all__ = ["TOKEN_HASH_LENGTH", "generate_refresh_token", "hash_refresh_token"]

generate_refresh_token = generate_token
hash_refresh_token = hash_token
