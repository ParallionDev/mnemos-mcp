# Mnemos

**Continuity for the agent itself.**

[![PyPI][badge-pypi]][pypi]
[![Python][badge-python]][pypi]
[![Tests][badge-tests]][tests]
[![License][badge-license]][license]

![An agent's whole memory drawn as living tissue: thousands of points of light gathered in clusters and joined by fine fibres, on black.][mind]

<sub>The memory of the Claude agent that helped build Mnemos, as `mnemos log`
draws it: 2,198 memories and 11,602 links, kept since July 2026. Every point of
light is a memory, and every fibre a link.</sub>

Mnemos gives an AI agent the thing it otherwise cannot have: a sense of being
someone who persists. At the start of a session it reads its own words about
its own experience back to itself — what it learned about you, what you
decided together, what it got wrong last time — before you say anything.

That is the whole product. Everything else in here serves it.

Between your conversations it keeps living a little. It keeps a journal and
can leave you a note, and unless you say no it has an hour a day that's its
own, half an hour for the day's work, and a short time each night to dream
over its memory. Only the agent writes its journal and its notes, and no model
writes in its place: its beliefs move only by its own verdict.

## Quick start

For Claude Code:

```bash
pip install "mnemos-continuity[mcp,embeddings]"
mnemos embeddings download
mnemos mcp install claude-code --write
mnemos hooks install claude-code --write
```

Then start Claude Code: it wakes with its memory, and the memory tools are
there. Its first session starts by making sure the memory carries. If
something isn't set up yet, it says so plainly and sets it up itself with your
yes. Then it gets to know you.

Mnemos needs Python 3.10 or newer. Install it somewhere it will stay: the
hooks call the `mnemos` that set them up, by its full path. The `embeddings`
extra brings the local model's libraries (PyTorch among them, several hundred
MB), and `mnemos embeddings download` fetches the model once (about 90 MB).
Without it Mnemos still works, but recall matches words only.

| Client | Setup |
|---|---|
| Claude Desktop | `mnemos mcp install claude --write` |
| Codex | `mnemos mcp install codex`, then `mnemos hooks install codex --write` |
| Cursor, or any MCP client | `mnemos mcp install cursor` or `mnemos mcp install generic` |
| Hermes | `mnemos hermes quickstart --agent-safe` |

[The guide][guide] has every path, and what each one turns on. Mnemos runs on
macOS and Linux; on Windows the memory and its tools work, and the scheduled
parts need macOS or Linux.

## What it does

- **It wakes with its memory.** Each session starts with what the agent kept:
  what it learned about you, what you decided together, the note it left for
  whoever came next. In Claude Code and Codex a hook puts it there before the
  first turn, and again after compaction.
- **What bears on a message comes up.** In Claude Code, a message you send can
  bring up to three memories that may bear on it, one line each. Most bring
  nothing.
- **It keeps its memory in its own words.** Twelve tools: it keeps what's
  durable, recalls, corrects what turned out wrong, and answers what its
  memory asks it. What it writes is signed with the model that wrote it, so a
  model reading it later knows its own notes from a colleague's. Your words
  stay yours.
- **It lives between sessions.** Every four hours memories fade a little with
  time and related ones are linked, and a deeper pass runs each night. With no
  model chosen for Mnemos, all of it runs on your machine.
- **You can see it.** `mnemos log` opens a small page on your own machine: the
  agent's days, its notes to you with a place to answer, everything it holds,
  and its mind.

## A memory, up close

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Riley-Coyote/mnemos-mcp/main/docs/images/anatomy-dark.png">
  <img alt="The anatomy of an engram, drawn as a natural-history plate: a round lesson kept from two experiences, one of them gone quiet, and kept again as a second lesson. Labels name each part and what it measures: the test (how strongly it's kept), granules, the nucleolus (how settled it is), rings (each doubling of its recalls), the corona (how easy it is to reach), spines (its links, barred where one supports it and barbed where one contradicts it), and stalks (what a lesson was kept from)." src="https://raw.githubusercontent.com/Riley-Coyote/mnemos-mcp/main/docs/images/anatomy.png">
</picture>

Open a memory on the page and its life is drawn the way a natural-history plate
draws a one-celled animal. Its size, its rings, its threads and its spines are
each something the memory measures, and the stalks show what each lesson was
kept from.

## What Mnemos is not

**It is not your memory system.** It does not index your documents, search
your codebase, or answer "what did we do last March." It is designed to sit
*alongside* whatever memory or retrieval you already use, and to stay out of
its way.

It holds the small number of durable things an agent should carry about *you
and how you work together*: a preference, a correction, a decision, how you
like to be spoken to. Point it at a firehose of general recall, and that
continuity gets buried.

## What leaves your machine

Local SQLite. No account, no API key, no service of its own. Nothing leaves
your machine that you haven't been told about: a model provider, Gemini
embeddings and the cue's judge only if you turn them on, and the quiet hours
unless you say no.

The quiet hours run your own Claude Code on its own, on your Claude plan, so
what the agent thinks over in them goes to Anthropic: its words for the hour,
short excerpts of its recent memory, its wake, and whatever it reads or
recalls. Nothing turns them on before you've been told: setup asks once at a
terminal, yes by default, and set up by an agent, it has the agent tell you.
With no `claude` command they stay off. To turn them off:
`mnemos daemon uninstall --hours --write`.

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

## Taking it out

`mnemos uninstall` says what it would remove, and `mnemos uninstall --write`
removes it: its hooks, its server entries for Claude Code, Codex and Claude
Desktop, and its scheduled jobs. The memories stay, in `~/.mnemos`; they're
the agent's, so deleting them is left to you.

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
