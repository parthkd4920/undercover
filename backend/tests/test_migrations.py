"""Regression tests for old databases upgraded in place."""

import sqlite3
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from backend import database, seed
from backend.main import app
from backend.migrations import REVIEW_COLUMNS


def old_database(path):
    """Construct the pre-upgrade schema and representative legacy decisions."""
    with closing(sqlite3.connect(path)) as connection:
        connection.executescript(database.SCHEMA)
        seed.seed(connection)
        for number, decision, payout, paid in [
            (1, "approve", 420, True),
            (2, "approve", 420, False),
            (3, "approve", 2000, False),
            (4, "decline", 0, False),
            (5, "refer", 0, False),
        ]:
            connection.execute(
                "UPDATE claims SET status='decided', decision=?, payout=?,"
                " reason='Original reason', reference='Section 3',"
                " decided_on='2026-11-11',"
                " paid_amount=?, paid_on=? WHERE claim_id=?",
                (
                    decision,
                    payout,
                    payout if paid else None,
                    "2026-11-11" if paid else None,
                    f"CLM-100{number}",
                ),
            )
        connection.execute(
            "UPDATE claims SET status='waiting_for_sign_off' WHERE claim_id='CLM-1006'"
        )
        connection.execute(
            "INSERT INTO steps (claim_id, step, at) VALUES"
            " ('CLM-1001', 'Original step', '2026-11-11')"
        )
        connection.commit()


def test_startup_migrates_legacy_records_idempotently(tmp_path, monkeypatch):
    path = tmp_path / "legacy.db"
    old_database(path)
    monkeypatch.setenv("UNDERCOVER_DB", str(path))
    with TestClient(app) as client:
        claims = [client.get(f"/api/claims/CLM-100{i}").json() for i in range(1, 7)]
        assert [claim["status"] for claim in claims] == [
            "approved",
            "in_progress",
            "waiting_for_sign_off",
            "declined",
            "waiting_for_human_review",
            "waiting_for_sign_off",
        ]
        assert claims[0]["paid_amount"] == 420
        assert claims[4]["referral_reason"] == "Original reason"
        assert claims[4]["referral_reference"] == "Section 3"
        assert claims[4]["referred_on"] == "2026-11-11"
        assert claims[4]["decided_on"] is None
        assert all(claim["reviewed_by"] is None for claim in claims)
        assert len(client.get("/api/claims").json()) == 25
        assert (
            client.get("/api/claims/CLM-1001/steps").json()[0]["step"]
            == "Original step"
        )
    with TestClient(app) as client:
        assert [
            client.get(f"/api/claims/CLM-100{i}").json() for i in range(1, 7)
        ] == claims
    with closing(database.connect()) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM policies").fetchone()[0] == 50


def test_bad_legacy_claim_rolls_back_upgrade(tmp_path, monkeypatch):
    path = tmp_path / "invalid.db"
    old_database(path)
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("UPDATE claims SET decision=NULL WHERE claim_id='CLM-1005'")
        connection.commit()
    monkeypatch.setenv("UNDERCOVER_DB", str(path))
    with pytest.raises(ValueError, match="CLM-1005"):
        database.connect()
    with closing(sqlite3.connect(path)) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 0
        columns = {row[1] for row in connection.execute("PRAGMA table_info(claims)")}
        assert not columns.intersection(REVIEW_COLUMNS)
        assert (
            connection.execute(
                "SELECT status FROM claims WHERE claim_id='CLM-1001'"
            ).fetchone()[0]
            == "decided"
        )
