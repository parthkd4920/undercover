"""Two-minute retry boundaries, serialized workers and three-attempt escalation."""

import asyncio
from contextlib import closing
from datetime import UTC, datetime, timedelta
from threading import Event

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import database, recovery
from backend.main import app

client = TestClient(app)


@pytest.fixture
def clock(monkeypatch):
    """Control time without waiting or calling a model."""
    value = {"now": datetime(2026, 11, 12, 12, tzinfo=UTC)}
    monkeypatch.setattr(recovery, "utc_now", lambda: value["now"])
    return value


def arrange(clock, attempts=1, seconds=120):
    """Prepare an unfinished timed claim at the selected boundary."""
    with closing(database.connect()) as connection:
        connection.execute(
            "UPDATE claims SET status='in_progress', run_started_on=?, run_attempts=?"
            " WHERE claim_id='CLM-1001'",
            ((clock["now"] - timedelta(seconds=seconds)).isoformat(), attempts),
        )
        connection.commit()


def claim():
    """Read the claim through the product API."""
    return client.get("/api/claims/CLM-1001").json()


def test_initial_run_records_attempt_and_time(clock, monkeypatch):
    monkeypatch.setattr("agent.main.run", lambda *_: "Working")
    response = client.post("/api/claims/CLM-1001/run")
    assert response.status_code == 200
    assert claim()["run_attempts"] == 1
    assert claim()["run_started_on"] == clock["now"].isoformat()


def test_two_minute_boundary_and_new_attempt_cooldown(clock, monkeypatch):
    runs = []
    monkeypatch.setattr("agent.main.run", lambda *args: runs.append(args) or "Working")
    arrange(clock, seconds=119)
    assert client.post("/api/claims/CLM-1001/rerun").status_code == 409
    assert runs == []
    clock["now"] += timedelta(seconds=1)
    assert client.post("/api/claims/CLM-1001/rerun").status_code == 200
    assert runs == [("CLM-1001", "CLM-1001")]
    assert claim()["run_attempts"] == 2
    assert claim()["run_started_on"] == clock["now"].isoformat()
    assert client.post("/api/claims/CLM-1001/rerun").status_code == 409


def test_watchdog_retries_twice_then_refers_after_third_stale_attempt(
    clock, monkeypatch
):
    runs = []
    monkeypatch.setattr(
        "agent.main.run", lambda *args: runs.append(args) or "No decision"
    )
    arrange(clock)
    recovery.recover_next()
    assert claim()["run_attempts"] == 2
    clock["now"] += timedelta(minutes=2)
    recovery.recover_next()
    assert claim()["run_attempts"] == 3
    assert claim()["status"] == "in_progress"
    clock["now"] += timedelta(seconds=119)
    recovery.recover_next()
    assert claim()["status"] == "in_progress"
    clock["now"] += timedelta(seconds=1)
    recovery.recover_next()
    record = claim()
    assert record["status"] == "waiting_for_human_review"
    assert record["decision"] == "refer"
    assert record["referral_reason"].startswith("The agent did not complete")
    assert "three attempts" in record["referral_reason"]
    assert record["paid_on"] is None
    assert record["decided_on"] is None
    assert record["reviewed_by"] is None
    assert len(runs) == 2
    recovery.recover_next()
    assert len(runs) == 2


def test_failure_counts_as_an_attempt_and_releases_worker(clock, monkeypatch):
    arrange(clock)

    def fail(*args):
        raise RuntimeError("Model failed")

    monkeypatch.setattr("agent.main.run", fail)
    assert client.post("/api/claims/CLM-1001/rerun").status_code == 502
    assert claim()["run_attempts"] == 2
    assert claim()["run_started_on"] == clock["now"].isoformat()
    assert recovery.RUN_LOCK.acquire(blocking=False)
    recovery.RUN_LOCK.release()


@pytest.mark.parametrize("decision", ["approve", "decline", "refer"])
def test_rerun_never_overwrites_a_saved_decision(clock, monkeypatch, decision):
    arrange(clock)
    with closing(database.connect()) as connection:
        connection.execute(
            "UPDATE claims SET decision=? WHERE claim_id='CLM-1001'", (decision,)
        )
        connection.commit()
    before = claim()
    monkeypatch.setattr("agent.main.run", lambda *_: pytest.fail("Must not run model"))
    assert client.post("/api/claims/CLM-1001/rerun").status_code == 409
    recovery.recover_next()
    assert claim() == before


def test_no_overlap_with_active_worker(clock, monkeypatch):
    arrange(clock)
    before = claim()
    monkeypatch.setattr("agent.main.run", lambda *_: pytest.fail("Must not overlap"))
    with recovery.RUN_LOCK:
        assert client.post("/api/claims/CLM-1001/rerun").status_code == 409
        recovery.recover_next()
    assert claim() == before


def test_legacy_runs_without_timestamp_are_left_untouched(monkeypatch):
    with closing(database.connect()) as connection:
        connection.execute(
            "UPDATE claims SET status='in_progress' WHERE claim_id='CLM-1001'"
        )
        connection.commit()
    before = claim()
    monkeypatch.setattr(
        "agent.main.run", lambda *_: pytest.fail("Do not guess legacy age")
    )
    recovery.recover_next()
    assert client.post("/api/claims/CLM-1001/rerun").status_code == 409
    assert claim() == before


def test_unknown_rerun_is_not_found():
    assert client.post("/api/claims/UNKNOWN/rerun").status_code == 404


def test_watchdog_starts_and_stops_with_backend(monkeypatch):
    started, stopped = Event(), Event()

    async def watch():
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setattr(recovery, "watch", watch)
    with TestClient(app):
        assert started.wait(timeout=2)
    assert stopped.wait(timeout=2)


def test_watchdog_logs_failure_and_continues(monkeypatch, caplog):
    cycles = []

    async def tick(_):
        if len(cycles) == 2:
            raise asyncio.CancelledError

    def fail():
        cycles.append(1)
        raise HTTPException(502, "Provider unavailable")

    monkeypatch.setattr(recovery.asyncio, "sleep", tick)
    monkeypatch.setattr(recovery, "recover_next", fail)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(recovery.watch())
    assert len(cycles) == 2
    assert "monitoring continues" in caplog.text
