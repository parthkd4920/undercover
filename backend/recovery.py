"""Serialize claim attempts and recover stale, undecided runs automatically."""

import asyncio
import logging
import sqlite3
from contextlib import closing
from datetime import UTC, datetime, timedelta
from threading import Lock

from fastapi import HTTPException

from agent import main as agent
from backend import database, lifecycle
from backend.run_errors import describe_error, saved_work
from backend.schemas import Referral

logger = logging.getLogger(__name__)
RUN_LOCK = Lock()
STALE_AFTER = timedelta(minutes=2)
MAX_ATTEMPTS = 3
POLL_SECONDS = 5


def utc_now() -> datetime:
    """Return the clock used to measure each persisted attempt's age."""
    return datetime.now(UTC)


def eligible(row: sqlite3.Row) -> bool:
    """Retry only timed, undecided, unpaid claims older than two minutes."""
    return (
        row["status"] == "in_progress"
        and row["decision"] is None
        and row["paid_on"] is None
        and row["run_started_on"] is not None
        and utc_now() - datetime.fromisoformat(row["run_started_on"]) >= STALE_AFTER
    )


def invoke(claim_id: str) -> str:
    """Run one attempt and retain safe diagnostics without discarding saved work."""
    try:
        return agent.run(claim_id, claim_id)
    except Exception as error:
        logger.exception("Agent run failed for %s", claim_id)
        with closing(database.connect()) as connection:
            recorded = saved_work(lifecycle.claim_or_error(connection, claim_id))
            lifecycle.record_step(
                connection, claim_id, f"Agent attempt failed: {describe_error(error)}"
            )
            connection.commit()
        detail = f"{describe_error(error)} {recorded} See backend logs for {claim_id}."
        raise HTTPException(502, detail) from error


def start(claim_id: str) -> str:
    """Start a waiting claim with a timestamp and serialize agent work."""
    with RUN_LOCK:
        with closing(database.connect()) as connection:
            row = lifecycle.claim_or_error(connection, claim_id)
            if row["status"] != "waiting":
                raise HTTPException(
                    409, f"Claim {claim_id} is not waiting in the queue"
                )
            cursor = connection.execute(
                "UPDATE claims SET status='in_progress',"
                " run_started_on=?, run_attempts=1"
                " WHERE claim_id=? AND status='waiting' AND decision IS NULL",
                (utc_now().isoformat(), claim_id),
            )
            if cursor.rowcount != 1:
                raise HTTPException(409, f"Claim {claim_id} is no longer waiting")
            connection.commit()
        return invoke(claim_id)


def recover_locked(claim_id: str) -> str:
    """Retry a stale attempt, or refer after three attempts; caller holds RUN_LOCK."""
    with closing(database.connect()) as connection:
        row = lifecycle.claim_or_error(connection, claim_id)
        if not eligible(row):
            raise HTTPException(
                409, "Only undecided runs older than two minutes can rerun"
            )
        if row["run_attempts"] >= MAX_ATTEMPTS:
            lifecycle.refer(
                connection,
                claim_id,
                Referral(
                    reason=(
                        "The agent did not complete this claim after three attempts. "
                        "A handler must review the evidence and decide it."
                    ),
                    reference="Operational escalation; no policy decision was made.",
                ),
            )
            connection.commit()
            return "Referred to a human after three incomplete attempts."
        cursor = connection.execute(
            "UPDATE claims SET run_started_on=?, run_attempts=run_attempts+1"
            " WHERE claim_id=? AND status='in_progress' AND decision IS NULL"
            " AND paid_on IS NULL AND run_started_on=? AND run_attempts=?",
            (
                utc_now().isoformat(),
                claim_id,
                row["run_started_on"],
                row["run_attempts"],
            ),
        )
        if cursor.rowcount != 1:
            raise HTTPException(409, "The claim changed before the retry could start")
        lifecycle.record_step(
            connection,
            claim_id,
            f"Automatic retry: attempt {row['run_attempts'] + 1} of {MAX_ATTEMPTS}",
        )
        connection.commit()
    return invoke(claim_id)


def rerun(claim_id: str) -> str:
    """Expose the same safe rerun used by the watchdog without overlapping a worker."""
    if not RUN_LOCK.acquire(blocking=False):
        raise HTTPException(409, "An agent worker is still active; retry will wait")
    try:
        return recover_locked(claim_id)
    finally:
        RUN_LOCK.release()


def recover_next() -> None:
    """Recover at most one eligible record when no agent worker is active."""
    if not RUN_LOCK.acquire(blocking=False):
        return
    try:
        with closing(database.connect()) as connection:
            rows = connection.execute(
                "SELECT * FROM claims WHERE status='in_progress' AND decision IS NULL"
                " AND run_started_on IS NOT NULL ORDER BY run_started_on, claim_id"
            ).fetchall()
            candidate = next((row for row in rows if eligible(row)), None)
        if candidate is not None:
            recover_locked(candidate["claim_id"])
    finally:
        RUN_LOCK.release()


async def watch() -> None:
    """Keep checking stale attempts even when the dashboard is closed."""
    while True:
        await asyncio.sleep(POLL_SECONDS)
        try:
            await asyncio.to_thread(recover_next)
        except Exception:
            logger.exception("Automatic recovery attempt failed; monitoring continues")
