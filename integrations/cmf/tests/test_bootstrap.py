"""Bootstrap acceptance: help is inert, capabilities checked, enable is explicit."""

import contextlib
import io
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from ds4_cmf import cli
from ds4_cmf.config import load_settings
from ds4_cmf.storage.sqlite import fts5_available


class TestBootstrap(unittest.TestCase):
    def test_help_without_io_or_external_dependencies(self):
        source = Path(__file__).resolve().parents[1] / "src"
        script = '''
import os, runpy, sys
def guard(event, args):
    if event in {"socket.__new__", "socket.connect", "sqlite3.connect", "os.mkdir",
                 "os.remove", "os.rename", "os.chmod", "subprocess.Popen"}:
        raise AssertionError("help performed IO: " + event)
    if event == "open":
        _, mode, flags = args
        if (mode and any(x in mode for x in "wax+")) or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT):
            raise AssertionError("help wrote a file")
sys.addaudithook(guard)
sys.argv = ["cmf", "--help"]
runpy.run_module("ds4_cmf.cli", run_name="__main__")
'''
        env = {**os.environ, "PYTHONPATH": str(source), "PYTHONDONTWRITEBYTECODE": "1"}
        with tempfile.TemporaryDirectory(prefix="cmf-help-", dir="/tmp") as root:
            result = subprocess.run([sys.executable, "-S", "-c", script], cwd=root,
                                    env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("usage: cmf", result.stdout)
            self.assertEqual(list(Path(root).iterdir()), [])

    def test_python_and_fts_capabilities(self):
        self.assertGreaterEqual(sys.version_info[:2], (3, 12))
        self.assertTrue(sqlite3.sqlite_version)
        self.assertTrue(fts5_available())
        with mock.patch.dict(os.environ, {"DS4_CMF_ENABLED": "1"}), \
                mock.patch("ds4_cmf.storage.sqlite.fts5_available", return_value=False), \
                mock.patch("ds4_cmf.storage.eventlog.open_store") as opened, \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertNotEqual(cli.main(["serve"]), 0)
            opened.assert_not_called()

    def test_default_off_and_config_precedence(self):
        self.assertFalse(load_settings(env={}).enabled)
        with tempfile.TemporaryDirectory(prefix="cmf-config-", dir="/tmp") as root:
            config = Path(root) / "config.toml"
            config.write_text('[core]\nenabled = true\n')
            self.assertTrue(load_settings(config, env={}).enabled)
            self.assertFalse(load_settings(config, env={"DS4_CMF_ENABLED": "0"}).enabled)
            self.assertTrue(load_settings(config, env={"DS4_CMF_ENABLED": "0"},
                                          overrides={"enabled": True}).enabled)
        with mock.patch.dict(os.environ, {"DS4_CMF_ENABLED": "0"}), \
                mock.patch("ds4_cmf.storage.eventlog.open_store") as opened, \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertNotEqual(cli.main(["serve"]), 0)
            opened.assert_not_called()
