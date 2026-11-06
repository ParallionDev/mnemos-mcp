"""Native Windows plans, rollback, status, and headless actions. OS calls are fake."""
from datetime import datetime
import io
import json
from pathlib import Path
import sys
import time
import xml.etree.ElementTree as ET

import pytest

from mnemos import cli, life
from mnemos.companion.export import Exporter
from mnemos.setup import scheduler, windows_tasks, windows_job
from mnemos.simple_runtime import MnemosRuntime
from mnemos.store.sqlite_store import EngramStore
from tests.portable import fake_claude


def _plan(tmp_path, agent='windows-test'):
    return scheduler.plan(agent_id=agent, mnemos_command=str(Path(sys.executable).with_name('mnemos.exe')),
                          scope_args=('--agent-id', agent, '--db-path', str(tmp_path / 'memory.db')),
                          backend='windows', has_model=False, hour_env={})


def test_windows_is_a_native_backend_without_cron(monkeypatch):
    monkeypatch.setattr('shutil.which', lambda _: None)
    assert scheduler.detect_backend('win32') == 'windows'
    assert scheduler.detect_backend('windows') == 'windows'


@pytest.mark.parametrize('job', [*scheduler.JOBS, *scheduler.HOUR_JOBS])
def test_xml_uses_local_time_hidden_unprivileged_action_and_no_overlap(tmp_path, job):
    config = tmp_path / 'space & unicode é' / 'task.json'
    xml = windows_tasks.task_xml(job, config, str(tmp_path), now=datetime(2026, 11, 6, 1))
    root = ET.fromstring(xml)
    text = lambda name: root.find('.//{*}' + name).text
    assert text('LogonType') == 'InteractiveToken'
    assert text('RunLevel') == 'LeastPrivilege'
    assert text('Hidden') == 'true'
    assert text('WakeToRun') == 'false'
    assert text('StartWhenAvailable') == 'true'
    assert text('MultipleInstancesPolicy') == 'IgnoreNew'
    assert text('Command').endswith('pythonw.exe')
    assert text('Arguments') == subprocess_args(config)
    assert '+' not in text('StartBoundary') and not text('StartBoundary').endswith('Z')
    if job.daily_at:
        assert windows_tasks.daily_at({'xml': xml}) == job.daily_at
    else:
        assert text('Interval') == 'PT14400S'


def subprocess_args(config):
    import subprocess

    return subprocess.list2cmdline(['-m', 'mnemos.setup.windows_job', str(config)])


def test_install_replace_status_and_uninstall_are_idempotent(tmp_path, monkeypatch, os_scheduler, capsys):
    monkeypatch.setattr(scheduler, 'detect_backend', lambda system=None: 'windows')
    monkeypatch.setenv('MNEMOS_CLAUDE_BIN', fake_claude(tmp_path))
    db = tmp_path / 'memory.db'
    EngramStore(db).close()
    scope = ['--agent-id', 'windows-test', '--db-path', str(db)]
    command = [*scope, 'daemon', 'install', '--hours', '--write']
    assert cli.main(command) == 0
    assert len(os_scheduler.windows) == 5
    assert cli.main(command + ['--mine-at', '08:15']) == 0
    assert len(os_scheduler.windows) == 5
    exported = Exporter.for_scope(db_path=str(db), agent_id='windows-test')
    schedule = exported.schedule()
    assert len(schedule) == 3
    assert all(entry['loaded'] for entry in schedule)
    assert next(entry['when'] for entry in schedule if entry['kind'] == 'mine') == {'Hour': 8, 'Minute': 15}
    assert cli.main([*scope, 'daemon', 'status']) == 0
    assert 'daily at 08:15' in capsys.readouterr().out
    assert cli.main([*scope, 'daemon', 'uninstall', '--hours', '--write']) == 0
    assert len(os_scheduler.windows) == 2
    assert cli.main([*scope, 'daemon', 'uninstall', '--write']) == 0
    assert cli.main([*scope, 'daemon', 'uninstall', '--write']) == 0
    assert os_scheduler.windows == {}
    assert not list((Path.home() / '.mnemos/tasks/windows').glob('*.json'))


def test_failed_registration_restores_existing_tasks_and_removes_new_ones(tmp_path, monkeypatch, os_scheduler):
    plan = _plan(tmp_path)
    first, second = plan['entries']
    scheduler.apply_windows([first])
    original = dict(os_scheduler.windows)
    manifest = first['path'].read_bytes()
    real_fake = os_scheduler.windows_register

    def fail(name, xml):
        if name == second['task_name']:
            raise RuntimeError('registration rejected')
        real_fake(name, xml)

    monkeypatch.setattr(windows_tasks, 'register', fail)
    with pytest.raises(RuntimeError, match='registration rejected'):
        scheduler.apply_windows(plan['entries'])
    assert os_scheduler.windows == original
    assert first['path'].read_bytes() == manifest
    assert not second['path'].exists()


def test_tasks_are_separate_per_agent_and_uninstall_finds_orphans(tmp_path, os_scheduler):
    a, b = _plan(tmp_path, 'a/b'), _plan(tmp_path, 'a_b')
    assert a['entries'][0]['task_name'] != b['entries'][0]['task_name']
    scheduler.apply_windows(a['entries'] + b['entries'])
    for entry in a['entries']:
        entry['path'].unlink()
    found = scheduler.installed(a, a['entries'])
    assert len(found) == 2
    cli._unschedule('windows', found)
    assert len(os_scheduler.windows) == 2


