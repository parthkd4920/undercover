"""Transactional claim decisions, referrals, reviews and payments."""

import json
import sqlite3
from datetime import UTC, datetime

from fastapi import HTTPException

from backend.schemas import Decision, HumanReview, Referral


def now() -> str:
    """Return the current UTC timestamp."""
    return datetime.now(UTC).isoformat()


def claim_or_error(connection: sqlite3.Connection, claim_id: str) -> sqlite3.Row:
    """Read a claim or report it missing."""
    row = connection.execute(
        "SELECT * FROM claims WHERE claim_id = ?", (claim_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Claim {claim_id} not found")
    return row


def payout_limit(connection: sqlite3.Connection) -> float:
    """Read the company's payment authority limit."""
    return json.loads(connection.execute("SELECT settings FROM company").fetchone()[0])[
        "payout_approval_limit"
    ]


def handler_or_error(connection: sqlite3.Connection, handler_id: str) -> sqlite3.Row:
    """Read the selected handler or report it missing."""
    handler = connection.execute(
        "SELECT * FROM handlers WHERE handler_id = ?", (handler_id,)
    ).fetchone()
    if handler is None:
        raise HTTPException(404, f"Handler {handler_id} not found")
    return handler


def lock_claim(
    connection: sqlite3.Connection, claim_id: str, status: str
) -> sqlite3.Row:
    """Serialize lifecycle writes and verify their expected starting state."""
    connection.execute("BEGIN IMMEDIATE")
    row = claim_or_error(connection, claim_id)
    if row["status"] != status:
        label = status.replace("_", " ").replace("sign off", "sign-off")
        raise HTTPException(409, f"Claim {claim_id} is not {label}")
    return row


def record_step(connection: sqlite3.Connection, claim_id: str, step: str) -> None:
    """Record an activity in the same transaction as its action."""
    connection.execute(
        "INSERT INTO steps (claim_id, step, at) VALUES (?, ?, ?)",
        (claim_id, step, now()),
    )


def refer(connection: sqlite3.Connection, claim_id: str, referral: Referral) -> None:
    """Hand off an undecided running claim and retain the uncertainty explanation."""
    row = lock_claim(connection, claim_id, "in_progress")
    if row["decision"] is not None:
        raise HTTPException(409, f"Claim {claim_id} already has a decision")
    cursor = connection.execute(
        "UPDATE claims SET status='waiting_for_human_review', decision='refer',"
        " payout=0, reason=?, reference=?, referral_reason=?, referral_reference=?,"
        " referred_on=?, decided_on=NULL WHERE claim_id=? AND status='in_progress'"
        " AND decision IS NULL",
        (
            referral.reason,
            referral.reference,
            referral.reason,
            referral.reference,
            now(),
            claim_id,
        ),
    )
    if cursor.rowcount != 1:
        raise HTTPException(409, "The claim changed while being referred")
    record_step(connection, claim_id, f"Referred to a human: {referral.reason}")


def decide(connection: sqlite3.Connection, claim_id: str, decision: Decision) -> None:
    """Record an agent decision, preserving the legacy referral operation."""
    if decision.decision == "refer":
        refer(
            connection,
            claim_id,
            Referral(reason=decision.reason, reference=decision.reference),
        )
        return
    connection.execute("BEGIN IMMEDIATE")
    row = claim_or_error(connection, claim_id)
    if row["decision"] is not None:
        raise HTTPException(409, f"Claim {claim_id} is already decided")
    if row["status"] != "in_progress":
        raise HTTPException(409, f"Claim {claim_id} is not in progress")
    status = "declined"
    if decision.decision == "approve":
        status = (
            "waiting_for_sign_off"
            if decision.payout > payout_limit(connection)
            else "in_progress"
        )
    connection.execute(
        "UPDATE claims SET decision=?, payout=?, reason=?, reference=?, decided_on=?,"
        " status=? WHERE claim_id=? AND status='in_progress' AND decision IS NULL",
        (
            decision.decision,
            decision.payout,
            decision.reason,
            decision.reference,
            now(),
            status,
            claim_id,
        ),
    )


def pay(connection: sqlite3.Connection, claim_id: str, amount: float) -> None:
    """Validate and record one payment; the caller owns the write transaction."""
    row = claim_or_error(connection, claim_id)
    if row["decision"] != "approve":
        raise HTTPException(409, f"Claim {claim_id} has not been approved")
    if row["paid_on"] is not None:
        raise HTTPException(409, f"Claim {claim_id} has already been paid")
    if amount > row["payout"]:
        raise HTTPException(
            409, f"Claim {claim_id} was approved for ${row['payout']:,.2f}"
        )
    limit = payout_limit(connection)
    if row["payout"] > limit and row["signed_off_by"] is None:
        raise HTTPException(
            403,
            f"The payout on claim {claim_id} is over the ${limit:,.2f}"
            " approval limit and needs a handler's sign-off",
        )
    connection.execute(
        "UPDATE claims SET paid_amount=?, paid_on=?, status='approved'"
        " WHERE claim_id=? AND paid_on IS NULL",
        (amount, now(), claim_id),
    )


def sign_off(connection: sqlite3.Connection, claim_id: str, handler_id: str) -> None:
    """Authorize and pay an over-limit approval in one transaction."""
    row = lock_claim(connection, claim_id, "waiting_for_sign_off")
    handler = handler_or_error(connection, handler_id)
    if not handler["can_approve_over_limit"]:
        raise HTTPException(
            403, f"{handler['name']} cannot approve payouts over the limit"
        )
    connection.execute(
        "UPDATE claims SET signed_off_by=?, signed_off_on=? WHERE claim_id=?",
        (handler_id, now(), claim_id),
    )
    pay(connection, claim_id, row["payout"])
    record_step(connection, claim_id, f"Signed off and paid by {handler['name']}")


def resolve(connection: sqlite3.Connection, claim_id: str, review: HumanReview) -> None:
    """Resolve a referral with reviewer attribution, preserving referral evidence."""
    lock_claim(connection, claim_id, "waiting_for_human_review")
    handler = handler_or_error(connection, review.handler_id)
    status = "declined" if review.decision == "decline" else "waiting_for_sign_off"
    cursor = connection.execute(
        "UPDATE claims SET decision=?, payout=?, reason=?, reference=?, decided_on=?,"
        " reviewed_by=?, reviewed_on=?, status=? WHERE claim_id=?"
        " AND status='waiting_for_human_review' AND reviewed_by IS NULL",
        (
            review.decision,
            review.payout,
            review.reason,
            review.reference,
            now(),
            review.handler_id,
            now(),
            status,
            claim_id,
        ),
    )
    if cursor.rowcount != 1:
        raise HTTPException(409, "The claim has already been reviewed")
    if review.decision == "approve":
        finish_approval(connection, claim_id, review, handler)
    record_step(
        connection,
        claim_id,
        f"Human review by {handler['name']}: {review.decision}. {review.reason}",
    )


def finish_approval(
    connection: sqlite3.Connection,
    claim_id: str,
    review: HumanReview,
    handler: sqlite3.Row,
) -> None:
    """Pay a human approval now when its handler has sufficient authority."""
    over_limit = review.payout > payout_limit(connection)
    if over_limit and not handler["can_approve_over_limit"]:
        return
    if over_limit:
        connection.execute(
            "UPDATE claims SET signed_off_by=?, signed_off_on=? WHERE claim_id=?",
            (review.handler_id, now(), claim_id),
        )
    pay(connection, claim_id, review.payout)
