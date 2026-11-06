"""A fading memory is filed under the lesson it taught, and only that one.

When a memory fades, softening looks for a lesson that already says what it
taught, reinforces it, and links the memory to it (distilled_into). Three
things went wrong on a real store:

  * The search ORed the impact's first six words, common ones included, and the
    first lesson found was taken as the same lesson. "When I looked for how I
    actually exist..." was filed under a lesson about checking a clean grep,
    through "when", "how" and "actually". Of 631 distilled_into links, 451
    joined memories to lessons they share almost no words with.
  * With no model, a fading memory's wording is never compressed, so it
    qualifies again every cycle, and its lesson was reinforced every cycle:
    143 reinforcements a cycle, the same few lessons growing without end.
  * Placeholder impacts the server wrote ("Correction to earlier continuity.")
    became lessons, and every memory carrying one reinforced it.
"""

from __future__ import annotations

from tests.portable import set_home

import pytest

from mnemos.consolidation.softening import _create_or_reinforce_lesson
from mnemos.core.engram import Engram
from mnemos.core.types import ConnectionRelation
from mnemos.simple_runtime import MnemosRuntime

# The agent's own memories: only the agent's words become lessons.
SCOPE = dict(owner_agent_id="default", person_id="user", project_scope="global",
             author_kind="agent")


def _lesson(store, content: str) -> Engram:
    lesson = Engram(content=content, impact=content, kind="procedural",
                    tags=["lesson", "distilled"], strength=0.8, stability=0.8, **SCOPE)
    store.save_engram(lesson)
    return lesson


def _fading(store, content: str, impact: str, impact_source: str = "agent") -> Engram:
    engram = Engram(content=content, impact=impact, impact_source=impact_source,
                    kind="episodic", **SCOPE)
    store.save_engram(engram)
    return store.get_engram(engram.id)


def test_sharing_common_words_does_not_make_it_the_same_lesson(store):
    grep = _lesson(store, "When I claim something is clean, the verification must "
                          "match how the thing actually varies.")
    exist = _fading(store, "a long conversation about what I am",
                    "When I looked for how I actually exist, what was true was relational.")

    lesson_id = _create_or_reinforce_lesson(exist, store, {})

    assert lesson_id != grep.id
    assert store.get_engram(lesson_id).content == exist.impact
    assert store.get_engram(grep.id).strength == pytest.approx(0.8), "an unrelated lesson was reinforced"


def test_the_same_lesson_said_again_is_reinforced(store):
    rendered = _lesson(store, "Verify the rendered result, not the declaration.")
    again = _fading(store, "fonts looked right in the inspector and wrong on screen",
                    "Verify the rendered  result, not the declaration")

    assert _create_or_reinforce_lesson(again, store, {}) == rendered.id
    assert store.get_engram(rendered.id).strength == pytest.approx(0.9)
    links = store.get_engram(again.id).connections
    assert any(c.target_id == rendered.id and c.relation == ConnectionRelation.DISTILLED_INTO for c in links)


def test_a_placeholder_impact_is_not_a_lesson(store):
    placeholder = _fading(store, "the note was corrected", "Correction to earlier continuity.",
                          impact_source="template")
    stats: dict = {}

    assert _create_or_reinforce_lesson(placeholder, store, stats) is None
    assert not stats


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / ".mnemos").mkdir(parents=True)
    set_home(monkeypatch, str(home))
    r = MnemosRuntime(db_path=str(tmp_path / "l.db"), agent_id="demo", use_dedicated_model=False)
    yield r
    r.close()


