"""What happens to an answer that is not good enough (ADR-0005, ADR-0035).

Check it; if it is not a plan, or any of its steps fails, ask once for a correction; keep
whichever of the two answers kept more steps; and fail visibly when neither kept any. Every
attempt is returned, raw, with its errors, so the job can hold both (ADR-0031).
"""

from dataclasses import dataclass

from pydantic import ValidationError

from syncaai.planning.context import PlanPrompt, build_repair_message
from syncaai.planning.contract import PlanResponse
from syncaai.planning.generator import Generation, PlanGenerator, Repair
from syncaai.planning.validation import PlanReport, check_plan

# What the person reads when neither answer kept a step. The errors stay on the job, for
# whoever debugs it; this sentence is for whoever asked.
NO_USABLE_PLAN = "No usable step came back, even after one correction. Try again."


@dataclass(frozen=True)
class Attempt:
    generation: Generation
    #: None when the answer was not a plan at all.
    report: PlanReport | None
    #: The schema's errors, or the domain's: what a repair of this answer would carry.
    errors: tuple[str, ...]

    @property
    def kept(self) -> int:
        return 0 if self.report is None else len(self.report.kept)


@dataclass(frozen=True)
class LadderResult:
    #: One attempt, or two when a repair was asked for. Never more (ADR-0005).
    attempts: tuple[Attempt, ...]
    #: Which attempt the draft is built from; None when the job fails.
    chosen: int | None

    @property
    def report(self) -> PlanReport | None:
        if self.chosen is None:
            return None
        return self.attempts[self.chosen].report

    @property
    def failure(self) -> str | None:
        return NO_USABLE_PLAN if self.chosen is None else None


def run_ladder(
    generator: PlanGenerator, prompt: PlanPrompt, *, max_item_minutes: int
) -> LadderResult:
    """At most two calls: the answer, and one correction of it when anything failed."""
    first = _attempt(generator.generate(prompt), max_item_minutes)
    if first.report is not None and not first.report.discarded:
        return LadderResult((first,), chosen=0)

    repair = Repair(previous=first.generation.raw, message=build_repair_message(first.errors))
    second = _attempt(generator.generate(prompt, repair=repair), max_item_minutes)
    return LadderResult((first, second), chosen=_better(first, second))


def _attempt(generation: Generation, max_item_minutes: int) -> Attempt:
    try:
        response = PlanResponse.model_validate_json(generation.raw)
    except ValidationError as error:
        return Attempt(generation, None, tuple(_schema_errors(error)))
    report = check_plan(response, max_item_minutes=max_item_minutes)
    return Attempt(generation, report, tuple(report.errors))


def _better(first: Attempt, second: Attempt) -> int | None:
    """The attempt that kept more steps; a tie goes to the repair, which set out to correct
    the first. None when neither kept any."""
    if not first.kept and not second.kept:
        return None
    return 1 if second.kept >= first.kept else 0


def _schema_errors(error: ValidationError) -> list[str]:
    """Addressed the way the domain's errors are: ``items[3].estimated_minutes: ...``.

    Only the location and the message. Pydantic can also echo the input, and the input is
    whatever the model wrote, unbounded.
    """
    lines = []
    for detail in error.errors(include_input=False, include_url=False):
        path = "".join(
            f"[{part}]" if isinstance(part, int) else f".{part}" for part in detail["loc"]
        ).lstrip(".")
        lines.append(f"{path or 'the answer'}: {detail['msg']}")
    return lines
