"""Native Quiet Hours use the same cross-process lock on Windows and POSIX."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

import pytest

from mnemos import portable_flock


_CHILD = """
from mnemos import portable_flock as lock
import sys
with open(sys.argv[1], 'a') as handle:
    try:
        lock.flock(handle, lock.LOCK_EX | lock.LOCK_NB)
    except BlockingIOError:
        print('busy')
    else:
        print('acquired')
        lock.flock(handle, lock.LOCK_UN)
"""


def _child(path: Path) -> str:
    result = subprocess.run(
        [sys.executable, "-c", _CHILD, str(path)],
        capture_output=True,
        text=True,
        timeout=6,
        check=True,
    )
    return result.stdout.strip()


def test_hour_lock_blocks_concurrent_process_and_releases(tmp_path):
    path = tmp_path / "hours.lock"
    with path.open("a") as lock:
        portable_flock.flock(lock, portable_flock.LOCK_EX | portable_flock.LOCK_NB)
        assert _child(path) == "busy"
        portable_flock.flock(lock, portable_flock.LOCK_UN)
    assert _child(path) == "acquired"


def test_hour_lock_reacquires_same_file(tmp_path):
    path = tmp_path / "hours.lock"
    with path.open("a") as lock:
        portable_flock.flock(lock, portable_flock.LOCK_EX | portable_flock.LOCK_NB)
        portable_flock.flock(lock, portable_flock.LOCK_UN)
        portable_flock.flock(lock, portable_flock.LOCK_EX | portable_flock.LOCK_NB)
        portable_flock.flock(lock, portable_flock.LOCK_UN)


def test_native_hour_module_and_companion_can_import():
    # On Windows this failed at import fcntl before any Quiet Hours could run.
    from mnemos import life
    from mnemos.companion.export import Exporter

    assert callable(life.run_hour)
    assert Exporter.hours_dir.fget is not None


@pytest.mark.parametrize('content', [b'', b'old lock\x00'])
def test_lock_never_changes_the_file(tmp_path, content):
    path = tmp_path / 'old.lock'
    path.write_bytes(content)
    with path.open('a') as handle:
        portable_flock.flock(handle, portable_flock.LOCK_EX | portable_flock.LOCK_NB)
        portable_flock.flock(handle, portable_flock.LOCK_UN)
    assert path.read_bytes() == content


def test_lock_is_released_when_holder_is_killed(tmp_path):
    path = tmp_path / 'crash.lock'
    child = subprocess.Popen([
        sys.executable, '-c',
        "from mnemos import portable_flock as f; import sys; "
        "h=open(sys.argv[1], 'a'); f.flock(h, f.LOCK_EX|f.LOCK_NB); "
        "print('locked', flush=True); sys.stdin.read()", str(path),
    ], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        assert child.stdout.readline().strip() == b'locked'
        assert _child(path) == 'busy'
        child.kill()
        child.wait(timeout=5)
        assert _child(path) == 'acquired'
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        child.stdin.close()
        child.stdout.close()
