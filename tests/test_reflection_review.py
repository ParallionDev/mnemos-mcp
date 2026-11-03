"""From ChatGPT's independent review of the F1-F7 fixes (Nov 2, 2026), kept as
regressions. Each was written against a10c83f, where some failed.
"""
import re
import sqlite3

import pytest

from mnemos.core.belief import Belief
from mnemos.simple_runtime import MnemosRuntime


SCOPE = dict(agent_id="review", person_id="reviewer", project_scope="throwaway")
MODEL = "claude-opus-4-6"


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    for key in ("MNEMOS_LLM_PROVIDER", "MNEMOS_MODEL", "MNEMOS_AGENT_MODEL", "MNEMOS_EMBEDDING_MODEL", "MNEMOS_EMBEDDING_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "CLAUDE_CODE_SESSION_ID"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("MNEMOS_DISABLE_DOTENV", "1")
    monkeypatch.setenv("MNEMOS_MAINTENANCE", "inline")
    monkeypatch.setattr("mnemos.simple_runtime.harness_session", lambda: "")


def setup(tmp_path, kind):
    rt = MnemosRuntime(db_path=str(tmp_path / "review.db"), use_dedicated_model=False, **SCOPE)
    captured = rt.capture("The ferry leaves from pier four on weekdays.", signed_as=MODEL)
    target = re.search(r"Memory ID: (engram_\w+)", captured).group(1)
    store = rt._store
    with store.transaction() as conn:
        conn.execute("DELETE FROM reflection_queue")
    store.enqueue_reflection(kind, target, "Review question", **SCOPE)
    return rt, store, target


def test_note_partial_write_is_rolled_back_with_honest_reply(tmp_path, monkeypatch):
    rt, store, target = setup(tmp_path, "impact")
    before = store.get_hypomnema_entry_for_engram(target, **SCOPE)
    real_revise = store.revise_hypomnema_entry

    def partially_fail(*args, **kwargs):
        real_revise(*args, **kwargs)
        raise sqlite3.OperationalError("failure after note update")

    monkeypatch.setattr(store, "revise_hypomnema_entry", partially_fail)
    reply = rt.reflect(target, "Check the current departure pier before traveling.", signed_as=MODEL)
    after = store.get_hypomnema_entry_for_engram(target, **SCOPE)
    assert "could not be updated" in reply
    assert after["content"] == before["content"]
    assert after["revision_count"] == before["revision_count"]
    assert store.get_engram(target).impact == "Check the current departure pier before traveling."
    assert store.pending_reflection_for(target, **SCOPE) is None
    assert store._transaction_depth == 0
    assert not store._get_conn().in_transaction
    with pytest.raises(sqlite3.OperationalError, match="no such savepoint"):
        store._get_conn().execute("ROLLBACK TO carry_reflection")
    rt.close()


def test_lesson_failure_rolls_back_memory_note_and_question(tmp_path, monkeypatch):
    rt, store, target = setup(tmp_path, "lesson")
    before = store.get_engram(target)
    note_before = store.get_hypomnema_entry_for_engram(target, **SCOPE)
    save = store.save_engram

    def fail_lesson(engram):
        if "lesson" in engram.tags:
            raise sqlite3.OperationalError("failed to save distilled lesson")
        return save(engram)

    monkeypatch.setattr(store, "save_engram", fail_lesson)
    with pytest.raises(sqlite3.OperationalError):
        rt.reflect(target, "Check the current departure pier before traveling.", signed_as=MODEL)
    assert store.pending_reflection_for(target, **SCOPE) is not None
    assert store.get_engram(target).impact == before.impact
    assert store.get_hypomnema_entry_for_engram(target, **SCOPE)["content"] == note_before["content"]
    assert store._transaction_depth == 0
    assert not store._get_conn().in_transaction
    monkeypatch.setattr(store, "save_engram", save)
    assert "Lesson recorded" in rt.reflect(target, "Check the current departure pier before traveling.", signed_as=MODEL)
    rt.close()


@pytest.mark.parametrize("session", ["", "review-session-123"])
def test_still_true_retry_after_commit_failure_reinforces(tmp_path, monkeypatch, session):
    monkeypatch.setattr("mnemos.simple_runtime.harness_session", lambda: session)
    rt, store, target = setup(tmp_path, "fact")
    with store.transaction() as conn:
        conn.execute("UPDATE engrams SET accessibility=0.1, state='dormant' WHERE id=?", (target,))
    commit = store._commit
    failed = False

    def fail_first_outer_commit():
        nonlocal failed
        if not failed and store._transaction_depth == 0:
            failed = True
            raise sqlite3.OperationalError("injected commit failure")
        return commit()

    monkeypatch.setattr(store, "_commit", fail_first_outer_commit)
    with pytest.raises(sqlite3.OperationalError, match="injected commit failure"):
        rt.reflect(target, "The ferry still leaves from pier four.", verdict="still_true", signed_as=MODEL)
    monkeypatch.setattr(store, "_commit", commit)
    assert store.pending_reflection_for(target, **SCOPE) is not None
    assert store.get_engram(target).accessibility == pytest.approx(0.1)
    reply = rt.reflect(target, "The ferry still leaves from pier four.", verdict="still_true", signed_as=MODEL)
    assert "Kept: still true" in reply
    assert store.pending_reflection_for(target, **SCOPE) is None
    after = store.get_engram(target)
    print(f"retry={reply!r}; accessibility={after.accessibility}; state={after.state}")
    assert after.accessibility >= 0.8, "rolled-back reinforcement still claimed this process's once-per-session return"
    assert str(getattr(after.state, "value", after.state)) == "active"
    rt.close()


def test_belief_correction_keeps_model_and_session_signature(tmp_path, monkeypatch):
    rt, store, target = setup(tmp_path, "reaffirm")
    belief = Belief(agent_id=SCOPE["agent_id"], content="Check ferry times before traveling.", confidence=0.4,
                    source="agent", author_model=MODEL, supporting_engram_ids=[target])
    store.save_belief(belief)
    monkeypatch.setattr("mnemos.simple_runtime.harness_session", lambda: "review-session-123")
    refused = rt.correct("Check bridge traffic instead.", target_id=belief.id, signed_as="claude-sonnet-4-6")
    assert "Nothing was changed" in refused
    assert store.get_belief(belief.id).superseded_by is None
    unsigned = rt.correct("Check bridge traffic instead.", target_id=belief.id)
    assert "isn't signed" in unsigned
    assert store.get_belief(belief.id).superseded_by is None
    reply = rt.correct("Check bridge traffic instead.", target_id=belief.id, signed_as="claude-opus-4-7")
    assert "Replaced the belief" in reply
    replacement = store.get_belief(store.get_belief(belief.id).superseded_by)
    assert replacement.author_model == "claude-opus-4-7"
    assert replacement.author_session == "review-session-123"
    rt.close()


def test_direct_belief_verdict_and_waiting_question_are_atomic(tmp_path, monkeypatch):
    rt, store, target = setup(tmp_path, "reaffirm")
    belief = Belief(agent_id=SCOPE["agent_id"], content="Check ferry times before traveling.", confidence=0.4,
                    source="agent", author_model=MODEL, supporting_engram_ids=[target])
    store.save_belief(belief)
    with store.transaction() as conn:
        conn.execute("UPDATE reflection_queue SET prompt=? WHERE target_id=?", (f"Still true? [belief:{belief.id}]", target))
    answer = store.answer_reflection

    def fail_answer(*args, **kwargs):
        raise sqlite3.OperationalError("failed closing pending belief question")

    monkeypatch.setattr(store, "answer_reflection", fail_answer)
    with pytest.raises(sqlite3.OperationalError):
        rt.reflect(belief.id, "I still hold this belief.", verdict="hold", signed_as=MODEL)
    monkeypatch.setattr(store, "answer_reflection", answer)
    after = store.get_belief(belief.id)
    print(f"after rejected direct call: confidence={after.confidence}; pending={store.pending_reflection_for(target, **SCOPE) is not None}")
    assert after.confidence == 0.4, "a failed reflection already strengthened its belief"
    rt.close()
