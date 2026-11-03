"""From ChatGPT's independent review of the F1-F7 fixes (Nov 2, 2026), kept as
regressions. Each was written against a10c83f, where some failed.
"""
import sqlite3

import pytest

from tests.test_reflection_review import MODEL, SCOPE, isolated, setup


def test_note_failure_that_rolls_back_whole_transaction_propagates_original_error(tmp_path):
    rt, store, target = setup(tmp_path, "impact")
    before = store.get_engram(target).impact
    store._get_conn().execute("""
        CREATE TEMP TRIGGER abort_note_revision BEFORE UPDATE ON hypomnema_entries
        WHEN NEW.content != OLD.content
        BEGIN SELECT RAISE(ROLLBACK, 'injected whole transaction rollback'); END
    """)
    with pytest.raises(sqlite3.IntegrityError, match="injected whole transaction rollback"):
        rt.reflect(target, "Check the current departure pier before traveling.", signed_as=MODEL)
    assert store.pending_reflection_for(target, **SCOPE) is not None
    assert store.get_engram(target).impact == before
    assert not store._get_conn().in_transaction
    assert store._transaction_depth == 0
    rt.close()
