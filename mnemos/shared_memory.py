"""The machine's opt-in collective graph, separate from every agent's scope.

Only capture creates this file. Existing opens use SQLite mode=rw, so a
missing file (including a removal between checking and opening) stays missing.
The graph adapter removes personal-scope filtering only on this separate file;
each memory retains its actual author's agent id. No scope is resolved here.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from .core.engram import Engram
from .store.sqlite_store import EngramStore

PREFIX = "shared_"
LAST_PASS = "shared_memory:last_pass"
PASS_HOURS = 4


def enabled() -> bool:
    return os.environ.get("MNEMOS_SHARED_MEMORY", "").strip().lower() != "off"


def path() -> Path:
    target = Path(os.environ.get("MNEMOS_SHARED_MEMORY_DB") or Path.home() / ".mnemos/shared-memory.db").expanduser()
    # Even an override must never route this feature into the legacy pool.
    if target.resolve() == (Path.home() / ".mnemos/shared.db").resolve():
        raise ValueError("Shared memory cannot use the legacy shared.db.")
    return target


class _Graph(EngramStore):
    """Existing graph, without migrations or a create-on-open side effect."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._transaction_depth = 0
        self._versions_written = []
        self._conn = sqlite3.connect(
            f"{db_path.resolve().as_uri()}?mode=rw", uri=True, check_same_thread=False,
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA busy_timeout=0")
        self._conn.execute("PRAGMA foreign_keys=ON")

    def engram_visible_in_scope(self, engram_id, **_scope):
        return self.engram_state_in_scope(engram_id) is not None

    def engram_state_in_scope(self, engram_id, **_scope):
        row = self._get_conn().execute("SELECT state FROM engrams WHERE id = ?", (engram_id,)).fetchone()
        return row[0] if row else None

    def live_memory_texts(self, **_scope):
        return [tuple(row) for row in self._get_conn().execute(
            "SELECT id, content, state FROM engrams WHERE state IN ('active', 'dormant') ORDER BY created_at DESC, id DESC"
        )]

    def live_engram_ids(self, **_scope):
        return {row[0] for row in self.live_memory_texts()}

    def search_fts_ranked(self, query, limit=10, *, state=None, **scope):
        # The retriever's shared-word lane searches all authors. Include quiet
        # memories there too; its ordinary lane specifies the state itself.
        if state is not None:
            return super().search_fts_ranked(query, limit=limit, state=state, **scope)
        found = super().search_fts_ranked(query, limit=limit, state="active", **scope)
        found += super().search_fts_ranked(query, limit=10, state="dormant", **scope)
        return sorted(found, key=lambda item: item[1])[:limit]

    def live_memory_lessons(self, **_scope):
        return {}  # A collective graph has no lessons or beliefs to elicit.


def _index(target, *, read_only=True):
    from .store.embedding_index import EmbeddingIndex
    return EmbeddingIndex(db_path=str(target), read_only=read_only)


def _index_saved(target, memory):
    # Meaning is a cache; a failed embedding never loses the agent's words.
    try:
        from .store.embedding_index import WRITE_EMBED_SECONDS
        with closing(_index(target, read_only=False)) as index:
            index.index_passages([(memory.id, memory.content)], seconds=WRITE_EMBED_SECONDS)
    except Exception:
        pass


def capture(content, *, agent_id, model, context="", standing=False):
    if not enabled():
        return "Nothing shared: shared memory is off for this server (MNEMOS_SHARED_MEMORY=off)."
    if standing:
        return "Nothing shared: shared memories cannot be standing."
    if not content.strip():
        return "Nothing captured: content was empty."
    target = path()
    memory = Engram(content=content.strip(), owner_agent_id=agent_id,
                    author_kind="agent", author_model=model, visibility="shared")
    memory.id = PREFIX + memory.id
    if context.strip():
        memory.content += f"\n\nContext: {context.strip()}"
        memory.content_at_encoding = memory.content
    with closing(EngramStore(target)) as store, store.transaction():
        store.save_engram(memory)
        store.mark_lived(agent_id)
    _index_saved(target, memory)
    return ("Saved to shared memory. Every agent on this machine can read it.\n"
            f"Shared memory ID: {memory.id}")


def recall(query, *, agent_id, session=""):
    """Append-only recall contribution; any failure is silent."""
    if not enabled():
        return ""
    try:
        from .retrieval.reactive import ReactiveRetriever, RetrievalResult
        target = path()
        with closing(_Graph(target)) as store, store.transaction(), closing(_index(target)) as index:
            retriever = ReactiveRetriever(store, embedding_index=index, shared_store=store, common_share=None)
            if query.strip().startswith(PREFIX):
                memory = store.get_engram(query.strip())
                if memory is None:
                    return ""
                if memory.state == "archived":
                    reason = store._get_conn().execute(
                        "SELECT archive_reason FROM archive WHERE id = ?", (memory.id,),
                    ).fetchone()
                    if not reason or reason[0] != "decay_below_threshold":
                        return ""
                    from .code_version import MAINTENANCE_CODE_VERSION
                    if (store.min_code_version() or 0) <= MAINTENANCE_CODE_VERSION:
                        from .store.archive import resharpen
                        memory = resharpen(store, memory.id) or memory
                results = [RetrievalResult(engram=memory)]
            else:
                results = retriever.retrieve(query, agent_id=None, person_id=None,
                                             project_scope=None, max_results=3,
                                             reconsolidate_results=False)
            if not results:
                return ""
            # The transaction covers selection too: no concurrent withdrawal
            # can be resurrected by reinforcement of a stale result.
            retriever.reinforce(results, query, agent_id=agent_id,
                                 session=f"{agent_id}:{session or os.getpid()}")
            rows = ["Shared memory:"]
            for result in results:
                memory = result.engram
                rows.append(f"- [shared] {memory.id} | {memory.owner_agent_id} | "
                            f"{memory.author_model or 'model unknown'} | {memory.created_at[:10]}\n{memory.content}")
            return "\n".join(rows)
    except Exception:
        return ""


def correct(target_id, correction, *, action, agent_id, model):
    if not enabled():
        return "Nothing changed: shared memory is off for this server."
    try:
        target = path()
        with closing(_Graph(target)) as store, store.transaction():
            memory = store.get_engram(target_id)
            if memory is None:
                return "Shared memory not found. Nothing changed."
            if memory.owner_agent_id != agent_id:
                return "Only the agent that shared this memory may correct or withdraw it. Nothing changed."
            seen = set()
            while memory.lineage.superseded_by and memory.id not in seen:
                seen.add(memory.id)
                memory = store.get_engram(memory.lineage.superseded_by)
                if memory is None or memory.owner_agent_id != agent_id:
                    return "Shared memory successor unavailable. Nothing changed."
            if action in {"forget", "archive", "remove", "delete"}:
                store.archive_engram(memory, reason="shared_withdrawn")
                return f"Withdrawn from shared memory (archived, never deleted): {memory.id}"
            if action != "update":
                return "Shared memories can only be updated or archived; nothing is standing. Nothing changed."
            if memory.state == "archived":
                return "Shared memory is archived. Nothing changed."
            if not correction.strip():
                return "Correction needs replacement text."
            replacement = Engram(content=correction.strip(), owner_agent_id=agent_id,
                                 author_kind="agent", author_model=model, visibility="shared")
            replacement.id = PREFIX + replacement.id
            replacement.lineage.supersedes = [memory.id]
            memory.lineage.superseded_by = replacement.id
            store.save_engram(memory)
            store.archive_engram(memory, reason="shared_corrected")
            store.save_engram(replacement)
        _index_saved(target, replacement)
        return f"Corrected shared memory. Shared memory ID: {replacement.id}"
    except Exception:
        return "Shared memory unavailable. Nothing changed."


def maintain():
    """Only decay and linking, once per four hours of wall time, atomically.

    BEGIN IMMEDIATE is the cross-process lock, released even on a crash.
    The shared graph lives on days someone maintains it; all its authors'
    clocks advance together, without opening any author's private graph.
    """
    if not enabled():
        return False
    try:
        from .code_version import MAINTENANCE_CODE_VERSION
        from .consolidation.decay import run_decay_pass
        from .consolidation.connection_discovery import run_connection_discovery
        target = path()
        with closing(_Graph(target)) as store, store.transaction():
            if (store.min_code_version() or 0) > MAINTENANCE_CODE_VERSION:
                return False
            now = datetime.now(timezone.utc)
            last = store.get_meta(LAST_PASS)
            elapsed = (now - datetime.fromisoformat(last)).total_seconds() / 3600 if last else None
            if elapsed is not None and elapsed < PASS_HOURS:
                return False
            for row in store._get_conn().execute("SELECT DISTINCT owner_agent_id FROM engrams").fetchall():
                store.mark_lived(row[0])
            from .config.loader import load_config
            config = load_config()
            config = config.get("consolidation", config)
            with closing(_index(target)) as index:
                run_connection_discovery(store, embedding_index=index, config=config, agent_id=None)
                run_decay_pass(store, config, agent_id=None, max_elapsed_hours=elapsed)
            store.set_meta(LAST_PASS, now.isoformat())
        return True
    except Exception:
        return False


def author_model(runtime, signed_as):
    """Resolve the existing session signature without opening its store to write."""
    from .authorship import resolve_author_model, session_introduction
    from .store.sqlite_store import ReadOnlyEngramStore
    model = runtime._session_author
    if runtime._store is not None:
        model = session_introduction(runtime._store.get_meta)[0] or model
    else:
        try:
            with closing(ReadOnlyEngramStore(runtime.db_path)) as store:
                model = session_introduction(store.get_meta)[0] or model
        except Exception:
            pass
    return resolve_author_model(model, signed_as=signed_as)
