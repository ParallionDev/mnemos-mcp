"""A small cross-platform advisory lock for Mnemos Quiet Hours.

POSIX keeps fcntl.flock. Windows uses a one-byte region with msvcrt.locking,
at byte zero of the same .lock file used by the Unix runner. Windows permits
locking beyond EOF, so even an empty file needs no unsynchronized write.
"""
from __future__ import annotations

import errno
import logging
import os
from typing import IO

log = logging.getLogger(__name__)

LOCK_EX = 2
LOCK_NB = 4
LOCK_UN = 8


def flock(stream: IO[str] | IO[bytes], operation: int) -> None:
    """Acquire or release the hour's process lock.

    The current runner uses only exclusive nonblocking acquire and unlock.
    A losing Windows lock attempt raises BlockingIOError like POSIX flock.
    """
    if os.name != "nt":
        import fcntl

        fcntl.flock(stream, operation)
        return

    import msvcrt

    fd = stream.fileno()
    if operation & LOCK_UN:
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        return
    if not (operation & LOCK_EX):
        raise ValueError("Mnemos Quiet Hours require an exclusive lock")

    # _locking permits bytes beyond EOF. Writing a sentinel before locking
    # would race another process acquiring a newly created, empty file.
    os.lseek(fd, 0, os.SEEK_SET)
    mode = msvcrt.LK_NBLCK if operation & LOCK_NB else msvcrt.LK_LOCK
    try:
        msvcrt.locking(fd, mode, 1)
    except OSError as exc:
        if operation & LOCK_NB and exc.errno in (
            errno.EACCES, errno.EAGAIN, errno.EDEADLOCK,
        ):
            raise BlockingIOError(exc.errno, "Another Mnemos hour is running") from exc
        raise