def test_headless_worker_passes_environment_and_utf8_without_a_shell(tmp_path):
    log = tmp_path / 'worker.log'
    manifest = tmp_path / 'worker.json'
    manifest.write_text(json.dumps({'argv': [sys.executable, '-c',
                        'import os; print(os.environ["CHECK"]); print(os.getcwd())'],
                        'working_dir': str(tmp_path), 'environment': {'CHECK': 'Mémoire'},
                        'log': str(log)}), encoding='utf-8')
    assert windows_job.run(manifest) == 0
    assert log.read_text(encoding='utf-8').splitlines() == ['Mémoire', str(tmp_path)]


def test_headless_worker_timeout_stops_the_tree(tmp_path):
    manifest = tmp_path / 'timeout.json'
    manifest.write_text(json.dumps({'argv': [sys.executable, '-c', 'import time; time.sleep(30)'],
                        'working_dir': str(tmp_path), 'log': str(tmp_path / 'timeout.log'),
                        'timeout_seconds': 0.3}), encoding='utf-8')
    started = time.monotonic()
    assert windows_job.run(manifest) == 1
    assert time.monotonic() - started < 5


def test_codex_never_falls_back_to_claude_and_cannot_schedule_hours(tmp_path, monkeypatch, os_scheduler):
    monkeypatch.setattr(scheduler, 'detect_backend', lambda system=None: 'windows')
    monkeypatch.setenv('MNEMOS_CLAUDE_BIN', fake_claude(tmp_path))
    db = tmp_path / 'gpt.db'
    runtime = MnemosRuntime(db_path=str(db), agent_id='custom', person_id='eli', project_scope='port',
                            use_dedicated_model=False)
    runtime.capture('A disposable fixture, not words from a real model run.', signed_as='gpt-6.1-sol')
    runtime.close()
    assert life.configured_runner('custom', str(db), person_id='eli', project_scope='port') == 'codex'
    scope = ['--agent-id', 'custom', '--db-path', str(db), '--person-id', 'eli', '--project-scope', 'port']
    assert cli.main([*scope, 'daemon', 'install', '--hours', '--write']) == 1
    assert len(os_scheduler.windows) == 2  # upkeep only
    exporter = Exporter.for_scope(db_path=str(db), agent_id='custom', person_id='eli', project_scope='port')
    status = exporter.hours_runner()
    assert status['runner'] == 'codex' and not status['available']
    assert 'apply_patch' in status['reason']
    assert exporter.schedule() == []
    record = life.run_hour('mine', db_path=str(db), agent_id='custom', runner='codex', out=io.StringIO())
    assert record['status'] == 'failed' and record['id'] == ''
    assert not (life.hours_dir('custom') / 'hours.jsonl').exists()


def test_native_handoff_is_visible_and_never_reported_as_executed(tmp_path):
    from datetime import timezone
    from mnemos.interface.context_packet import _latest_hour

    db = tmp_path / 'handoff.db'
    EngramStore(db).close()
    scope = {'agent_id': 'codex', 'person_id': 'eli', 'project_scope': 'port'}
    record = life.run_hour('mine', db_path=str(db), **scope, handoff=True, out=io.StringIO())
    assert record['handoff'] is True
    exporter = Exporter.for_scope(db_path=str(db), **scope)
    exported, _ = exporter.export()
    assert exported['hours'][0]['id'] == record['id']
    assert exported['hours'][0]['handoff'] is True
    store = EngramStore(db)
    try:
        assert _latest_hour(store, scope, 'gpt-6.1-sol', datetime.now(timezone.utc)) is None
    finally:
        store.close()


def test_runner_detection_leaves_an_idle_database_and_its_folder_unchanged(tmp_path):
    import hashlib

    db = tmp_path / 'cold.db'
    runtime = MnemosRuntime(db_path=str(db), agent_id='custom', use_dedicated_model=False)
    runtime.capture('Disposable provenance fixture.', signed_as='gpt-6.1-sol')
    runtime.close()
    before = sorted(p.name for p in tmp_path.iterdir())
    digest = hashlib.sha256(db.read_bytes()).hexdigest()
    assert life.configured_runner('custom', str(db)) == 'codex'
    assert sorted(p.name for p in tmp_path.iterdir()) == before
    assert hashlib.sha256(db.read_bytes()).hexdigest() == digest


def test_scheduler_unavailable_does_not_hide_memory_or_claim_hours_are_off(tmp_path, monkeypatch):
    db = tmp_path / 'available-memory.db'
    runtime = MnemosRuntime(db_path=str(db), agent_id='codex', use_dedicated_model=False)
    runtime.capture('Memory remains visible when the scheduler is unavailable.', signed_as='validation-fixture')
    runtime.close()
    monkeypatch.setattr(scheduler, 'detect_backend', lambda system=None: 'windows')

    def unavailable(name):
        raise RuntimeError('service unavailable')

    monkeypatch.setattr(windows_tasks, 'query', unavailable)
    exported, memories = Exporter.for_scope(db_path=str(db), agent_id='codex').export()
    assert len(memories['memories']) == 1
    assert exported['schedule'] == []
    assert exported['scheduleError'] == 'Windows Task Scheduler status is unavailable.'
