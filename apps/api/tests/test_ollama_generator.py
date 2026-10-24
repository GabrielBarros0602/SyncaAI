"""The local model generator (ADR-0039, ADR-0040), with no model running.

The transport is injected, so the request is read exactly as Ollama would receive it, and one
test sends it over real HTTP to a server on this machine, so the standard-library client is
exercised too. Nothing here needs Ollama installed.
"""

import json
import threading
from collections.abc import Iterator, Mapping
from datetime import datetime, time, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, ClassVar
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

from syncaai.config import Settings
from syncaai.planning.context import build_plan_context, build_repair_message
from syncaai.planning.contract import (
    MAX_DESCRIPTION_CHARS,
    MAX_HORIZON_DAYS,
    MAX_ITEM_MINUTES,
    MAX_LINKS_PER_ITEM,
    MAX_PLAN_ITEMS,
    MAX_REQUEST_CHARS,
    MAX_TITLE_CHARS,
    PlanResponse,
    response_schema,
)
from syncaai.planning.generator import Repair, SampleGenerator
from syncaai.planning.ladder import run_ladder
from syncaai.planning.ollama import (
    ANSWER_TOKENS,
    CONTEXT_TOKENS,
    SCHEMA_NOTE,
    TIMEOUT_SECONDS,
    OllamaGenerator,
    post_json,
)
from syncaai.planning.slots import DaySlots
from syncaai.planning.validation import check_plan
from syncaai.services.ai_queue import VISIBILITY_TIMEOUT
from syncaai.worker import generator_from

ZONE = "America/Sao_Paulo"
NOW = datetime(2031, 6, 2, 15, 0, tzinfo=timezone.utc)
PROMPT = build_plan_context(
    "Plano de estudos para a prova de sábado",
    slots=[],
    horizon_days=1,
    days_off=frozenset({1}),
    block_minutes=60,
    zone_name=ZONE,
    now=NOW,
)
ANSWER = SampleGenerator().generate(PROMPT).raw


class _Recorder:
    """Stands in for the transport: keeps every call and answers as Ollama does."""

    def __init__(self, content: str = ANSWER) -> None:
        self.calls: list[tuple[str, Mapping[str, Any], float]] = []
        self._content = content

    def __call__(self, url: str, body: Mapping[str, Any], timeout: float) -> Mapping[str, Any]:
        self.calls.append((url, body, timeout))
        return {
            "model": "local-model:8b",
            "message": {"role": "assistant", "content": self._content},
            "done": True,
            "prompt_eval_count": 812,
            "eval_count": 344,
        }


def _generator(post: _Recorder) -> OllamaGenerator:
    return OllamaGenerator(base_url="http://localhost:11434/", model="local-model:8b", post=post)


def test_the_request_holds_the_answer_to_the_schema_and_shows_the_schema_to_the_model() -> None:
    """``format`` holds the shape; the descriptions reach the model only through its
    instructions. Each setting here was measured against a real model first (ADR-0040)."""
    post = _Recorder()

    _generator(post).generate(PROMPT)

    [(url, body, timeout)] = post.calls
    assert url == "http://localhost:11434/api/chat"
    assert timeout == TIMEOUT_SECONDS
    assert body["model"] == "local-model:8b"
    assert body["format"] == response_schema()
    assert body["stream"] is False
    assert body["think"] is False
    assert body["options"] == {
        "temperature": 0,
        "num_ctx": CONTEXT_TOKENS,
        "num_predict": ANSWER_TOKENS,
    }
    assert body["messages"] == [
        {
            "role": "system",
            "content": PROMPT.instructions + SCHEMA_NOTE + json.dumps(response_schema()),
        },
        {"role": "user", "content": PROMPT.message},
    ]


def test_a_repair_continues_the_conversation_with_the_first_answer_as_the_model_s_turn() -> None:
    post = _Recorder()
    repair = Repair(previous="not a plan", message=build_repair_message(["the answer: bad"]))

    _generator(post).generate(PROMPT, repair=repair)

    messages = post.calls[0][1]["messages"]
    assert messages[2:] == [
        {"role": "assistant", "content": "not a plan"},
        {"role": "user", "content": repair.message},
    ]


def test_the_answer_is_read_raw_with_its_model_and_its_tokens() -> None:
    generation = _generator(_Recorder()).generate(PROMPT)

    assert (generation.raw, generation.model) == (ANSWER, "local-model:8b")
    assert (generation.input_tokens, generation.output_tokens) == (812, 344)


def test_an_answer_from_the_local_model_climbs_the_same_ladder() -> None:
    result = run_ladder(_generator(_Recorder()), PROMPT, max_item_minutes=60)

    assert result.chosen == 0 and result.report is not None
    assert len(result.report.kept) == 3


