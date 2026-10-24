"""What a call cost, from the versioned price table (ADR-0006, ADR-0041).

Prices are read as decimals, never floats: a call's cost is a few hundred-thousandths of a
dollar, and the ceilings are sums of thousands of them.
"""

import tomllib
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_CEILING, Decimal
from functools import cache
from pathlib import Path

PRICES_FILE = Path(__file__).with_name("prices.toml")

# Nothing they answer is billed. A rule rather than rows of zeros, so a paid model that is
# missing from the table cannot pass for one of these.
FREE_PROVIDERS = frozenset({"sample", "ollama", "fake"})

_PER_MILLION = Decimal(1_000_000)
# The scale of ``ai_usage.cost_usd``. Rounded up, never down: a ceiling that counts a little
# more than was spent refuses a little early, and one that counts less does not refuse.
_SCALE = Decimal("0.00000001")


@dataclass(frozen=True)
class Price:
    """US dollars per million tokens."""

    input: Decimal
    output: Decimal
    checked: date


PriceTable = dict[tuple[str, str], Price]


class UnpricedModelError(LookupError):
    """A paid model with no price. Counting it as free would blind every ceiling."""


def load_prices(text: str) -> PriceTable:
    table: PriceTable = {}
    for provider, models in tomllib.loads(text, parse_float=Decimal).items():
        for model, entry in models.items():
            price = Price(
                input=Decimal(entry["input"]),
                output=Decimal(entry["output"]),
                checked=entry["checked"],
            )
            if price.input < 0 or price.output < 0 or not isinstance(price.checked, date):
                message = f"{provider}/{model}: a price is not negative, and says when it was read"
                raise ValueError(message)
            table[(provider, model)] = price
    return table


@cache
def prices() -> PriceTable:
    """The table in this repository, read once."""
    return load_prices(PRICES_FILE.read_text(encoding="utf-8"))


def cost_of(
    provider: str,
    model: str,
    *,
    input_tokens: int,
    output_tokens: int,
    table: PriceTable | None = None,
) -> Decimal:
    """What one call cost, in US dollars."""
    if provider in FREE_PROVIDERS:
        return Decimal(0)
    price = (prices() if table is None else table).get((provider, model))
    if price is None:
        raise UnpricedModelError(f"{provider}/{model} has no price in {PRICES_FILE.name}")
    spent = (input_tokens * price.input + output_tokens * price.output) / _PER_MILLION
    return spent.quantize(_SCALE, rounding=ROUND_CEILING)
