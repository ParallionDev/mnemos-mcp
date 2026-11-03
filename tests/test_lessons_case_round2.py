"""From ChatGPT's second review of the F1-F7 fixes (Nov 3, 2026), kept as
regressions. Written against cd31971.
"""

import re
from datetime import datetime, timedelta, timezone

from mnemos.consolidation.softening import run_softening_pass
from mnemos.simple_runtime import MnemosRuntime


def test_case_sensitive_linux_paths_remain_distinct_through_default_softening(tmp_path):
    scope = dict(agent_id="review", person_id="p", project_scope="g")
    rt = MnemosRuntime(db_path=str(tmp_path / "memory.db"), use_dedicated_model=False, **scope)
    try:
        rt._ensure_init()
        store = rt._store
        now = datetime.now(timezone.utc)
        for n in range(8):
            store.mark_lived("review", when=now - timedelta(days=n))
        age = (now - timedelta(days=7)).isoformat()
        impacts = (
            "Read the Linux deployment credentials from `/srv/Prod` before release.",
            "Read the Linux deployment credentials from `/srv/prod` before release.",
        )
        source_ids, results = [], []
        for number, words in enumerate(impacts):
            reply = rt.capture(
                f"Deployment incident {number}: checked Linux directory casing.",
                impact=words, signed_as="claude-opus-4-6",
            )
            memory_id = re.search(r"engram_[A-Z0-9]+", reply).group()
            source_ids.append(memory_id)
            store._get_conn().execute(
                "UPDATE engrams SET created_at=?,last_accessed=?,accessibility=0.1 WHERE id=?",
                (age, age, memory_id),
            )
            store._get_conn().commit()
            results.append(run_softening_pass(store, {}, None, **scope))
        lesson_ids = [store._get_conn().execute(
            "SELECT target_id FROM connections WHERE source_id=? AND relation='distilled_into'",
            (source_id,),
        ).fetchone()[0] for source_id in source_ids]
        print({"impacts": impacts, "second_pass": results[-1],
               "filed_as": store.get_engram(lesson_ids[-1]).content})
        assert lesson_ids[0] != lesson_ids[1], "Case-sensitive Linux paths were filed as one lesson"
    finally:
        rt.close()
