"""Tests for the database and its seed."""

import json
import sqlite3
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient

from backend import database, seed
from backend.main import app

EXPECTED_COUNTS = {
    "claims": 25,
    "policies": 50,
    "customers": 49,
    "plans": 3,
    "add_ons": 3,
    "handlers": 3,
}


def seeded_counts(connection: sqlite3.Connection) -> dict[str, int]:
    """Return the row counts the seed leaves in each table."""
    return {
        "claims": connection.execute("SELECT COUNT(*) FROM claims").fetchone()[0],
        "policies": connection.execute("SELECT COUNT(*) FROM policies").fetchone()[0],
        "customers": connection.execute("SELECT COUNT(*) FROM customers").fetchone()[0],
        "plans": connection.execute("SELECT COUNT(*) FROM plans").fetchone()[0],
        "add_ons": connection.execute("SELECT COUNT(*) FROM add_ons").fetchone()[0],
        "handlers": connection.execute("SELECT COUNT(*) FROM handlers").fetchone()[0],
    }


def test_seed_fills_an_empty_database(tmp_path, monkeypatch):
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "a.db"))
    with closing(database.connect()) as connection:
        assert seed.seed(connection) is True
        assert seeded_counts(connection) == EXPECTED_COUNTS
        settings = json.loads(
            connection.execute("SELECT settings FROM company").fetchone()[0]
        )
        assert settings["payout_approval_limit"] == 1000
        assert settings["currency"] == "USD"


def test_seed_skips_a_database_that_already_has_claims(tmp_path, monkeypatch):
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "b.db"))
    with closing(database.connect()) as connection:
        assert seed.seed(connection) is True
    with closing(database.connect()) as connection:
        assert seed.seed(connection) is False
        assert seeded_counts(connection)["claims"] == 25


def test_claims_keep_their_items_and_documents(tmp_path, monkeypatch):
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "c.db"))
    with closing(database.connect()) as connection:
        seed.seed(connection)
        row = connection.execute(
            "SELECT * FROM claims WHERE claim_id = 'CLM-1001'"
        ).fetchone()
        items = json.loads(row["items"])
        documents = json.loads(row["documents"])
        assert row["status"] == "waiting"
        assert len(items) == 3
        assert items[0]["description"] == "Airport hotel, one night"
        assert len(documents) == 4
        assert documents[0]["name"] == "Meridian Air cancellation notice"


def test_starting_the_backend_twice_seeds_once(tmp_path, monkeypatch):
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "d.db"))
    with TestClient(app):
        pass
    with TestClient(app):
        pass
    with closing(database.connect()) as connection:
        assert seeded_counts(connection)["claims"] == 25


def test_the_seed_reads_only_the_records_it_may_see(tmp_path, monkeypatch):
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "e.db"))
    read: list[str] = []
    original = Path.read_text

    def spy(self, *args, **kwargs):
        read.append(self.name)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", spy)
    with closing(database.connect()) as connection:
        seed.seed(connection)
    assert set(read) == {
        "claims.json",
        "policies.json",
        "customers.json",
        "plans.json",
        "handlers.json",
        "company.json",
    }
