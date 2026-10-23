"""The note a planned task carries, written by code (ADR-0030).

The model supplies validated fields — a description and labelled links — and this decides
the text. Nothing the model writes reaches the database except through those fields, so a
response cannot smuggle formatting, instructions or anything else into a person's notes.
"""

from collections.abc import Sequence

from syncaai.planning.validation import CheckedItem


def note_for(item: CheckedItem) -> str | None:
    """The description, then the links, one per line. None when there is neither.

    Bounded by construction: the contract's limits add up to well under the 4000
    characters a note may hold, which a test asserts rather than assumes.
    """
    return compose_note(item.description, item.links)


def compose_note(description: str, links: Sequence[tuple[str, str]]) -> str | None:
    """The same note from the fields a draft keeps, which is how a committed step gets one:
    the draft stores a description and links as they came, and only commit writes the text
    (ADR-0037)."""
    parts: list[str] = []
    if description:
        parts.append(description)
    if links:
        parts.append("Links\n" + "\n".join(f"- {label} — {url}" for label, url in links))
    return "\n\n".join(parts) or None
