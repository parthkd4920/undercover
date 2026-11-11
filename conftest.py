"""Shared fixtures for the backend's and the agent's tests."""

from contextlib import closing

import pytest

from backend import database, seed


@pytest.fixture(autouse=True)
def fresh_database(tmp_path, monkeypatch):
    """Give every test its own freshly seeded database."""
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "undercover-test.db"))
    with closing(database.connect()) as connection:
        seed.seed(connection)
