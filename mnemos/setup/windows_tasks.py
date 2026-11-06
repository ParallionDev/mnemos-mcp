"""Task Scheduler operations for the native scheduler, under the current SID.

    Tasks use InteractiveToken and LeastPrivilege: no password is stored, and
    the user must be logged in. The action is pythonw, not a visible terminal.
"""
from __future__ import annotations

from datetime import datetime, timedelta
import base64
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .scheduler import SchedulerJob

log = logging.getLogger(__name__)
NS = 'http://schemas.microsoft.com/windows/2004/02/mit/task'
ET.register_namespace('', NS)


def task_xml(job: SchedulerJob, config: Path, working_dir: str, *, now: datetime | None = None) -> str:
    """A local-time, headless, least-privilege task; no overlapping instances."""
    now = now or datetime.now()
    root = ET.Element(f'{{{NS}}}Task', version='1.2')

    def child(parent, tag, text=None, **attrs):
        node = ET.SubElement(parent, f'{{{NS}}}{tag}', attrs)
        node.text = text
        return node

    registration = child(root, 'RegistrationInfo')
    child(registration, 'Description', 'Mnemos: ' + job.description)
    triggers = child(root, 'Triggers')
    if job.daily_at is not None:
        trigger = child(triggers, 'CalendarTrigger')
        boundary = now.replace(hour=job.daily_at[0], minute=job.daily_at[1], second=0, microsecond=0)
        if boundary <= now:
            boundary += timedelta(days=1)
        child(trigger, 'StartBoundary', boundary.isoformat(timespec='seconds'))
        child(trigger, 'Enabled', 'true')
        child(child(trigger, 'ScheduleByDay'), 'DaysInterval', '1')
    else:
        trigger = child(triggers, 'TimeTrigger')
        repeat = child(trigger, 'Repetition')
        child(repeat, 'Interval', f'PT{job.interval_seconds}S')
        child(repeat, 'StopAtDurationEnd', 'false')
        child(trigger, 'StartBoundary', (now + timedelta(seconds=30)).isoformat(timespec='seconds'))
        child(trigger, 'Enabled', 'true')
    principal = child(child(root, 'Principals'), 'Principal', id='User')
    child(principal, 'UserId', '__MNEMOS_CURRENT_SID__')
    child(principal, 'LogonType', 'InteractiveToken')
    child(principal, 'RunLevel', 'LeastPrivilege')
    settings = child(root, 'Settings')
    for name, value in (
        ('MultipleInstancesPolicy', 'IgnoreNew'), ('DisallowStartIfOnBatteries', 'false'),
        ('StopIfGoingOnBatteries', 'false'), ('StartWhenAvailable', 'true'),
        ('RunOnlyIfNetworkAvailable', 'false'), ('Enabled', 'true'), ('Hidden', 'true'),
        ('WakeToRun', 'false'), ('ExecutionTimeLimit', 'PT2H'),
    ):
        child(settings, name, value)
    action = child(child(root, 'Actions', Context='User'), 'Exec')
    pythonw = Path(sys.executable).with_name('pythonw.exe')
    child(action, 'Command', str(pythonw))
    child(action, 'Arguments', subprocess.list2cmdline(['-m', 'mnemos.setup.windows_job', str(config)]))
    child(action, 'WorkingDirectory', working_dir)
    return ET.tostring(root, encoding='unicode')


_COMMON = r'''
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$data = [Console]::In.ReadToEnd() | ConvertFrom-Json
$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$folderPath = '\Mnemos\' + $sid
function IsMissing($failure) {
    $e = $failure.Exception
    while ($null -ne $e) {
        if ($e.HResult -eq -2147024894) { return $true }
        $e = $e.InnerException
    }
    return $false
}
'''


def _run(script: str, data: dict) -> dict | None:
    """Run a fixed COM operation. Data goes over stdin, never into code."""
    if os.name != 'nt':
        raise RuntimeError('Windows Task Scheduler requires Windows')
    command = base64.b64encode((_COMMON + script).encode('utf-16-le')).decode('ascii')
    result = subprocess.run(
        ['powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
         '-EncodedCommand', command],
        input=json.dumps(data), capture_output=True, text=True, encoding='utf-8',
        timeout=20, creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if result.returncode:
        raise RuntimeError('Windows Task Scheduler: ' + (result.stderr or result.stdout).strip()[-800:])
    return json.loads(result.stdout.strip()) if result.stdout.strip() else None


def query(name: str) -> dict | None:
    """Read this user's task, including the OS definition and last result."""
    return _run(r'''
try { $task = $service.GetFolder($folderPath).GetTask($data.name) }
catch {
    if (IsMissing $_) { return }
    throw
}
@{ xml=$task.Xml; enabled=[bool]$task.Enabled; state=[int]$task.State;
   last_result=[long]$task.LastTaskResult; last_run=$task.LastRunTime.ToString('s');
   next_run=$task.NextRunTime.ToString('s') } | ConvertTo-Json -Compress
''', {'name': name})


def register(name: str, xml: str) -> None:
    """Create or replace only this user's named task, without credentials."""
    _run(r'''
$root = $service.GetFolder('\')
try { $parent = $service.GetFolder('\Mnemos') }
catch { $parent = $root.CreateFolder('Mnemos', $null) }
try { $folder = $service.GetFolder($folderPath) }
catch { $folder = $parent.CreateFolder($sid, $null) }
$xml = $data.xml.Replace('__MNEMOS_CURRENT_SID__', $sid)
$null = $folder.RegisterTask($data.name, $xml, 6, $sid, $null, 3, $null)
''', {'name': name, 'xml': xml})


def remove(name: str) -> None:
    """Stop and remove this user's task; already absent is success."""
    _run(r'''
try { $folder = $service.GetFolder($folderPath); $task = $folder.GetTask($data.name) }
catch {
    if (IsMissing $_) { return }
    throw
}
$task.Stop(0)
$folder.DeleteTask($data.name, 0)
if ($folder.GetTasks(1).Count -eq 0) {
    $service.GetFolder('\Mnemos').DeleteFolder($sid, 0)
}
''', {'name': name})


def daily_at(info: dict | None) -> tuple[int, int] | None:
    """Read the task's actual daily time, rather than a newly generated plan."""
    if not info:
        return None
    try:
        boundary = ET.fromstring(info['xml']).find(f'.//{{{NS}}}CalendarTrigger/{{{NS}}}StartBoundary')
        when = datetime.fromisoformat(boundary.text)
        return when.hour, when.minute
    except (ET.ParseError, ValueError, AttributeError, KeyError, TypeError):
        return None
