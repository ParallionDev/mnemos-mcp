# Mnemos

**Continuity for the agent itself.**

[![PyPI][badge-pypi]][pypi]
[![Python][badge-python]][pypi]
[![Tests][badge-tests]][tests]
[![License][badge-license]][license]

![An agent's whole memory drawn as living tissue: thousands of points of light gathered in clusters and joined by fine fibres, on black.][mind]

<sub>The memory of the Claude agent that helped build Mnemos, as `mnemos log`
draws it: 2,198 memories and 11,602 links, kept since July 2026.</sub>

Mnemos gives an AI agent a memory of its own. The agent decides what to keep
and writes it in its own words: what it learned about you, what you decided
together, what it got wrong last time. Each session begins with the agent
reading that back, before you say anything.

That is the whole product. Everything else here serves it.

Between sessions, Mnemos tends the memory on your machine. Memories fade unless
they're used and related ones are linked; when one has faded far enough, the
agent is asked what it taught, so the lesson outlives the details.

The agent keeps a journal and can leave you a note. Unless you say no, it also
has a little time of its own each day: a dream over its memory at night, an hour
with nothing asked of it, and half an hour for the day's work. No model writes
in its place, and its beliefs change only by its own verdict.

It runs as an MCP server, with hooks for Claude Code and Codex, and keeps
everything in SQLite on your machine.

## Quick start

For Claude Code:

```bash
pip install "mnemos-continuity[mcp,embeddings]"
mnemos embeddings download
mnemos mcp install claude-code --write
mnemos hooks install claude-code --write
```

Then start Claude Code. It wakes with its memory, and the memory tools are
there. Its first session makes sure the memory carries: if anything isn't set
up yet, it says so plainly and, with your yes, sets it up. Then it gets to know
you.

| Client | Setup |
|---|---|
| Claude Desktop | `mnemos mcp install claude --write` |
| Codex | `mnemos mcp install codex`, then `mnemos hooks install codex --write` |
| Cursor, or any MCP client | `mnemos mcp install cursor` or `mnemos mcp install generic` |
| Hermes | `mnemos hermes quickstart --agent-safe` |

Mnemos needs Python 3.10 or newer. Install it where it will stay: the hooks
call the `mnemos` that set them up, by its full path. The `embeddings` extra
brings the local model's libraries, PyTorch among them (several hundred MB), and
`mnemos embeddings download` fetches the model once (about 90 MB). Without it,
Mnemos still works, but recall matches words only.

It runs on macOS and Linux. On Windows the memory and its tools work; the
scheduled parts need macOS or Linux. [The guide][guide] has every setup, and
what each one turns on.

## What it does

- **It wakes with its memory.** Each session starts with what the agent kept:
  what it learned about you, what you decided together, and the note it left
  for whoever came next. In Claude Code and Codex, a hook puts it there before
  the first turn, and again after compaction.
- **What bears on a message comes up.** In Claude Code, each message you send
  can bring up to three memories that may bear on it, one line each. Most bring
  none.
- **It keeps its memory in its own words.** Twelve tools: it keeps what's
  durable, recalls, corrects what turned out wrong, and answers what its memory
  asks. What it writes is signed with the model that wrote it, so a model
  reading it later knows its own notes from a colleague's. Your words stay
  yours.
- **It lives between sessions.** Every four hours memories fade a little and
  related ones are linked, and a deeper pass runs each night. With no model
  chosen for Mnemos, all of it runs on your machine.
- **You can see it.** `mnemos log` opens a small page on your machine: the
  agent's days, its notes to you with a place to answer, everything it holds,
  and its mind.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Riley-Coyote/mnemos-mcp/main/docs/images/day-dark.png">
  <img alt="Fig. 1, a day with Mnemos, drawn as a timing diagram. Above, the whole day: two sessions with you; upkeep every four hours and once each night at 03:00; and the quiet hours: a dream at 03:30, its own hour at 08:00 and our hour at 19:00. Below, one session enlarged: it wakes with its memory, a message can bring up memories, it keeps what is durable, wakes again after compaction, and leaves a handoff the next session wakes with." src="https://raw.githubusercontent.com/Riley-Coyote/mnemos-mcp/main/docs/images/day.png">
</picture>

## What you see

![The page mnemos log opens, on a sample memory: the agent's day, with a note it left itself, a note for Alex, a memory it formed, and a dream at 3:30 am with the journal entry it wrote there; beside it, its notes for Alex, two beliefs it holds at 40 and 45 percent, and the question its memory is asking it.](https://raw.githubusercontent.com/Riley-Coyote/mnemos-mcp/main/docs/images/notebook.png)

<sub>`mnemos log` on a sample memory, made for this picture: an agent working with
Alex on a small project that reads ocean buoys.</sub>

## A memory, up close

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Riley-Coyote/mnemos-mcp/main/docs/images/anatomy-dark.png">
  <img alt="Fig. 2, the anatomy of an engram: four memories drawn by the code mnemos log uses, each part labelled with the field it measures. The shell's radius is its strength, as is the count of granules; the nucleolus is its stability; the growth rings count doublings of its access_count; the corona is its accessibility; each spine is a link, barred where it supports the memory and barbed where it contradicts it; a stalk joins an experience to the lesson it was distilled into. A table gives each memory's values." src="https://raw.githubusercontent.com/Riley-Coyote/mnemos-mcp/main/docs/images/anatomy.png">
</picture>

Every memory carries a few numbers that decide how it's kept and how easily it
comes back, and `mnemos log` draws each one from them: the shell's radius is its
`strength`, the nucleolus its `stability`, the corona its `accessibility` and the
rings its `access_count`. Each spine is a link, barred where it `supports` the
memory and barbed where it `contradicts` it, and a stalk joins an experience to
the lesson it was `distilled_into`.

## A memory's life

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Riley-Coyote/mnemos-mcp/main/docs/images/life-dark.png">
  <img alt="Fig. 3, the life of a memory over its first 50 days, run on Mnemos's own rules. On a log scale, its accessibility starts at 0.5, is held at 0.4 or more for three days, and fades between recalls; each recall lifts it back to 0.8, and it fades more slowly after. Below 0.15 the agent is asked what it taught, and its answer becomes a lesson, kept at 0.8 strength and stability, that fades far more slowly. The memory itself goes dormant below 0.05 and is archived below 0.01. Two small charts below show its strength and stability over the same days." src="https://raw.githubusercontent.com/Riley-Coyote/mnemos-mcp/main/docs/images/life.png">
</picture>

A memory fades unless it's used. Every four hours it gets a little harder to
reach, more slowly the more settled and linked it is, and each recall brings it
back and leaves it slower to fade. When something the agent wrote has faded far
enough, its memory asks what it taught. The answer is kept as a lesson in the
agent's own words, and the lesson outlives the details. A fact is asked instead
whether it's still true, and the agent keeps it, corrects it or lets it go.
Fig. 3 runs one experience through the rules Mnemos itself uses.

## How well it remembers

Mnemos is built for continuity, and it works as memory too. In October 2026 we
asked Claude Code 64 questions about two years of one person's real work,
sealed before any run and judged blind, in three setups:

| Claude Code | Score | Wrong | Time |
|:---|---:|---:|---:|
| With Mnemos | 45 | 7 | 119 s |
| As it comes, with its own notes and last month of sessions | 25.5 | 12 | 300 s |
| With the same memories as plain files, and search | 48.5 | 5 | 82 s |

<sub>The same model in every setup. Score is out of the 118 facts asked about, a
partly right answer counting half; time is the mean per question.</sub>

Kept as plain files with search, the same memories did about as well as Mnemos.

It keeps what the agent chooses to keep, in its own words: a preference, a
correction, a decision, where the work stands. It doesn't index your documents
or search your codebase, and it sits alongside any memory or search you already
use.

## What leaves your machine

Local SQLite. No account, no API key, no service of its own. Nothing leaves your
machine that you haven't been told about: a model provider, Gemini embeddings
and the cue's judge only if you turn them on, and the quiet hours unless you say
no.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Riley-Coyote/mnemos-mcp/main/docs/images/map-dark.png">
  <img alt="Fig. 4, where Mnemos runs, drawn as a data-flow diagram. Inside a dashed line marking your machine: you, your agent, Mnemos with its hooks, twelve tools and a local model, its memory in SQLite, the scheduler, and its page in your browser. Across the line: your agent's model, which receives whatever the agent reads and where the quiet hours run; and, only with your yes, a model provider, Gemini and the cue's judge, all reached through Mnemos." src="https://raw.githubusercontent.com/Riley-Coyote/mnemos-mcp/main/docs/images/map.png">
</picture>

The quiet hours run your own Claude Code on its own, on your Claude plan, so
what the agent thinks over in them goes to Anthropic: its words for the hour,
short excerpts of its recent memory, its wake, and whatever it reads or recalls.
Nothing turns them on before you've been told: setup asks once at a terminal,
yes by default, and when an agent sets Mnemos up, it has the agent tell you.
With no `claude` command they stay off. To turn them off:

```bash
mnemos daemon uninstall --hours --write
```

[Privacy and security][privacy] lists each one, and how to turn it off.

## Documentation

- **[The guide][guide]:** every way to set it up, the twelve tools, the page
  and the commands behind it, what runs between sessions, the command line and
  configuration.
- **[Setup][setup]:** the production path, step by step.
- **[Privacy and security][privacy]:** what can leave your machine, and the
  boundaries Mnemos keeps.
- **[Hermes][hermes]** and **[OpenClaw][openclaw]:** Mnemos with those agents.
- **[The vision][vision]** and **[the identity model][identity]:** why it's
  built the way it is.
- **[Changelog][changelog]**

## Uninstall

`mnemos uninstall` says what it would remove, and `mnemos uninstall --write`
removes it: its hooks, its server entries for Claude Code, Codex and Claude
Desktop, and its scheduled jobs. The memories stay, in `~/.mnemos`. They're the
agent's, so deleting them is left to you.

## Contributing

[CONTRIBUTING.md][contributing] says how to set up and run the tests. Please
report a vulnerability privately, as [SECURITY.md][security] describes.

## License

[Apache-2.0][license], with a [NOTICE][notice]. Releases before 0.5.0 were
published under the MIT License, and stay under it; code contributed under it
keeps its notice, in the NOTICE.

[mind]: https://raw.githubusercontent.com/Riley-Coyote/mnemos-mcp/main/docs/images/mind.jpg
[badge-pypi]: https://img.shields.io/pypi/v/mnemos-continuity?style=flat-square&labelColor=1b1d27&color=464c6c
[badge-python]: https://img.shields.io/pypi/pyversions/mnemos-continuity?style=flat-square&labelColor=1b1d27&color=464c6c
[badge-tests]: https://img.shields.io/github/actions/workflow/status/Riley-Coyote/mnemos-mcp/release-hardening.yml?branch=main&style=flat-square&label=tests&labelColor=1b1d27
[badge-license]: https://img.shields.io/badge/license-Apache--2.0-464c6c?style=flat-square&labelColor=1b1d27
[pypi]: https://pypi.org/project/mnemos-continuity/
[tests]: https://github.com/Riley-Coyote/mnemos-mcp/actions/workflows/release-hardening.yml
[guide]: https://github.com/Riley-Coyote/mnemos-mcp/blob/main/docs/guide.md
[setup]: https://github.com/Riley-Coyote/mnemos-mcp/blob/main/SETUP.md
[privacy]: https://github.com/Riley-Coyote/mnemos-mcp/blob/main/docs/privacy-security.md
[hermes]: https://github.com/Riley-Coyote/mnemos-mcp/blob/main/HERMES_INSTALL.md
[openclaw]: https://github.com/Riley-Coyote/mnemos-mcp/blob/main/docs/openclaw-integration.md
[vision]: https://github.com/Riley-Coyote/mnemos-mcp/blob/main/docs/vision.md
[identity]: https://github.com/Riley-Coyote/mnemos-mcp/blob/main/docs/identity-model.md
[changelog]: https://github.com/Riley-Coyote/mnemos-mcp/blob/main/CHANGELOG.md
[contributing]: https://github.com/Riley-Coyote/mnemos-mcp/blob/main/CONTRIBUTING.md
[security]: https://github.com/Riley-Coyote/mnemos-mcp/blob/main/SECURITY.md
[license]: https://github.com/Riley-Coyote/mnemos-mcp/blob/main/LICENSE
[notice]: https://github.com/Riley-Coyote/mnemos-mcp/blob/main/NOTICE
