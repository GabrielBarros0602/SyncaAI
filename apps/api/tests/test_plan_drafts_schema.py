"""The draft's tables against a real PostgreSQL (ADR-0037).

Each table exists so the database can hold a rule, and each rule is driven here to its
refusal by name, written through SQL so no model or service stands between the row and the
constraint. Nothing is committed; each test rolls back.
"""

import uuid
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pytest
from sqlalchemy import delete, func, insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from syncaai.db import get_session_factory
from syncaai.models import (
    AiJob,
    PlanDraft,
    PlanDraftDiscard,
    PlanDraftItem,
    PlanDraftItemLink,
    PlanDraftItemPrerequisite,
    Task,
    User,
)
from syncaai.planning.context import PROMPT_VERSION

pytestmark = pytest.mark.integration

MONDAY = date(2031, 6, 2)
START = datetime(2031, 6, 2, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def session() -> Iterator[Session]:
    with get_session_factory()() as session:
        yield session
        session.rollback()


@pytest.fixture
def owner(session: Session) -> uuid.UUID:
    user = User(email=f"drafts-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash")
    session.add(user)
    session.flush()
    return user.id


def _job(session: Session, owner: uuid.UUID) -> uuid.UUID:
    job_id = uuid.uuid4()
    session.execute(
        insert(AiJob).values(
            id=job_id,
            user_id=owner,
            request="Plano SQL",
            horizon_days=14,
            prompt_version=PROMPT_VERSION,
            status="done",
            finished_at=func.now(),
            chosen_answer=0,
        )
    )
    return job_id


def _draft(session: Session, owner: uuid.UUID, **fields: Any) -> uuid.UUID:
    row = {
        "id": uuid.uuid4(),
        "user_id": owner,
        "request": "Plano SQL",
        "prompt_version": PROMPT_VERSION,
        "first_day": MONDAY,
        "last_day": MONDAY + timedelta(days=13),
        **fields,
    }
    row.setdefault("job_id", _job(session, owner))
    session.execute(insert(PlanDraft).values(**row))
    return row["id"]


def _item(session: Session, draft_id: uuid.UUID, position: int = 0, **fields: Any) -> uuid.UUID:
    row = {
        "id": uuid.uuid4(),
        "draft_id": draft_id,
        "position": position,
        "title": f"Step {position}",
        "minutes": 45,
        "placement": "placed",
        "start_at": START + timedelta(hours=position),
        **fields,
    }
    session.execute(insert(PlanDraftItem).values(**row))
    return row["id"]


def _refused(session: Session, constraint: str, write: Any) -> None:
    with pytest.raises(IntegrityError, match=constraint), session.begin_nested():
        write()


# --- The draft -----------------------------------------------------------------------------


def test_a_second_pending_draft_for_one_person_is_refused(
    session: Session, owner: uuid.UUID
) -> None:
    _draft(session, owner)

    _refused(session, "ux_plan_drafts_one_pending", lambda: _draft(session, owner))


@pytest.mark.parametrize(
    "ended",
    [
        {"status": "approved", "idempotency_key": "k-1"},
        {"status": "discarded"},
        {"status": "expired"},
    ],
)
def test_a_draft_that_has_ended_does_not_stop_the_next_one(
    session: Session, owner: uuid.UUID, ended: dict[str, Any]
) -> None:
    _draft(session, owner, ended_at=func.now(), **ended)

    _draft(session, owner)


def test_a_job_has_at_most_one_draft(session: Session, owner: uuid.UUID) -> None:
    job_id = _job(session, owner)
    _draft(session, owner, job_id=job_id, status="discarded", ended_at=func.now())

    _refused(session, "uq_plan_drafts_job_id", lambda: _draft(session, owner, job_id=job_id))


@pytest.mark.parametrize(
    ("fields", "constraint"),
    [
        ({"status": "reviewed", "ended_at": func.now()}, "ck_plan_drafts_status"),
        ({"request": ""}, "ck_plan_drafts_request_length"),
        ({"request": "x" * 501}, "ck_plan_drafts_request_length"),
        ({"last_day": MONDAY - timedelta(days=1)}, "ck_plan_drafts_horizon"),
        ({"last_day": MONDAY + timedelta(days=14)}, "ck_plan_drafts_horizon"),
        ({"ended_at": func.now()}, "ck_plan_drafts_ended_unless_pending"),
        ({"status": "discarded"}, "ck_plan_drafts_ended_unless_pending"),
        ({"status": "approved", "ended_at": func.now()}, "ck_plan_drafts_key_when_approved"),
        ({"idempotency_key": "k-1"}, "ck_plan_drafts_key_when_approved"),
        ({"prompt_version": None}, "ck_plan_drafts_job_with_its_prompt"),
        ({"job_id": None, "prompt_version": PROMPT_VERSION}, "ck_plan_drafts_job_with_its_prompt"),
    ],
)
def test_a_draft_that_contradicts_its_own_state_is_refused(
    session: Session, owner: uuid.UUID, fields: dict[str, Any], constraint: str
) -> None:
    _refused(session, constraint, lambda: _draft(session, owner, **fields))


def test_a_draft_written_by_hand_has_no_job_and_no_prompt(
    session: Session, owner: uuid.UUID
) -> None:
    """A model's draft has both; one a person writes has neither (ADR-0047)."""
    _draft(session, owner, job_id=None, prompt_version=None)


def test_fourteen_days_is_the_longest_horizon(session: Session, owner: uuid.UUID) -> None:
    _draft(session, owner, last_day=MONDAY + timedelta(days=13))


# --- Its items -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fields", "constraint"),
    [
        ({"title": "   "}, "ck_plan_draft_items_title_not_blank"),
        ({"description": "x" * 501}, "ck_plan_draft_items_description_length"),
        ({"minutes": 0}, "ck_plan_draft_items_minutes"),
        ({"minutes": 1441}, "ck_plan_draft_items_minutes"),
        ({"placement": "later"}, "ck_plan_draft_items_placement"),
        ({"start_at": None}, "ck_plan_draft_items_start_when_placed"),
        ({"placement": "no_room"}, "ck_plan_draft_items_start_when_placed"),
        ({"position": -1}, "ck_plan_draft_items_position_non_negative"),
    ],
)
def test_an_item_that_contradicts_itself_is_refused(
    session: Session, owner: uuid.UUID, fields: dict[str, Any], constraint: str
) -> None:
    draft_id = _draft(session, owner)

    _refused(session, constraint, lambda: _item(session, draft_id, **fields))


