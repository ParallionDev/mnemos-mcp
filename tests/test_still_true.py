"""A fading fact is asked whether it is still true (0.6.0).

A fading memory used to be asked one thing, whatever it held: "What did it
teach you?" An experience teaches; a fact is true or it isn't. So a fading
fact (kind ``semantic``) is asked "still true?", as its own kind of question
('fact'), with three verdicts:

- still_true: it stays, woken as a return wakes it;
- changed: the agent corrects it with mnemos_correct, and the verdict closes
  the question and says so;
- no_longer_true: it's let go, archived as a forget archives it, never
  deleted;
- unsure: the question closes and the memory is left exactly as it was. In
  0.6.0 the question told an unsure agent to answer still_true, which woke the
  fact: its doubt became the old value's strength.

Experiences keep the lesson question. Code older than the store leaves the
new kind open and never spends it.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

import pytest

from mnemos import life
from mnemos.code_version import MAINTENANCE_CODE_VERSION
from mnemos.simple_runtime import (
    MnemosRuntime,
    _OLD_STILL_TRUE_QUESTION,
    _STILL_TRUE_QUESTION,
    verdict_call_lines,
)
from mnemos.store.sqlite_store import EngramStore

SCOPE = {"agent_id": "nova", "person_id": "riley", "project_scope": "demo"}
OPUS = "claude-opus-5-5"
LONG_AGO = "2020-01-01T00:00:00+00:00"
FACT = "The ferry to the island leaves from pier four on weekdays."
EXPERIENCE = "Debugged the ferry timetable parser for an afternoon."


@pytest.fixture
def db(tmp_path, monkeypatch) -> Path:
    home = tmp_path / "home"
    (home / ".mnemos").mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    return tmp_path / "memory.db"


def _runtime(db: Path) -> MnemosRuntime:
    return MnemosRuntime(db_path=str(db), use_dedicated_model=False, **SCOPE)


def _faded(db: Path, *texts: str) -> list[str]:
    """Capture each, leave it old and faint, and let the lesson pass ask."""
    rt = _runtime(db)
    try:
        ids = [re.search(r"Memory ID: (engram_\w+)", rt.capture(text, signed_as=OPUS)).group(1)
               for text in texts]
        conn = rt._store._get_conn()
        for memory in ids:
            conn.execute(
                "UPDATE engrams SET created_at = ?, last_accessed = ?, accessibility = 0.1 WHERE id = ?",
                (LONG_AGO, LONG_AGO, memory),
            )
        conn.commit()
        assert rt._enqueue_lesson_reflections({"awaiting_impact": ids}, limit=len(ids)) == len(ids)
    finally:
        rt.close()
    return ids


def _asks(db: Path) -> dict[str, tuple[str, str, str | None]]:
    conn = sqlite3.connect(str(db))
    try:
        return {target: (kind, prompt, answered) for target, kind, prompt, answered in conn.execute(
            "SELECT target_id, kind, prompt, answered_at FROM reflection_queue")}
    finally:
        conn.close()


def _state(db: Path, memory: str) -> str:
    conn = sqlite3.connect(str(db))
    try:
        return conn.execute("SELECT state FROM engrams WHERE id = ?", (memory,)).fetchone()[0]
    finally:
        conn.close()


def _reflect(db: Path, memory: str, text: str, verdict: str = "") -> str:
    rt = _runtime(db)
    try:
        return rt.reflect(memory, text, verdict=verdict, signed_as=OPUS)
    finally:
        rt.close()


def test_a_fading_fact_is_asked_whether_it_is_still_true_and_an_experience_what_it_taught(db):
    fact, experience = _faded(db, FACT, EXPERIENCE)
    asks = _asks(db)
    assert asks[fact][:2] == ("fact", _STILL_TRUE_QUESTION)
    assert asks[experience][0] == "lesson"


def test_the_wake_shows_the_verdicts(db):
    (fact,) = _faded(db, FACT)
    rt = _runtime(db)
    try:
        [ask] = rt.pending_reflections()
    finally:
        rt.close()
    assert verdict_call_lines(ask) == [
        f'mnemos_reflect(target_id="{fact}", text="…", verdict="…")',
        "verdict: still_true, changed, no_longer_true or unsure",
    ]


def test_still_true_keeps_it_and_wakes_it_as_a_return_does(db):
    (fact,) = _faded(db, FACT)
    said = _reflect(db, fact, "Still pier four.", "still_true")
    assert said.startswith("Kept: still true."), said
    assert _asks(db)[fact][2] is not None
    conn = sqlite3.connect(str(db))
    try:
        accessibility, state = conn.execute(
            "SELECT accessibility, state FROM engrams WHERE id = ?", (fact,)).fetchone()
    finally:
        conn.close()
    assert state == "active" and accessibility > 0.1


def _row(db: Path, memory: str) -> dict:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return dict(conn.execute("SELECT * FROM engrams WHERE id = ?", (memory,)).fetchone())
    finally:
        conn.close()


def test_unsure_closes_the_question_and_leaves_the_memory_exactly_as_it_was(db):
    (fact,) = _faded(db, FACT)
    before = _row(db, fact)
    said = _reflect(db, fact, "I can't tell from here; the timetable would say.", "unsure")
    assert said.startswith("Left as it was"), said
    assert _asks(db)[fact][2] is not None
    assert _row(db, fact) == before, "doubt changed the memory"
    conn = sqlite3.connect(str(db))
    try:
        (answer,) = conn.execute(
            "SELECT answer FROM reflection_queue WHERE target_id = ?", (fact,)).fetchone()
    finally:
        conn.close()
    assert answer == "I can't tell from here; the timetable would say."


def test_unsure_is_asked_once(db):
    (fact,) = _faded(db, FACT)
    _reflect(db, fact, "Can't tell.", "unsure")
    rt = _runtime(db)
    try:
        assert rt._enqueue_lesson_reflections({"awaiting_impact": [fact]}) == 0
        assert rt.pending_reflections() == []
    finally:
        rt.close()


def test_the_question_never_tells_doubt_to_answer_still_true(db):
    assert "still true." not in _STILL_TRUE_QUESTION.split("?", 1)[1].lower()
    assert "unsure" in _STILL_TRUE_QUESTION


def test_unsure_answers_only_a_fact(db):
    (experience,) = _faded(db, EXPERIENCE)
    before = _row(db, experience)
    said = _reflect(db, experience, "Not sure.", "unsure")
    assert said.startswith("Nothing recorded: unsure does not answer this question."), said
    assert _asks(db)[experience][2] is None
    assert _row(db, experience) == before


def test_upkeep_gives_a_waiting_question_the_new_words_and_leaves_answered_ones(db):
    waiting, answered = _faded(db, FACT, "The harbour office closes at five on Fridays.")
    conn = sqlite3.connect(str(db))
    conn.execute("UPDATE reflection_queue SET prompt = ?", (_OLD_STILL_TRUE_QUESTION,))
    conn.commit()
    conn.close()
    _reflect(db, answered, "Still five.", "still_true")
    rt = _runtime(db)
    try:
        rt.maintain()
    finally:
        rt.close()
    asks = _asks(db)
    assert asks[waiting][1] == _STILL_TRUE_QUESTION
    assert asks[answered][1] == _OLD_STILL_TRUE_QUESTION


def test_no_longer_true_lets_it_go_archived_never_deleted(db):
    (fact,) = _faded(db, FACT)
    said = _reflect(db, fact, "The ferry stopped running in October.", "no_longer_true")
    assert said.startswith("Let go: no longer true."), said
    assert _state(db, fact) == "archived"
    assert _asks(db)[fact][2] is not None
    rt = _runtime(db)
    try:
        assert "pier four" not in rt.recall("ferry pier")
    finally:
        rt.close()


def test_changed_closes_the_question_and_says_to_correct_it(db):
    (fact,) = _faded(db, FACT)
    said = _reflect(db, fact, "It moved to pier six.", "changed")
    assert said.startswith("Closed: it changed."), said
    assert f'mnemos_correct(target_id="{fact}"' in said
    assert _state(db, fact) != "archived", "the verdict alone rewrites nothing"
    assert _asks(db)[fact][2] is not None


def test_a_correction_alone_closes_the_question(db):
    """Corrected before the verdict, the old memory is archived, and its
    question goes with it: nothing waits to be told "changed"."""
    (fact,) = _faded(db, FACT)
    rt = _runtime(db)
    try:
        rt.correct("The ferry to the island leaves from pier six on weekdays.", target_id=fact,
                   signed_as=OPUS)
        assert rt.pending_reflections() == []
        said = rt.reflect(fact, "It moved to pier six.", verdict="changed", signed_as=OPUS)
    finally:
        rt.close()
    assert said.startswith("Nothing was pending"), said


def test_without_a_verdict_it_stays_open(db):
    (fact,) = _faded(db, FACT)
    said = _reflect(db, fact, "I think so?")
    assert "it stays open" in said, said
    assert _asks(db)[fact][2] is None
    assert _state(db, fact) != "archived"


def test_a_lesson_verdict_does_not_answer_it(db):
    (fact,) = _faded(db, FACT)
    said = _reflect(db, fact, "Ferries run on time.", "answer")
    assert said.startswith("Nothing recorded: answer does not answer this question."), said
    assert _asks(db)[fact][2] is None


def test_code_older_than_the_store_leaves_it_open(db):
    (fact,) = _faded(db, FACT)
    store = EngramStore(str(db))
    try:
        store.raise_min_code_version(MAINTENANCE_CODE_VERSION + 1)
    finally:
        store.close()
    said = _reflect(db, fact, "The ferry stopped running.", "no_longer_true")
    assert "the question stays open" in said, said
    assert _asks(db)[fact][2] is None
    assert _state(db, fact) != "archived"


def test_a_store_from_before_keeps_its_questions_and_who_they_are_for(db):
    """Schema v19 widens the queue's CHECK for 'fact'. SQLite rebuilds the
    table to do it, and every ask comes across, with the model it is for."""
    (fact,) = _faded(db, FACT)
    conn = sqlite3.connect(str(db))
    try:
        conn.execute("DELETE FROM reflection_queue")
        conn.execute("ALTER TABLE reflection_queue RENAME TO q_new")
        sql = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'q_new'").fetchone()[0]
        conn.execute(sql.replace(", 'fact'", "").replace('"q_new"', "reflection_queue")
                     .replace("q_new", "reflection_queue"))
        conn.execute("DROP TABLE q_new")
        conn.execute(
            "INSERT INTO reflection_queue (id, agent_id, person_id, project_scope, kind, target_id, "
            "prompt, created_at, for_model) VALUES ('a1', 'nova', 'riley', 'demo', 'lesson', ?, "
            "'What did it teach?', ?, 'opus')", (fact, LONG_AGO))
        conn.execute("UPDATE meta SET value = '18' WHERE key = 'schema_version'")
        conn.commit()
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO reflection_queue (id, kind, target_id, prompt, created_at) "
                "VALUES ('a2', 'fact', 'x', 'p', ?)", (LONG_AGO,))
    finally:
        conn.close()

    EngramStore(str(db)).close()

    conn = sqlite3.connect(str(db))
    try:
        assert conn.execute("SELECT kind, for_model FROM reflection_queue").fetchall() == [("lesson", "opus")]
        conn.execute(
            "INSERT INTO reflection_queue (id, kind, target_id, prompt, created_at) "
            "VALUES ('a2', 'fact', 'x', 'p', ?)", (LONG_AGO,))
    finally:
        conn.close()


def test_the_dream_asks_fading_facts_whether_they_are_still_true(db):
    (fact,) = _faded(db, FACT)
    material = life._dream_material(db, LONG_AGO, SCOPE, OPUS, set())
    assert [q["target_id"] for q in material["facts"]] == [fact]
    assert material["fading"] == []
    prompt = life._dream_prompt("nova-test-no-studio", material)
    section = prompt.split("Facts fading: still true?", 1)[1]
    assert "still_true, changed, no_longer_true or unsure" in section
    assert "still true." not in section.split("[", 1)[0].lower()
    assert f"{FACT} (kept" in section and f"[{fact}]" in section
