"""Stop a runner's descendants as well as its launcher on Windows."""
from __future__ import annotations

import os
import logging
import subprocess

log = logging.getLogger(__name__)


class ProcessGuard:
    """Own a Windows kill-on-close job before sending a runner its prompt.

    A .cmd launcher has a Python/agent child. Terminating only the launcher
    leaves that child holding stdout open, and a timeout waits for it anyway.
    Failure to establish the job stops the process rather than running unguarded.
    """

    def __init__(self, process: subprocess.Popen) -> None:
        self.process = process
        self.handle = None
        if os.name != 'nt':
            return
        import ctypes as c
        from ctypes import wintypes as w

        class Basic(c.Structure):
            _fields_ = [('process_time', c.c_longlong), ('job_time', c.c_longlong),
                        ('flags', w.DWORD), ('min_working', c.c_size_t),
                        ('max_working', c.c_size_t), ('active', w.DWORD),
                        ('affinity', c.c_size_t), ('priority', w.DWORD),
                        ('scheduling', w.DWORD)]

        class Limits(c.Structure):
            _fields_ = [('basic', Basic), ('io', c.c_ulonglong * 6),
                        ('process_memory', c.c_size_t), ('job_memory', c.c_size_t),
                        ('peak_process', c.c_size_t), ('peak_job', c.c_size_t)]

        api = self.api = c.WinDLL('kernel32', use_last_error=True)
        api.CreateJobObjectW.argtypes = [c.c_void_p, w.LPCWSTR]
        api.CreateJobObjectW.restype = w.HANDLE
        api.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
        api.SetInformationJobObject.restype = w.BOOL
        api.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        api.AssignProcessToJobObject.restype = w.BOOL
        api.TerminateJobObject.argtypes = [w.HANDLE, w.UINT]
        api.TerminateJobObject.restype = w.BOOL
        api.CloseHandle.argtypes = [w.HANDLE]
        api.CloseHandle.restype = w.BOOL
        handle = api.CreateJobObjectW(None, None)
        try:
            if not handle:
                raise c.WinError(c.get_last_error())
            limits = Limits()
            limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not api.SetInformationJobObject(handle, 9, c.byref(limits), c.sizeof(limits)):
                raise c.WinError(c.get_last_error())
            if not api.AssignProcessToJobObject(handle, int(process._handle)):
                raise c.WinError(c.get_last_error())
            self.handle = handle
        except BaseException:
            if handle:
                api.CloseHandle(handle)
            process.kill()
            process.wait()
            raise

    def stop(self) -> None:
        """Terminate the guarded tree, or the direct process on POSIX."""
        if self.handle is not None:
            self.api.TerminateJobObject(self.handle, 1)
        elif self.process.poll() is None:
            self.process.terminate()

    def close(self) -> None:
        """Release the job, killing descendants still alive after the runner."""
        if self.handle is not None:
            self.api.CloseHandle(self.handle)
            self.handle = None
