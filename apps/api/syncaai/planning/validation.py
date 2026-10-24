"""The second check: what each item means, not only its shape (ADR-0005, ADR-0030).

Native structured output guarantees syntax. A schema-valid response can still ask for a
step of -30 minutes, repeat a title, point a dependency at a step that comes later, or link
to ``javascript:``. Those are caught here, per item, so the ladder of ADR-0005 has something
to work with: the errors feed the one repair attempt, and after it a failed item is
discarded with its reasons while the rest of the plan stays.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from urllib.parse import urlsplit

from syncaai.planning.contract import (
    MAX_DESCRIPTION_CHARS,
    MAX_ITEM_MINUTES,
    MAX_LINK_LABEL_CHARS,
    MAX_TITLE_CHARS,
    MAX_URL_CHARS,
    MIN_ITEM_MINUTES,
    PlanItem,
    PlanResponse,
)


@dataclass(frozen=True)
class CheckedItem:
    """An item that passed, normalised: titles and labels stripped, dependencies on discarded
    items dropped."""

    position: int
    title: str
    description: str
    minutes: int
    #: Positions of kept prerequisites. A discarded prerequisite takes its constraint with
    #: it: the step is still worth doing, and there is nothing left to order it against.
    depends_on: tuple[int, ...]
    links: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class DiscardedItem:
    """An item that failed, kept so the review can say how many were dropped and why."""

    position: int
    title: str
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class PlanReport:
    kept: tuple[CheckedItem, ...]
    discarded: tuple[DiscardedItem, ...]

    @property
    def errors(self) -> list[str]:
        """Every reason, addressed the way the model addresses items: by zero-based
        position, the same numbers it used in ``depends_on``. This is what the one repair
        attempt sends back."""
        return [
            f"items[{item.position}]: {reason}"
            for item in self.discarded
            for reason in item.reasons
        ]


def check_plan(response: PlanResponse, *, max_item_minutes: int) -> PlanReport:
    """Check every item, in order. ``max_item_minutes`` is the person's preferred block
    (ADR-0032); it is held between the contract's own bounds whatever it says."""
    limit = max(MIN_ITEM_MINUTES, min(max_item_minutes, MAX_ITEM_MINUTES))
    kept: list[CheckedItem] = []
    discarded: list[DiscardedItem] = []
    titles_kept: set[str] = set()

    for position, item in enumerate(response.items):
        reasons = _reasons(item, position, limit, titles_kept)
        if reasons:
            discarded.append(DiscardedItem(position, item.title.strip(), tuple(reasons)))
            continue
        title = item.title.strip()
        titles_kept.add(_comparable(title))
        kept_positions = {checked.position for checked in kept}
        kept.append(
            CheckedItem(
                position=position,
                title=title,
                description=item.description.strip(),
                minutes=item.estimated_minutes,
                depends_on=tuple(p for p in _unique(item.depends_on) if p in kept_positions),
                links=tuple((link.label.strip(), link.url.strip()) for link in item.links),
            )
        )

    return PlanReport(tuple(kept), tuple(discarded))


def _reasons(item: PlanItem, position: int, limit: int, titles_kept: set[str]) -> list[str]:
    reasons: list[str] = []
    title = item.title.strip()

    if not title:
        reasons.append("the title is empty")
    elif len(title) > MAX_TITLE_CHARS:
        reasons.append(f"the title is longer than {MAX_TITLE_CHARS} characters")
    elif _comparable(title) in titles_kept:
        # Against the items kept so far, not every earlier one: if the first of two
        # identical titles was discarded for something else, the second is the one to keep.
        reasons.append("the title repeats an earlier step's")

    if len(item.description.strip()) > MAX_DESCRIPTION_CHARS:
        reasons.append(f"the description is longer than {MAX_DESCRIPTION_CHARS} characters")

    if not MIN_ITEM_MINUTES <= item.estimated_minutes <= limit:
        reasons.append(
            f"it takes {item.estimated_minutes} minutes, and a step has to take between "
            f"{MIN_ITEM_MINUTES} and {limit}"
        )

    for prerequisite in _unique(item.depends_on):
        if prerequisite == position:
            # Waiting for itself says nothing about order, and the step is still worth doing:
            # the dependency goes, the step stays (ADR-0049). The model did not correct it when
            # asked to, twice in the first golden batch.
            continue
        if not 0 <= prerequisite < position:
            # Only backwards, so the list's own order is a valid order and a cycle cannot
            # be written at all (ADR-0030).
            reasons.append(f"it depends on items[{prerequisite}], which does not come before it")

    for index, link in enumerate(item.links):
        label = link.label.strip()
        if not label:
            reasons.append(f"link {index}: the label is empty")
        elif len(label) > MAX_LINK_LABEL_CHARS:
            reasons.append(f"link {index}: the label is longer than {MAX_LINK_LABEL_CHARS}")
        if not _is_web_address(link.url.strip()):
            reasons.append(f"link {index}: the URL is not an absolute http or https address")

    return reasons


def _is_web_address(url: str) -> bool:
    """An absolute http or https URL with a host, short enough, and no whitespace.

    The scheme is the part that matters. Whatever lands in a note will be rendered as a
    link one day, and ``javascript:`` or ``data:`` there is a script, not a resource.
    """
    if not url or len(url) > MAX_URL_CHARS or any(char.isspace() for char in url):
        return False
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError:
        # urlsplit raises on a malformed bracketed host, which is an answer, not an error.
        return False
    return parts.scheme in {"http", "https"} and bool(host)


def _comparable(title: str) -> str:
    return " ".join(title.split()).casefold()


def _unique(positions: Sequence[int]) -> list[int]:
    return list(dict.fromkeys(positions))
