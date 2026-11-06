"""Hook stdin is a Windows pipe, not a socket (regression for issue #8).

These subprocess tests deliberately keep one writer open and deliver another
payload late. Reading from an empty pipe must finish within the timeout,
without a background reader thread leaking into later hook invocations.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

import pytest


_CHILD = """
import json, os, sys, time
from mnemos.cue import stdin_ready, read_payload
mode = sys.argv[1]
deadline = time.monotonic() + float(sys.argv[2])
if mode == 'payload':
    data = read_payload(sys.stdin, deadline=deadline)
    print(json.dumps({'payload': data.decode('utf-8')}), flush=True)
else:
    ready = stdin_ready(sys.stdin.fileno(), float(sys.argv[2]))
    data = os.read(sys.stdin.fileno(), 65536) if ready else None
    print(json.dumps({
        'ready': ready,
        'data': data.decode('utf-8') if data is not None else None,
    }), flush=True)
"""


def _pipe_case(*, mode="ready", timeout=0.35, parts=(), close=False):
    child = subprocess.Popen(
        [sys.executable, "-c", _CHILD, mode, str(timeout)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert child.stdin is not None
    try:
        for delay, payload in parts:
            time.sleep(delay)
            child.stdin.write(payload)
            child.stdin.flush()
        if close:
            child.stdin.close()
        assert child.wait(timeout=5) == 0, child.stderr.read().decode()
        assert child.stdout is not None
        return json.loads(child.stdout.read().decode())
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        if child.stdin and not child.stdin.closed:
            child.stdin.close()
        if child.stdout:
            child.stdout.close()
        if child.stderr:
            child.stderr.close()


@pytest.mark.skipif(sys.platform != "win32", reason="Windows anonymous pipe regression")
def test_windows_pipe_is_ready_when_json_arrives():
    data = _pipe_case(parts=[(0, b'{"a":1}')], close=True)
    assert data == {"ready": True, "data": '{"a":1}'}


@pytest.mark.skipif(sys.platform != "win32", reason="Windows anonymous pipe regression")
def test_windows_pipe_open_and_empty_times_out():
    data = _pipe_case(timeout=0.18)
    assert data == {"ready": False, "data": None}


@pytest.mark.skipif(sys.platform != "win32", reason="Windows anonymous pipe regression")
def test_windows_pipe_closed_returns_eof_not_hang():
    data = _pipe_case(close=True)
    assert data == {"ready": True, "data": ""}


@pytest.mark.skipif(sys.platform != "win32", reason="Windows anonymous pipe regression")
def test_windows_pipe_handles_late_payload():
    data = _pipe_case(timeout=0.45, parts=[(0.10, b'{"b":2}')], close=True)
    assert data == {"ready": True, "data": '{"b":2}'}


@pytest.mark.skipif(sys.platform != "win32", reason="Windows anonymous pipe regression")
def test_windows_read_payload_reassembles_json_chunks():
    data = _pipe_case(
        mode="payload", timeout=0.60,
        parts=[(0, b'{"session_id":'), (0.05, b'"late"}')], close=True,
    )
    assert json.loads(data["payload"]) == {"session_id": "late"}


def test_posix_pipe_readiness_still_uses_select():
    if os.name == "nt":
        pytest.skip("Windows pipes tested above")
    from mnemos.cue import stdin_ready

    reader, writer = os.pipe()
    try:
        assert stdin_ready(reader, 0.01) is False
        os.write(writer, b"x")
        assert stdin_ready(reader, 0.01) is True
        assert os.read(reader, 1) == b"x"
    finally:
        os.close(reader)
        os.close(writer)