def test_a_memory_reinforces_its_lesson_once_not_every_cycle(runtime):
    """Without a model the memory stays fading, cycle after cycle; its lesson is
    drawn from it once."""
    runtime.capture("Spent three hours on a misplaced guard clause in the handler",
                    impact="Small guard clauses deserve the same care as big designs.")
    engram = runtime._store.get_active_engrams(agent_id="demo", limit=5)[0]
    engram.accessibility, engram.resolution = 0.1, 1.0
    runtime._store.save_engram(engram)
    conn = runtime._store._get_conn()
    conn.execute("UPDATE engrams SET created_at = ?, last_accessed = ? WHERE id = ?", ("2020-01-01T00:00:00+00:00", "2020-01-01T00:00:00+00:00", engram.id))
    conn.commit()

    def lesson_strength():
        lessons = [e for e in runtime._store.get_active_engrams(agent_id="demo", limit=50)
                   if "lesson" in e.tags]
        assert len(lessons) == 1, [e.content for e in lessons]
        return lessons[0].strength

    runtime.maintain()
    first = lesson_strength()
    runtime.maintain()
    runtime.maintain()

    assert lesson_strength() == pytest.approx(first)


@pytest.mark.parametrize("first, then", [
    ("Always deploy production changes on Friday.", "Never deploy production changes on Friday."),
    ("Deploy production changes on Friday.", "Don't deploy production changes on Friday."),
    ("Pin the parser to version 2.1 before release.", "Pin the parser to version 3.0 before release."),
    ("Ask Mara before changing the release checklist.", "Ask Theo before changing the release checklist."),
    ("Squash the commits before merging the branch.", "Squash the commits before merging the branch unless review asked otherwise."),
])
def test_a_lesson_said_the_other_way_is_its_own(store, first, then):
    """The same distinctive words, turned around or pinned to something else:
    filing the second under the first made a memory strengthen the opposite of
    what it taught, and recall offer it first."""
    earlier = _lesson(store, first)
    memory = _fading(store, "what happened this time", then)
    stats: dict = {}

    lesson_id = _create_or_reinforce_lesson(memory, store, stats)

    assert lesson_id != earlier.id
    assert store.get_engram(lesson_id).content == then
    assert stats == {"lessons_created": 1}
    assert store.get_engram(earlier.id).strength == pytest.approx(0.8)


def test_a_memory_filed_under_the_opposite_is_found_for_repair(store):
    from mnemos.consolidation.softening import find_misfiled_distillations
    from mnemos.core.engram import Connection

    always = _lesson(store, "Always deploy production changes on Friday.")
    never = _fading(store, "friday deploy broke prod", "Never deploy production changes on Friday.")
    never.connections.append(Connection(target_id=always.id, relation=ConnectionRelation.DISTILLED_INTO))
    store.save_engram(never)

    misfiled = find_misfiled_distillations(store, "default", "user", "global")

    assert {"source_id": never.id, "target_id": always.id, "reason": "unrelated"} in misfiled


def test_a_lesson_in_other_words_is_its_own(store):
    """Filed with no one asked, only the same words are the same lesson:
    shared vocabulary merged lessons that say different things. A rewording
    leaves a near-duplicate, the safe failure."""
    rendered = _lesson(store, "Verify the rendered result, not the declaration: "
                              "computed styles prove nothing.")
    again = _fading(store, "fonts looked right in the inspector and wrong on screen",
                    "Verify the rendered result, not the declaration.")

    assert _create_or_reinforce_lesson(again, store, {}) != rendered.id
    assert store.get_engram(rendered.id).strength == pytest.approx(0.8)


@pytest.mark.parametrize("first, then", [
    ("Pin the parser to version 1.2 before release.", "Pin the parser to version 2.1 before release."),
    ("Allow production deployments during outages.", "Block production deployments during outages."),
    ("Deploy only after review passes.", "Deploy only before review passes."),
    ("Alice must approve production releases.", "Bob must approve production releases."),
])
def test_lessons_that_share_words_but_not_meaning_stay_apart(store, first, then):
    earlier = _lesson(store, first)
    memory = _fading(store, "what happened this time", then)

    assert _create_or_reinforce_lesson(memory, store, {}) != earlier.id
