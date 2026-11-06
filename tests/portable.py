"""Platform-aware test homes and executable fakes; never a real agent."""
from pathlib import Path
import os
import shutil
import sys


def require_unix_socket() -> None:
    """Only socket-transport tests require AF_UNIX; word fallback stays tested."""
    import socket
    import pytest

    if not hasattr(socket, 'AF_UNIX'):
        pytest.skip('This Python build has no AF_UNIX; the cue uses its words fallback')


def set_home(monkeypatch, path) -> None:
    """Point both POSIX and Windows home discovery at the test's folder."""
    monkeypatch.setenv('HOME', str(path))
    monkeypatch.setenv('USERPROFILE', str(path))


def fake_claude(tmp_path: Path) -> str:
    """Run the same Python fake through a Windows command wrapper if needed."""
    script = Path(__file__).with_name('fake_claude.py').resolve()
    if os.name != 'nt':
        return str(script)
    wrapper = tmp_path / 'fake-claude.cmd'
    wrapper.write_text(f'@"{sys.executable}" "{script}" %*\n', encoding='utf-8')
    return str(wrapper)


def python_command(path: Path, code: str) -> Path:
    """Make a Python fake discoverable on PATH with the same logical argv[0]."""
    if os.name != 'nt':
        path.write_text('#!' + sys.executable + '\n' + code, encoding='utf-8')
        path.chmod(0o755)
        return path
    from distlib.scripts import ScriptMaker

    maker = ScriptMaker(None, str(path.parent))
    maker.executable = sys.executable
    bootstrap = ('import sys\nsys.argv[0] = ' + repr(str(path)) + '\n'
                 + 'exec(compile(' + repr(code) + ', sys.argv[0], "exec"))\n').encode('utf-8')
    files = []
    maker._write_script({path.name}, maker._get_shebang('utf-8'), bootstrap, files, 'py')
    return Path(shutil.which(path.name, path=str(path.parent)) or files[0])
