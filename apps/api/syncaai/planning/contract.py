"""What the model is asked to return, and the first of the two checks it passes (ADR-0005).

The provider's JSON schema is generated from these models, so the shape the model is held
to and the shape this code parses are one definition, not two that drift.

This layer checks only what makes a response a plan at all: types, required fields and the
size of every array. Everything about an individual item — its minutes, its title, its
links — is the domain layer's (``validation.py``), so that one bad item is discarded with
its reasons instead of taking the whole response with it (ADR-0030).
"""

from pydantic import BaseModel, ConfigDict, Field

# The request's limits (ADR-0030). Conservative on purpose: twelve items is a review a
# person actually reads, and a bounded output is what lets S7 estimate the cost of a call
# before making it.
MAX_REQUEST_CHARS = 500
MIN_HORIZON_DAYS = 1
MAX_HORIZON_DAYS = 14
MAX_PLAN_ITEMS = 12
MAX_LINKS_PER_ITEM = 3

# Per item, enforced by the domain layer. The upper bound on minutes is the person's
# preferred block (ADR-0032), which can never be more than this.
MIN_ITEM_MINUTES = 15
MAX_ITEM_MINUTES = 240
MAX_TITLE_CHARS = 200
MAX_DESCRIPTION_CHARS = 500
MAX_LINK_LABEL_CHARS = 80
MAX_URL_CHARS = 500


class _Strict(BaseModel):
    # Unknown fields are refused rather than ignored, and the generated schema says so with
    # `additionalProperties: false`. A model that invents a field is not being creative in a
    # harmless way; it is drifting from the contract, and that should show.
    model_config = ConfigDict(extra="forbid")


class PlanLink(_Strict):
    """A resource for one step, as the model names it."""

    label: str = Field(description="A few words saying what the link is.")
    url: str = Field(description="An absolute http or https URL.")


class PlanItem(_Strict):
    """One step of the plan. It says what and how long, never when (ADR-0005).

    Every field is required, including the ones that may be empty. Strict structured output
    modes require it, and a field that may be absent is one more branch to get wrong.
    """

    title: str = Field(description="What to do, as a short task title.")
    description: str = Field(description="One or two sentences on how. Empty if obvious.")
    estimated_minutes: int = Field(description="How long this step takes, in minutes.")
    depends_on: list[int] = Field(
        max_length=MAX_PLAN_ITEMS,
        description="Zero-based positions of EARLIER items that must be done first.",
    )
    links: list[PlanLink] = Field(
        max_length=MAX_LINKS_PER_ITEM,
        description="Resources for this step. Empty if none are genuinely useful.",
    )


class PlanResponse(_Strict):
    """The whole answer: the steps, in the order they should be done."""

    items: list[PlanItem] = Field(min_length=1, max_length=MAX_PLAN_ITEMS)


def response_schema() -> dict[str, object]:
    """The JSON schema the provider is held to, generated from the models above."""
    return PlanResponse.model_json_schema()
