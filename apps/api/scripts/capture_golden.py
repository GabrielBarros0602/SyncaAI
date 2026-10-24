"""Capture golden fixtures from the local model (ADR-0005, ADR-0048).

Run from ``apps/api``, with the virtual environment active and Ollama serving the model
ADR-0043 names::

    python scripts/capture_golden.py captured

Each synthetic request goes through the real generator and the ladder, as a job would put it,
against a synthetic week, so nothing a person wrote reaches the repository. One file per
request is written to the directory given, holding the request, the week, the answers and what
produced them. Which files become fixtures, and their labels, are a person's to decide: copy
the chosen ones into ``tests/golden`` and fill in ``label``. The batch's repair and discard
rates are printed at the end, the measurement ADR-0035 and ADR-0039 wait for.
"""

import argparse
import json
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from syncaai.planning.context import build_plan_context, prompt_digest
from syncaai.planning.ladder import run_ladder
from syncaai.planning.ollama import (
    ANSWER_TOKENS,
    CONTEXT_TOKENS,
    TIMEOUT_SECONDS,
    OllamaGenerator,
)
from syncaai.planning.slots import DaySlots

MODEL = "qwen3.5:4b"
OLLAMA = "http://localhost:11434"
ZONE = "America/Sao_Paulo"
# A Wednesday at noon in São Paulo, the clock the plan tests use.
NOW = datetime(2031, 6, 4, 15, 0, tzinfo=timezone.utc)

# Requests a person might type, in both languages the product answers in, short and long,
# for a week and for two, with blocks of several lengths. Synthetic, by design.
REQUESTS: list[tuple[str, int, int]] = [
    ("Estudar para a prova de cálculo de sábado: limites, derivadas e integrais", 7, 60),
    ("Organizar a mudança de apartamento no fim do mês", 14, 60),
    ("Preparar a apresentação do TCC para a banca", 7, 60),
    ("Learn enough SQL to pass a junior back-end interview", 14, 60),
    ("Aprender os acordes básicos de violão", 7, 30),
    ("Write the first chapter of my thesis on urban heat islands", 14, 90),
    ("Planejar uma viagem de três dias para Ouro Preto", 7, 60),
    ("Começar a correr: sair do sedentarismo e correr 5 km", 14, 45),
    ("Refatorar o módulo de autenticação da API e cobrir com testes", 7, 90),
    ("Ler 'O Senhor dos Anéis: A Sociedade do Anel' até o fim do mês", 14, 60),
    ("Prepare for the AWS Cloud Practitioner exam", 14, 60),
    ("Organizar as finanças pessoais e montar uma reserva de emergência", 7, 45),
    ("Aprender o básico de Docker e subir um Postgres local", 7, 60),
    ("Cozinhar as marmitas da semana", 7, 120),
    ("Redesign my portfolio website and publish it", 14, 60),
    ("Estudar inglês para uma entrevista em inglês na sexta", 7, 30),
    ("Montar um currículo e se candidatar a cinco vagas de estágio back-end", 7, 60),
    ("Limpar e organizar o quarto e o guarda-roupa", 7, 45),
    ("Practice algorithms: arrays, hash maps and two pointers", 14, 60),
    ("Escrever um artigo técnico sobre filas no PostgreSQL com SKIP LOCKED", 14, 60),
]


def week(horizon_days: int) -> list[DaySlots]:
    """Weekday evenings, a Saturday morning and afternoon, Sundays off; today from noon."""
    zone = ZoneInfo(ZONE)
    first = NOW.astimezone(zone).date()
    days = []
    for offset in range(horizon_days):
        day = first + timedelta(days=offset)
        if day.isoweekday() == 7:
            continue
        spans = ((9, 12), (14, 18)) if day.isoweekday() == 6 else ((19, 22),)
        if offset == 0:
            spans = ((13, 17), (19, 22))
        free = tuple(
            (
                datetime(day.year, day.month, day.day, start, tzinfo=zone).astimezone(timezone.utc),
                datetime(day.year, day.month, day.day, end, tzinfo=zone).astimezone(timezone.utc),
            )
            for start, end in spans
        )
        days.append(DaySlots(day, free, sum(end - start for start, end in spans) * 60))
    return days


def _day(slots: DaySlots) -> dict[str, object]:
    return {
        "day": slots.day.isoformat(),
        "free": [[start.isoformat(), end.isoformat()] for start, end in slots.free],
        "budget_minutes": slots.budget_minutes,
    }


def _ollama_version() -> str:
    with urllib.request.urlopen(f"{OLLAMA}/api/version", timeout=5) as response:
        return str(json.loads(response.read())["version"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("out", type=Path, help="where to write one file per request")
    out: Path = parser.parse_args().out
    out.mkdir(parents=True, exist_ok=True)

    generator = OllamaGenerator(base_url=OLLAMA, model=MODEL)
    captured_on = date.today().isoformat()
    ollama = _ollama_version()
    repaired = discarded = kept = 0
    for number, (request, horizon_days, block) in enumerate(REQUESTS, start=1):
        slots = week(horizon_days)
        days_off = [7]
        prompt = build_plan_context(
            request,
            slots=slots,
            horizon_days=horizon_days,
            days_off=frozenset(days_off),
            block_minutes=block,
            zone_name=ZONE,
            now=NOW,
        )
        started = time.monotonic()
        result = run_ladder(generator, prompt, max_item_minutes=block)
        seconds = round(time.monotonic() - started, 1)

        repaired += len(result.attempts) > 1
        chosen = result.report
        kept += 0 if chosen is None else len(chosen.kept)
        discarded += 0 if chosen is None else len(chosen.discarded)
        fixture = {
            "captured": {
                "model": MODEL,
                "ollama": ollama,
                "on": captured_on,
                "generator": {
                    "think": False,
                    "temperature": 0,
                    "num_ctx": CONTEXT_TOKENS,
                    "num_predict": ANSWER_TOKENS,
                    "timeout_seconds": TIMEOUT_SECONDS,
                },
                "prompt_version": prompt.version,
                "prompt_sha256": prompt_digest(prompt),
            },
            "request": request,
            "context": {
                "now": NOW.isoformat(),
                "zone": ZONE,
                "horizon_days": horizon_days,
                "block_minutes": block,
                "days_off": days_off,
                "days": [_day(day) for day in slots],
            },
            "answers": [
                {
                    "raw": attempt.generation.raw,
                    "model": attempt.generation.model,
                    "input_tokens": attempt.generation.input_tokens,
                    "output_tokens": attempt.generation.output_tokens,
                }
                for attempt in result.attempts
            ],
            "label": None,
        }
        path = out / f"{number:02d}.json"
        path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        outcome = "no plan" if chosen is None else f"{len(chosen.kept)} kept"
        print(f"{path.name}  {seconds:5.1f} s  {len(result.attempts)} call(s)  {outcome}")

    total = len(REQUESTS)
    print(f"\n{total} requests: {repaired} repaired ({repaired / total:.0%}),")
    print(f"{discarded} of {kept + discarded} steps discarded in the plans kept")


if __name__ == "__main__":
    main()