def test_a_truncated_answer_is_repaired_like_any_answer_that_is_not_a_plan() -> None:
    """Ollama stops at its output limit mid-JSON; the ladder sees that as no plan at all."""
    post = _Recorder(content=ANSWER[: len(ANSWER) // 2])

    result = run_ladder(_generator(post), PROMPT, max_item_minutes=60)

    assert len(post.calls) == 2
    assert result.failure is not None


def test_an_answer_and_its_repair_fit_inside_one_claim() -> None:
    """Each call waits at most this long, so that two, an answer and its repair, end before
    the claim's lock does and another worker takes the job (ADR-0031, ADR-0039)."""
    assert VISIBILITY_TIMEOUT.total_seconds() > 2 * TIMEOUT_SECONDS


def _free_days(count: int) -> list[DaySlots]:
    zone = ZoneInfo(ZONE)
    first = NOW.astimezone(zone).date()
    days = []
    for offset in range(count):
        day = first + timedelta(days=offset)
        opens = datetime.combine(day, time(8), tzinfo=zone).astimezone(timezone.utc)
        closes = datetime.combine(day, time(22), tzinfo=zone).astimezone(timezone.utc)
        days.append(DaySlots(day, ((opens, closes),), 14 * 60))
    return days


def _a_plan_failing_every_rule() -> PlanResponse:
    item = {
        "title": "t" * (MAX_TITLE_CHARS + 1),
        "description": "d" * (MAX_DESCRIPTION_CHARS + 1),
        "estimated_minutes": 10**9,
        "depends_on": [MAX_PLAN_ITEMS - 1],
        "links": [{"label": "", "url": "not-a-url"}] * MAX_LINKS_PER_ITEM,
    }
    return PlanResponse.model_validate({"items": [item] * MAX_PLAN_ITEMS})


def test_the_longest_repair_fits_inside_the_context_it_is_sent_with() -> None:
    """Ollama cuts what does not fit without an error (ADR-0040), so the longest conversation
    a job sends has to fit whole: the longest prompt, a first answer as long as the cap
    allows, the longest correction, and room for the second answer."""
    prompt = build_plan_context(
        "\N{GRINNING FACE}" * MAX_REQUEST_CHARS,
        slots=_free_days(MAX_HORIZON_DAYS),
        horizon_days=MAX_HORIZON_DAYS,
        days_off=frozenset(),
        block_minutes=MAX_ITEM_MINUTES,
        zone_name=ZONE,
        now=NOW,
    )
    errors = check_plan(_a_plan_failing_every_rule(), max_item_minutes=MAX_ITEM_MINUTES).errors
    post = _Recorder()

    _generator(post).generate(prompt, repair=Repair("", build_repair_message(errors)))

    system, message, _, correction = (turn["content"] for turn in post.calls[0][1]["messages"])
    request = json.loads(message)["request"]
    written = len(system) + len(message) - len(request) + len(correction)
    # What the code writes measured about three characters a token on qwen3.5 (ADR-0040); two
    # leaves room for a tokenizer that does worse. The request can be in any script, so it is
    # counted by its bytes: a byte-level tokenizer never spends more than a token on one.
    longest = written // 2 + len(request.encode()) + 2 * ANSWER_TOKENS
    assert longest <= CONTEXT_TOKENS


# --- Over real HTTP ------------------------------------------------------------------------


class _Ollama(BaseHTTPRequestHandler):
    received: ClassVar[list[tuple[str, str, dict[str, Any]]]] = []

    def do_POST(self) -> None:
        length = int(self.headers["Content-Length"])
        body = json.loads(self.rfile.read(length))
        type(self).received.append((self.path, self.headers["Content-Type"], body))
        answer = json.dumps({"model": body["model"], "message": {"content": ANSWER}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(answer)))
        self.end_headers()
        self.wfile.write(answer)

    def log_message(self, *_args: object) -> None:
        """Quiet: the test asserts what arrived instead."""


@pytest.fixture
def local_server() -> Iterator[str]:
    _Ollama.received = []
    server = HTTPServer(("127.0.0.1", 0), _Ollama)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def test_the_standard_library_client_posts_json_and_reads_json(local_server: str) -> None:
    generator = OllamaGenerator(base_url=local_server, model="local-model:8b")

    generation = generator.generate(PROMPT)

    [(path, content_type, body)] = _Ollama.received
    assert (path, content_type) == ("/api/chat", "application/json")
    assert body["format"] == response_schema()
    assert (generation.raw, generation.model) == (ANSWER, "local-model:8b")
    assert (generation.input_tokens, generation.output_tokens) == (0, 0)


def test_a_model_that_is_not_running_fails_the_call(local_server: str) -> None:
    """Not caught: the worker logs it and leaves the job to its lock (ADR-0031)."""
    closed = local_server.rsplit(":", 1)[0] + ":1"

    with pytest.raises(OSError):
        post_json(f"{closed}/api/chat", {}, 2.0)


# --- Choosing it ---------------------------------------------------------------------------


def _settings(**values: Any) -> Settings:
    return Settings(
        database_url="postgresql+psycopg://user:pass@localhost:5432/syncaai_test",
        jwt_secret="a-secret-only-for-tests-long-enough-for-hs256",
        _env_file=None,
        **values,
    )


def test_the_sample_answers_unless_a_local_model_is_named() -> None:
    assert isinstance(generator_from(_settings()), SampleGenerator)


def test_the_local_model_answers_when_it_is_named() -> None:
    generator = generator_from(_settings(ai_provider="ollama", ollama_model="local-model:8b"))

    assert isinstance(generator, OllamaGenerator)


@pytest.mark.parametrize("model", [None, ""])
def test_a_local_model_without_a_name_is_refused_at_boot(model: str | None) -> None:
    with pytest.raises(ValidationError, match="OLLAMA_MODEL"):
        _settings(ai_provider="ollama", ollama_model=model)
