"""What a call costs, from the price table (ADR-0006, ADR-0041)."""

from datetime import date
from decimal import Decimal

import pytest

from syncaai.planning.prices import (
    FREE_PROVIDERS,
    Price,
    UnpricedModelError,
    cost_of,
    load_prices,
    prices,
)

HAIKU = {
    ("anthropic", "claude-haiku-5-5"): Price(Decimal("0.10"), Decimal("0.50"), date(2026, 10, 23))
}


def test_the_table_in_the_repository_reads_every_price_as_a_dated_decimal() -> None:
    table = prices()

    assert table
    for price in table.values():
        assert isinstance(price.input, Decimal) and isinstance(price.output, Decimal)
        assert price.input >= 0 and price.output >= 0
        assert price.checked <= date.today()


def test_a_price_is_read_exactly_not_as_a_float() -> None:
    table = load_prices('[p."m"]\ninput = 0.1\noutput = 0.3\nchecked = 2026-01-01\n')

    assert table[("p", "m")] == Price(Decimal("0.1"), Decimal("0.3"), date(2026, 1, 1))


def test_a_call_costs_its_tokens_at_the_model_s_price() -> None:
    cost = cost_of(
        "anthropic", "claude-haiku-5-5", input_tokens=1165, output_tokens=800, table=HAIKU
    )

    assert cost == Decimal("0.0005165")


def test_a_fraction_past_the_column_s_scale_is_rounded_up() -> None:
    """A ceiling that counts a little more refuses a little early; one that counts less
    does not refuse at all (ADR-0041)."""
    table = {("p", "m"): Price(Decimal("0.075"), Decimal(0), date(2026, 1, 1))}

    assert cost_of("p", "m", input_tokens=1, output_tokens=0, table=table) == Decimal("0.00000008")


@pytest.mark.parametrize("provider", sorted(FREE_PROVIDERS))
def test_what_runs_locally_costs_nothing_whatever_the_model(provider: str) -> None:
    assert cost_of(provider, "any-model", input_tokens=10**6, output_tokens=10**6) == 0


def test_a_paid_model_without_a_price_is_an_error_never_free() -> None:
    with pytest.raises(UnpricedModelError, match="anthropic/claude-unlisted"):
        cost_of("anthropic", "claude-unlisted", input_tokens=1, output_tokens=1, table=HAIKU)


@pytest.mark.parametrize(
    "entry",
    [
        "input = -0.1\noutput = 0.3\nchecked = 2026-01-01",
        'input = 0.1\noutput = 0.3\nchecked = "yesterday"',
    ],
)
def test_a_price_that_is_negative_or_undated_is_refused(entry: str) -> None:
    with pytest.raises(ValueError, match="p/m"):
        load_prices(f'[p."m"]\n{entry}\n')