@pytest.mark.parametrize("placement", ["no_room", "not_this_week", "after_unplaced"])
def test_an_item_without_a_start_says_why(
    session: Session, owner: uuid.UUID, placement: str
) -> None:
    draft_id = _draft(session, owner)

    _item(session, draft_id, placement=placement, start_at=None)


def test_a_step_may_be_longer_than_the_block_once_the_person_edits_it(
    session: Session, owner: uuid.UUID
) -> None:
    """The block bounds the model, not the person: a whole day is still a task (ADR-0032)."""
    draft_id = _draft(session, owner)

    _item(session, draft_id, minutes=1440)


def test_two_items_cannot_share_a_position(session: Session, owner: uuid.UUID) -> None:
    draft_id = _draft(session, owner)
    _item(session, draft_id, 0)

    _refused(
        session,
        "uq_plan_draft_items_draft_id_position",
        lambda: _item(session, draft_id, 0, start_at=START + timedelta(days=1)),
    )


# --- Dependencies --------------------------------------------------------------------------


def _depends(session: Session, draft_id: uuid.UUID, item: uuid.UUID, on: uuid.UUID) -> None:
    session.execute(
        insert(PlanDraftItemPrerequisite).values(
            draft_id=draft_id, item_id=item, prerequisite_id=on
        )
    )


def _prerequisites(session: Session, item: uuid.UUID) -> list[uuid.UUID]:
    statement = select(PlanDraftItemPrerequisite.prerequisite_id).where(
        PlanDraftItemPrerequisite.item_id == item
    )
    return list(session.scalars(statement).all())


def test_removing_a_prerequisite_takes_its_constraint_and_leaves_the_step(
    session: Session, owner: uuid.UUID
) -> None:
    """ADR-0030's rule, applied by the cascade: read, exercises, project; the exercises go."""
    draft_id = _draft(session, owner)
    read, exercises, project = (_item(session, draft_id, n) for n in range(3))
    _depends(session, draft_id, exercises, read)
    _depends(session, draft_id, project, exercises)

    session.execute(delete(PlanDraftItem).where(PlanDraftItem.id == exercises))

    assert session.get(PlanDraftItem, project) is not None
    assert _prerequisites(session, project) == []
    assert (
        session.scalar(
            select(func.count())
            .select_from(PlanDraftItemPrerequisite)
            .where(PlanDraftItemPrerequisite.draft_id == draft_id)
        )
        == 0
    )


