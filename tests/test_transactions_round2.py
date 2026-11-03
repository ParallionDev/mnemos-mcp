"""From ChatGPT's second review of the F1-F7 fixes (Nov 3, 2026), kept as
regressions. Written against cd31971.
"""

import re
import sqlite3

import pytest

from mnemos.core.belief import Belief
from mnemos.simple_runtime import MnemosRuntime


SCOPE = dict(agent_id="round2", person_id="reviewer", project_scope="one")
MODEL = "claude-opus-4-6"


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    for key in (
        "MNEMOS_LLM_PROVIDER", "MNEMOS_MODEL", "MNEMOS_AGENT_MODEL",
        "MNEMOS_EMBEDDING_MODEL", "MNEMOS_EMBEDDING_PROVIDER",
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY",
        "GEMINI_API_KEY", "CLAUDE_CODE_SESSION_ID",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("MNEMOS_DISABLE_DOTENV", "1")
    monkeypatch.setenv("MNEMOS_MAINTENANCE", "inline")
    monkeypatch.setattr("mnemos.simple_runtime.harness_session", lambda: "")


def setup(tmp_path):
    rt = MnemosRuntime(
        db_path=str(tmp_path / "review.db"), use_dedicated_model=False, **SCOPE,
    )
    reply = rt.capture("The ferry leaves from pier four on weekdays.", signed_as=MODEL)
    target = re.search(r"Memory ID: (engram_\w+)", reply).group(1)
    store = rt._store
    with store.transaction() as conn:
        conn.execute("DELETE FROM reflection_queue")
    return rt, store, target


def test_real_sqlite_commit_failure_does_not_claim_unnamed_session(tmp_path):
    """Deferred FK fails commit after reconsolidation queued its publication."""
    rt, store, target = setup(tmp_path)
    try:
        conn = store._get_conn()
        conn.execute("PRAGMA foreign_keys=ON")
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        with store.transaction():
            conn.execute("CREATE TABLE review_parent (id INTEGER PRIMARY KEY)")
            conn.execute(
                "CREATE TABLE review_deferred (parent_id INTEGER REFERENCES "
                "review_parent(id) DEFERRABLE INITIALLY DEFERRED)"
            )
            conn.execute(
                "CREATE TEMP TRIGGER review_fail_commit AFTER UPDATE OF "
                "reconsolidation_count ON engrams "
                "WHEN NEW.reconsolidation_count > OLD.reconsolidation_count "
                "BEGIN INSERT INTO review_deferred(parent_id) VALUES(-1); END"
            )
            conn.execute(
                "UPDATE engrams SET accessibility=0.1, state='dormant' WHERE id=?",
                (target,),
            )
        before = store.get_engram(target)
        store.enqueue_reflection("fact", target, "Still true?", **SCOPE)

        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY constraint failed"):
            rt.reflect(target, "Still true.", verdict="still_true", signed_as=MODEL)

        after_failure = store.get_engram(target)
        assert after_failure.accessibility == pytest.approx(0.1)
        assert after_failure.reconsolidation_count == before.reconsolidation_count
        assert store.pending_reflection_for(target, **SCOPE) is not None
        assert store._transaction_depth == 0 and not conn.in_transaction

        # A later unrelated commit must not publish a callback left by the failure.
        with store.transaction():
            conn.execute("DROP TRIGGER review_fail_commit")
            conn.execute("INSERT INTO review_parent(id) VALUES(1)")
        reply = rt.reflect(target, "Still true.", verdict="still_true", signed_as=MODEL)
        retried = store.get_engram(target)
        assert "Kept: still true" in reply
        assert retried.accessibility >= 0.8
        assert retried.reconsolidation_count == before.reconsolidation_count + 1
        assert store.pending_reflection_for(target, **SCOPE) is None

        # The successful callback publishes the ordinary once-per-session claim.
        store.enqueue_reflection("fact", target, "Still true again?", **SCOPE)
        rt.reflect(target, "Still true.", verdict="still_true", signed_as=MODEL)
        assert store.get_engram(target).reconsolidation_count == retried.reconsolidation_count
    finally:
        rt.close()


def test_direct_belief_second_question_failure_rolls_back_first_and_verdict(tmp_path, monkeypatch):
    rt, store, target = setup(tmp_path)
    try:
        belief = Belief(
            agent_id=SCOPE["agent_id"], content="Check ferry times before traveling.",
            confidence=0.4, source="agent", author_model=MODEL,
            supporting_engram_ids=[target],
        )
        store.save_belief(belief)
        scope_two = dict(SCOPE, project_scope="two")
        for scope in (SCOPE, scope_two):
            store.enqueue_reflection(
                "reaffirm", target, f"Still held? [belief:{belief.id}]", **scope,
            )
        answer = store.answer_reflection
        calls = []

        def close_one_then_fail(*args, **kwargs):
            calls.append(kwargs["reflection_id"])
            if len(calls) == 2:
                raise sqlite3.OperationalError("failure closing second question")
            return answer(*args, **kwargs)

        monkeypatch.setattr(store, "answer_reflection", close_one_then_fail)
        with pytest.raises(sqlite3.OperationalError, match="second question"):
            rt.reflect(belief.id, "I still hold this.", verdict="hold", signed_as=MODEL)
        assert len(calls) == 2
        assert store.get_belief(belief.id).confidence == pytest.approx(0.4)
        for scope in (SCOPE, scope_two):
            assert store.pending_reflection_for(target, **scope) is not None
        assert store._transaction_depth == 0 and not store._get_conn().in_transaction

        monkeypatch.setattr(store, "answer_reflection", answer)
        reply = rt.reflect(belief.id, "I still hold this.", verdict="hold", signed_as=MODEL)
        assert "Kept" in reply
        assert store.get_belief(belief.id).confidence == pytest.approx(0.45)
        for scope in (SCOPE, scope_two):
            assert store.pending_reflection_for(target, **scope) is None
    finally:
        rt.close()
