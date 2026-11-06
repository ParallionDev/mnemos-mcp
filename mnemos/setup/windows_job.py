"""Headless action used only by Mnemos's Windows Task Scheduler backend."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import subprocess
import sys

from ..file_security import secure_directory
from ..process_guard import ProcessGuard

log = logging.getLogger(__name__)


def run(config: str | Path) -> int:
    """Execute a generated argv with its scoped environment and append log."""
    data = json.loads(Path(config).read_text(encoding='utf-8'))
    argv = data['argv']
    if not isinstance(argv, list) or not argv or not all(isinstance(v, str) and '\0' not in v for v in argv):
        raise ValueError('Invalid scheduled argv')
    env = {**os.environ, **data.get('environment', {}), 'PYTHONUTF8': '1', 'MNEMOS_DISABLE_DOTENV': '1'}
    log = Path(data['log'])
    secure_directory(log.parent)
    with log.open('ab') as output:
        child = subprocess.Popen(
            argv, cwd=data['working_dir'], env=env, stdin=subprocess.DEVNULL,
            stdout=output, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        guard = ProcessGuard(child)
        try:
            return child.wait(timeout=data.get('timeout_seconds', 7100))
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            guard.stop()
            child.wait(timeout=10)
            return 1
        finally:
            guard.close()


def main() -> int:
    """Run exactly one manifest named by Task Scheduler."""
    if len(sys.argv) != 2:
        return 2
    return run(sys.argv[1])


if __name__ == '__main__':
    raise SystemExit(main())