def test_a_dependency_on_another_draft_s_item_is_refused(
    session: Session, owner: uuid.UUID
) -> None:
    mine = _draft(session, owner)
    item = _item(session, mine)
    other_owner = User(email=f"drafts-{uuid.uuid4()}@example.com", password_hash="x")
    session.add(other_owner)
    session.flush()
    theirs = _item(session, _draft(session, other_owner.id))

    _refused(
        session,
        "fk_plan_draft_item_prerequisites_prerequisite",
        lambda: _depends(session, mine, item, theirs),
    )


def test_a_step_cannot_depend_on_itself(session: Session, owner: uuid.UUID) -> None:
    draft_id = _draft(session, owner)
    item = _item(session, draft_id)

    _refused(
        session,
        "ck_plan_draft_item_prerequisites_not_itself",
        lambda: _depends(session, draft_id, item, item),
    )


# --- Links ---------------------------------------------------------------------------------


def _link(session: Session, item: uuid.UUID, position: int, url: str, label: str = "Docs") -> None:
    session.execute(
        insert(PlanDraftItemLink).values(item_id=item, position=position, label=label, url=url)
    )


def test_a_step_holds_up_to_three_web_links(session: Session, owner: uuid.UUID) -> None:
    item = _item(session, _draft(session, owner))
    _link(session, item, 0, "https://sqlbolt.com/lesson/6")
    _link(session, item, 1, "http://example.com/a")
    _link(session, item, 2, "https://www.postgresql.org/docs/")

    _refused(
        session,
        "ck_plan_draft_item_links_position",
        lambda: _link(session, item, 3, "https://example.com/d"),
    )


@pytest.mark.parametrize(
    ("url", "label", "constraint"),
    [
        ("javascript:alert(1)", "Docs", "ck_plan_draft_item_links_web_address"),
        ("data:text/html,hi", "Docs", "ck_plan_draft_item_links_web_address"),
        ("ftp://example.com", "Docs", "ck_plan_draft_item_links_web_address"),
        ("https://example.com", "  ", "ck_plan_draft_item_links_label_not_blank"),
    ],
)
def test_a_link_that_is_not_a_labelled_web_address_is_refused(
    session: Session, owner: uuid.UUID, url: str, label: str, constraint: str
) -> None:
    item = _item(session, _draft(session, owner))

    _refused(session, constraint, lambda: _link(session, item, 0, url, label))


# --- Discards, and what a draft takes with it ----------------------------------------------


def test_a_discarded_step_has_to_say_why(session: Session, owner: uuid.UUID) -> None:
    draft_id = _draft(session, owner)

    _refused(
        session,
        "ck_plan_draft_discards_has_reasons",
        lambda: session.execute(
            insert(PlanDraftDiscard).values(draft_id=draft_id, position=6, title="", reasons=[])
        ),
    )


def test_deleting_a_draft_takes_its_rows_and_leaves_its_tasks(
    session: Session, owner: uuid.UUID
) -> None:
    """The thirty-day purge deletes drafts (ADR-0037). A task committed from one stays, and
    only forgets where it came from."""
    draft_id = _draft(session, owner)
    item = _item(session, draft_id)
    _link(session, item, 0, "https://example.com")
    session.execute(
        insert(PlanDraftDiscard).values(
            draft_id=draft_id, position=1, title="Step 1", reasons=["the title is empty"]
        )
    )
    task = Task(
        user_id=owner, title="Step 0", start_at=START, duration_minutes=45, plan_id=draft_id
    )
    session.add(task)
    session.flush()

    session.execute(delete(PlanDraft).where(PlanDraft.id == draft_id))
    session.expire_all()

    for model, column in (
        (PlanDraftItem, PlanDraftItem.draft_id),
        (PlanDraftDiscard, PlanDraftDiscard.draft_id),
    ):
        assert (
            session.scalar(select(func.count()).select_from(model).where(column == draft_id)) == 0
        )
    assert (
        session.scalar(
            select(func.count())
            .select_from(PlanDraftItemLink)
            .where(PlanDraftItemLink.item_id == item)
        )
        == 0
    )
    kept = session.get(Task, task.id)
    assert kept is not None and kept.plan_id is None
