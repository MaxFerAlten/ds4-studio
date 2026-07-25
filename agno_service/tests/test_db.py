"""Test the database module."""

import pytest
from pathlib import Path
from unittest.mock import MagicMock
from ds4_agno.db import create_db
from agno.db.sqlite import SqliteDb


def test_create_db_creates_parent_directory(tmp_path):
    db_file = tmp_path / "subdir" / "test.db"
    db = create_db(MagicMock(db_file=db_file))
    assert db_file.parent.exists()
    assert db is not None


def test_create_db_returns_sqlitedb_instance(tmp_path):
    db_file = tmp_path / "agno.db"
    db = create_db(MagicMock(db_file=db_file))
    assert isinstance(db, SqliteDb)
    assert db.db_file == str(db_file)
