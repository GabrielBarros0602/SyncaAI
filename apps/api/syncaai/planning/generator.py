"""The one door to a model (ADR-0003, ADR-0035).

Everything that asks a provider for a plan goes through ``PlanGenerator``. The real client
arrives in S7; until then ``FakeGenerator`` stands in, so the ladder, the scheduler and the
review are built and tested against answers that cost nothing and never change.
"""

import json
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol

from syncaai.planning.context import PlanPrompt


@dataclass(frozen=True)
class Repair:
    """What the second call carries (ADR-0035)."""

    #: The first answer, verbatim, sent back as the model's own previous turn.
    previous: str
    #: The correction asked for, worded by ``build_repair_message``.
    message: str


@dataclass(frozen=True)
class Generation:
    """One answer, as it came back."""

    #: Exactly what the provider returned, before any parsing. Kept on the job (ADR-0031).
    raw: str
    model: str
    #: What ADR-0006 records for every call. The fake reports zeros; the fields are here so
    #: that S7 adds a client rather than changing this interface.
    input_tokens: int
    output_tokens: int


class PlanGenerator(Protocol):
    def generate(self, prompt: PlanPrompt, *, repair: Repair | None = None) -> Generation:
        """One call. ``repair`` turns it into the correction of a previous answer."""
        ...


class FakeGenerator:
    """Answers from a script, in order, and records every call it is asked to make.

    An unscripted call is an error rather than a default answer: a test that runs out of
    script has made a call it did not expect, and saying so is the point.
    """

    MODEL = "fake"

    def __init__(self, answers: Iterable[str]) -> None:
        self._answers = list(answers)
        self.calls: list[tuple[PlanPrompt, Repair | None]] = []

    def generate(self, prompt: PlanPrompt, *, repair: Repair | None = None) -> Generation:
        self.calls.append((prompt, repair))
        if len(self.calls) > len(self._answers):
            raise RuntimeError(f"call {len(self.calls)} was not scripted")
        return Generation(
            raw=self._answers[len(self.calls) - 1],
            model=self.MODEL,
            input_tokens=0,
            output_tokens=0,
        )


class SampleGenerator:
    """The same small plan for every request, for local development until S7 (ADR-0003).

    Three steps in a chain, each as long as the prompt's block allows, so a draft made on a
    developer's machine shows placement, a dependency and a link without a provider or a key.
    No test that asserts what a model would do uses it: those script their answers.
    """

    MODEL = "sample"

    # ``repair`` is the interface's; an answer that always passes is never asked to repair.
    def generate(self, prompt: PlanPrompt, *, repair: Repair | None = None) -> Generation:  # noqa: ARG002
        minutes = json.loads(prompt.message)["context"]["step_minutes"]["max"]
        steps = [
            ("Outline what the plan has to cover", [], []),
            ("Work through the first part", [0], []),
            (
                "Review what was done and close the gaps",
                [1],
                [{"label": "Example", "url": "https://example.com/"}],
            ),
        ]
        items = [
            {
                "title": title,
                "description": "",
                "estimated_minutes": minutes,
                "depends_on": depends_on,
                "links": links,
            }
            for title, depends_on, links in steps
        ]
        return Generation(
            raw=json.dumps({"items": items}),
            model=self.MODEL,
            input_tokens=0,
            output_tokens=0,
        )
