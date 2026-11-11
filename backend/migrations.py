"""Upgrade the pilot's SQLite records without resetting business data."""

import json
import sqlite3

REVIEW_COLUMNS = (
    "referral_reason",
    "referral_reference",
    "referred_on",
    "reviewed_by",
    "reviewed_on",
)


def legacy_status(row: sqlite3.Row, limit: float) -> str:
    """Map an old terminal record to its explicit outcome or pending action."""
    decision = row["decision"]
    if decision == "approve" and row["payout"] is not None:
        if row["paid_on"] is not None:
            return "approved"
        if row["payout"] > limit and row["signed_off_by"] is None:
            return "waiting_for_sign_off"
        return "in_progress"
    if row["paid_on"] is None and decision in {"decline", "refer"}:
        return "declined" if decision == "decline" else "waiting_for_human_review"
    raise ValueError(f"Cannot migrate inconsistent claim {row['claim_id']}")


def migrate(connection: sqlite3.Connection) -> None:
    """Apply the outcome/review upgrade exactly once, under a database write lock."""
    with connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute("PRAGMA user_version").fetchone()[0] >= 1:
            return
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(claims)")
        }
        for column in REVIEW_COLUMNS:
            if column not in columns:
                connection.execute(f"ALTER TABLE claims ADD COLUMN {column} TEXT")
        settings = connection.execute("SELECT settings FROM company").fetchone()
        limit = json.loads(settings[0])["payout_approval_limit"] if settings else 1000
        rows = connection.execute(
            "SELECT * FROM claims WHERE status = 'decided'"
        ).fetchall()
        for row in rows:
            status = legacy_status(row, limit)
            connection.execute(
                "UPDATE claims SET status = ? WHERE claim_id = ?",
                (status, row["claim_id"]),
            )
            if row["decision"] == "refer":
                connection.execute(
                    "UPDATE claims SET referral_reason = reason,"
                    " referral_reference = reference,"
                    " referred_on = decided_on, decided_on = NULL WHERE claim_id = ?",
                    (row["claim_id"],),
                )
        connection.execute("PRAGMA user_version = 1")
