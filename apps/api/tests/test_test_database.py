"""Where the integration tests write (``conftest.py``)."""

import re
from pathlib import Path

from tests.conftest import _checkout_database


def test_two_checkouts_get_two_databases_and_one_checkout_always_the_same(tmp_path: Path) -> None:
    """A worktree and the main checkout ran the suite at the same moment, in the one database
    both used, and the queue tests of each run failed the other's."""
    here = _checkout_database(tmp_path / "main" / "apps" / "api")
    there = _checkout_database(tmp_path / "worktree" / "apps" / "api")

    assert here != there
    assert here == _checkout_database(tmp_path / "main" / "apps" / "api")
    # The guard every test database's name has to pass before anything is created.
    assert re.fullmatch(r"\w+_test", here)
