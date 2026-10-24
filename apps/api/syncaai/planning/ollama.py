"""A plan generator backed by an open model on the developer's own machine (ADR-0039).

Ollama runs the model locally and holds its answer to a JSON schema passed as ``format``. That
is structured output here: the schema is the contract's own (ADR-0005), so the answer arrives
in the shape the ladder parses, and nothing leaves the machine. What else a call sets was
measured against a real model before it was set (ADR-0040).

Spoken to with the standard library. One JSON request per call is all there is, and the
transport is injected, so a client dependency would buy nothing a test cannot already see.
Errors are not caught: a model that is not running, or a call past its timeout, fails the run,
and the job is left to its lock like any job that did not finish (ADR-0031).
"""

import json
import urllib.request
from collections.abc import Callable, Mapping
from typing import Any

from syncaai.planning.context import PlanPrompt
from syncaai.planning.contract import response_schema
from syncaai.planning.generator import Generation, Repair

Post = Callable[[str, Mapping[str, Any], float], Mapping[str, Any]]

# An answer and its repair are two calls, and both have to fit inside the claim's 120-second
# lock (ADR-0031, ADR-0039).
TIMEOUT_SECONDS = 50.0

# Left unset, Ollama sizes the context from the GPU: 4096 tokens on 8 GB, where a repair of
# 4,102 tokens was read as 3,724 and answered cut off, with no error (ADR-0040). The answer is
# capped too, so the longest repair fits on a GPU fast enough to outrun the timeout.
CONTEXT_TOKENS = 16384
ANSWER_TOKENS = 4096

# ``format`` holds the answer to the schema's shape without showing the model its
# descriptions, which are where a link's URL is said to be absolute (ADR-0040).
SCHEMA_NOTE = "\nAnswer with JSON matching this schema:\n"


def post_json(url: str, body: Mapping[str, Any], timeout: float) -> Mapping[str, Any]:
    """POST ``body`` as JSON and read the JSON answer."""
    # The URL is a setting, never anything a request carries, so there is no address here a
    # person could point at another host.
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        answer: Mapping[str, Any] = json.loads(response.read())
        return answer


class OllamaGenerator:
    provider = "ollama"

    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        post: Post = post_json,
        timeout: float = TIMEOUT_SECONDS,
    ) -> None:
        self._url = f"{base_url.rstrip('/')}/api/chat"
        self.model = model
        self._post = post
        self._timeout = timeout
        self._schema = response_schema()
        self._schema_note = SCHEMA_NOTE + json.dumps(self._schema)

    def generate(self, prompt: PlanPrompt, *, repair: Repair | None = None) -> Generation:
        """One call. A repair continues the conversation: the first answer as the model's own
        turn, then the correction asked for (ADR-0035)."""
        messages = [
            {"role": "system", "content": prompt.instructions + self._schema_note},
            {"role": "user", "content": prompt.message},
        ]
        if repair is not None:
            messages += [
                {"role": "assistant", "content": repair.previous},
                {"role": "user", "content": repair.message},
            ]
        body = {
            "model": self.model,
            "messages": messages,
            "format": self._schema,
            "stream": False,
            # A model that reasons first spent each call's fifty seconds doing it and answered
            # nothing; without it, every request measured became a plan (ADR-0040).
            "think": False,
            "options": {
                # Reproducible answers make a captured fixture worth comparing against.
                "temperature": 0,
                "num_ctx": CONTEXT_TOKENS,
                "num_predict": ANSWER_TOKENS,
            },
        }
        answer = self._post(self._url, body, self._timeout)
        return Generation(
            raw=answer["message"]["content"],
            model=answer.get("model", self.model),
            input_tokens=int(answer.get("prompt_eval_count", 0)),
            output_tokens=int(answer.get("eval_count", 0)),
        )
