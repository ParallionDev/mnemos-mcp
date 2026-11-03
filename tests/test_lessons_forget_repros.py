"""From ChatGPT's independent review of the F1-F7 fixes (Nov 2, 2026), kept as
regressions. Each was written against a10c83f, where some failed.
"""
import re
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest

from mnemos.simple_runtime import MnemosRuntime
from mnemos.consolidation.softening import _create_or_reinforce_lesson, run_softening_pass


@pytest.mark.parametrize("first, then", [
    ("Pin the parser to version 1.2 before release.", "Pin the parser to version 2.1 before release."),
    ("Allow production deployments during outages.", "Block production deployments during outages."),
    ("Deploy only after review passes.", "Deploy only before review passes."),
    ("Alice must approve production releases.", "Bob must approve production releases."),
])
def test_distinct_lessons_stay_distinct_through_default_softening(tmp_path, first, then):
    scope = dict(agent_id="review", person_id="p", project_scope="g")
    rt = MnemosRuntime(db_path=str(tmp_path / "memory.db"), use_dedicated_model=False, **scope)
    rt._ensure_init()
    store = rt._store
    now = datetime.now(timezone.utc)
    for n in range(8):
        store.mark_lived("review", when=now-timedelta(days=n))
    age = (now-timedelta(days=7)).isoformat()
    source_ids=[]
    results=[]
    for number, words in enumerate((first, then)):
        said = rt.capture(f"Production incident {number}: deployment review was discussed.", impact=words, signed_as="claude-opus-4-6")
        memory_id = re.search(r"engram_[A-Z0-9]+", said).group()
        source_ids.append(memory_id)
        store._get_conn().execute("UPDATE engrams SET created_at=?,last_accessed=?,accessibility=0.1 WHERE id=?", (age,age,memory_id))
        store._get_conn().commit()
        results.append(run_softening_pass(store, {}, None, **scope))
    target_ids = [store._get_conn().execute("SELECT target_id FROM connections WHERE source_id=? AND relation='distilled_into'",(memory_id,)).fetchone()[0] for memory_id in source_ids]
    print({"first":first,"then":then,"second_pass":results[-1],"filed_as":store.get_engram(target_ids[-1]).content})
    assert results[-1]["lessons_created"] == 1
    assert results[-1]["lessons_reinforced"] == 0
    assert target_ids[0] != target_ids[1]
    rt.close()


def test_forgetting_a_lesson_id_reports_what_it_actually_did(tmp_path):
    rt = MnemosRuntime(db_path=str(tmp_path / "memory.db"), agent_id="review", person_id="p", project_scope="g", use_dedicated_model=False)
    said = rt.capture("we checked the render before shipping", impact="Check the render before calling it done.", signed_as="claude-opus-4-6")
    memory_id = re.search(r"engram_[A-Z0-9]+", said).group()
    lesson_id = _create_or_reinforce_lesson(rt._store.get_engram(memory_id), rt._store, {})
    reply = rt.correct(correction="", target_id=lesson_id, action="forget")
    assert rt._store.get_engram(lesson_id).state == "archived"
    print(reply)
    assert "Nothing was archived" not in reply
    assert f"Archived memory {lesson_id}." in reply
    rt.close()


def test_forget_keeps_a_lesson_with_natural_independent_support(tmp_path):
    """Forgetting one selected source preserves the other's shared lesson.

    The old c79cdf2 characterization is preserved alongside this file as
    test_lessons_forget_repros_historical_c79cdf2.py.
    """
    scope = dict(agent_id="review", person_id="p", project_scope="g")
    db_path = str(tmp_path / "shared.db")
    rt = MnemosRuntime(db_path=db_path, use_dedicated_model=False, **scope)
    rt._ensure_init()
    store = rt._store
    now = datetime.now(timezone.utc)
    for n in range(8):
        store.mark_lived("review", when=now-timedelta(days=n))
    age = (now-timedelta(days=7)).isoformat()
    impact = "Verify ORBITCIPHER approval before releasing production changes."
    source_ids = []
    lesson_ids = []
    for content in (
        "The database migration was delayed because I had not obtained the owner's approval.",
        "The mobile rollout succeeded after I confirmed authorization with the release owner.",
    ):
        said = rt.capture(content, impact=impact, signed_as="claude-opus-4-6")
        memory_id = re.search(r"engram_[A-Z0-9]+", said).group()
        source_ids.append(memory_id)
        store._get_conn().execute("UPDATE engrams SET created_at=?,last_accessed=?,accessibility=0.1 WHERE id=?", (age,age,memory_id))
        store._get_conn().commit()
        run_softening_pass(store, {}, None, **scope)
        lesson_ids.append(store._get_conn().execute("SELECT target_id FROM connections WHERE source_id=? AND relation='distilled_into'", (memory_id,)).fetchone()[0])
    assert lesson_ids[0] == lesson_ids[1]
    lesson_id = lesson_ids[0]
    assert store.get_engram(lesson_id).state != "archived"
    reply = rt.correct(correction="", target_id=source_ids[0], action="forget")
    assert store.get_engram(source_ids[0]).state == "archived"
    assert store.get_engram(lesson_id).state != "archived"
    assert store.get_engram(source_ids[1]).state != "archived"
    assert store.get_engram(source_ids[1]).impact == impact
    assert "alone taught" not in reply
    # The second source still points to a live lesson. Subsequent softening
    # reuses it without creating duplicates or repeatedly reinforcing it.
    later = run_softening_pass(store, {}, None, **scope)
    assert store.get_engram(lesson_id).state != "archived"
    assert later["lessons_created"] == 0
    assert later["lessons_reinforced"] == 0
    rt.close()

    # Read in a new process: the shared lesson and other source remain
    # searchable, and the source's id delivers the complete identical impact.
    child = """import json, sys
from mnemos.simple_runtime import MnemosRuntime
r = MnemosRuntime(db_path=sys.argv[1], agent_id='review', person_id='p', project_scope='g', use_dedicated_model=False)
print(json.dumps({'query':r.recall('ORBITCIPHER'), 'by_id':r.recall(sys.argv[2])}))
r.close()
"""
    recalled = json.loads(subprocess.check_output([sys.executable, "-c", child, db_path, source_ids[1]], text=True, cwd=tmp_path))
    assert source_ids[1] in recalled["query"]
    assert lesson_id in recalled["query"]
    assert impact in recalled["by_id"]
    print({"sources":source_ids,"shared_lesson":lesson_id,"forget_reply":reply,
           "surviving_impact":impact,"next_softening":later,"next_process_recall":recalled})
