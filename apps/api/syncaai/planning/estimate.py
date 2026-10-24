"""The most a call can cost, before it is made (ADR-0006, ADR-0044).

A bound, not a count: it over-counts on purpose, because a ceiling that counts a little more
refuses a little early and one that counts less does not refuse at all. A provider's own count
can replace the input half with the paid client.
"""

import json
from decimal import Decimal

from syncaai.planning.context import PlanPrompt
from syncaai.planning.contract import MAX_ANSWER_TOKENS, response_schema
from syncaai.planning.generator import Repair
from syncaai.planning.prices import FREE_PROVIDERS, cost_of

# Text the code writes measured about three characters a token on qwen3.5 (ADR-0040); two
# leaves room for a tokenizer that does worse.
CHARACTERS_PER_TOKEN = 2


def input_token_bound(prompt: PlanPrompt, repair: Repair | None = None) -> int:
    """At most how many tokens a call sends.

    The instructions, the schema, the message around the request and a correction are the
    code's, counted at ``CHARACTERS_PER_TOKEN``. The request and a first answer sent back are
    a person's and a model's, in any script, so they are counted by their bytes: a byte-level
    tokenizer never spends more than a token on one.
    """
    request = json.loads(prompt.message)["request"]
    written = len(prompt.instructions) + len(json.dumps(response_schema()))
    written += len(prompt.message) - len(request)
    authored = len(request.encode())
    if repair is not None:
        written += len(repair.message)
        authored += len(repair.previous.encode())
    return -(-written // CHARACTERS_PER_TOKEN) + authored


def estimate_cost(
    provider: str, model: str, prompt: PlanPrompt, repair: Repair | None = None
) -> Decimal:
    """The most this call can cost: its bound in, its cap out, at the model's price."""
    if provider in FREE_PROVIDERS:
        return Decimal(0)
    return cost_of(
        provider,
        model,
        input_tokens=input_token_bound(prompt, repair),
        output_tokens=MAX_ANSWER_TOKENS,
    )
