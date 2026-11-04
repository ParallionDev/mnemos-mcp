"""Hermes' memory provider is read from the `memory:` block (0.7.0).

Without PyYAML the installer fell back to the first `provider:` line in
config.yaml, which is the model's (`model: provider: openai-codex`), and took
it for the memory provider. `mnemos connect hermes` decides whether it may
take the memory-provider slot from this, so a misread would have replaced
(or spared) the wrong thing.
"""

from __future__ import annotations

import sys


def test_the_memory_provider_is_read_from_the_memory_block_not_the_model_block(tmp_path, monkeypatch):
    from mnemos.integrations.hermes.installer import _read_active_provider

    monkeypatch.setitem(sys.modules, "yaml", None)  # import yaml fails
    config = tmp_path / "config.yaml"
    config.write_text(
        "model:\n  default: x\n  provider: openai-codex\nmemory:\n  memory_enabled: true\n"
        "  provider: honcho  # their choice\nother:\n  provider: nope\n"
    )
    assert _read_active_provider(config) == "honcho"
    config.write_text("model:\n  provider: openai-codex\nmemory:\n  memory_enabled: true\n")
    assert _read_active_provider(config) == ""
