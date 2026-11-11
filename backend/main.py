"""The UnderCover backend."""

import json
import sqlite3
from contextlib import asynccontextmanager, closing
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException

from backend import database, seed
from backend.schemas import Decision, Payment, SignOff, Step

INSTRUCTIONS = Path(__file__).resolve().parent / "instructions.md"


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Seed the database when it is empty."""
    with closing(database.connect()) as connection:
        seed.seed(connection)
    yield


app = FastAPI(title="UnderCover", lifespan=lifespan)


def claim_or_error(connection: sqlite3.Connection, claim_id: str) -> sqlite3.Row:
    """Return the claim, or raise the backend's not-found error."""
    row = connection.execute(
        "SELECT * FROM claims WHERE claim_id = ?", (claim_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Claim {claim_id} not found")
    return row


def claim_json(row: sqlite3.Row) -> dict:
    """Return a claim row as a dictionary, with its items and documents parsed."""
    claim = dict(row)
    claim["items"] = json.loads(claim["items"])
    claim["documents"] = json.loads(claim["documents"])
    return claim


def now() -> str:
    """Return the current UTC time as an ISO string."""
    return datetime.now(UTC).isoformat()


def payout_limit(connection: sqlite3.Connection) -> float:
    """Return the payout amount over which a handler's sign-off is needed."""
    settings = json.loads(
        connection.execute("SELECT settings FROM company").fetchone()[0]
    )
    return settings["payout_approval_limit"]


@app.get("/api/health", operation_id="health")
def health() -> dict[str, str]:
    """Check that the backend is running."""
    return {"status": "ok"}


@app.get("/api/claims", operation_id="list_claims")
def list_claims() -> list[dict]:
    """List the claims queue with where each claim stands."""
    with closing(database.connect()) as connection:
        rows = connection.execute(
            "SELECT c.claim_id, c.claim_type, c.summary, c.amount_claimed,"
            " c.status, c.decision, c.payout, c.submitted_on, cu.name AS customer_name"
            " FROM claims c JOIN customers cu ON cu.customer_id = c.customer_id"
            " ORDER BY c.submitted_on, c.claim_id"
        ).fetchall()
        return [dict(row) for row in rows]


@app.get("/api/claims/{claim_id}", operation_id="get_claim")
def get_claim(claim_id: str) -> dict:
    """Return one claim in full, with its decision and payment."""
    with closing(database.connect()) as connection:
        return claim_json(claim_or_error(connection, claim_id))


@app.get("/api/claims/{claim_id}/steps", operation_id="list_steps")
def list_steps(claim_id: str) -> list[dict[str, str]]:
    """List the agent's steps on a claim, in order."""
    with closing(database.connect()) as connection:
        claim_or_error(connection, claim_id)
        rows = connection.execute(
            "SELECT step, at FROM steps WHERE claim_id = ? ORDER BY id", (claim_id,)
        ).fetchall()
        return [dict(row) for row in rows]


@app.get("/api/policies/{policy_id}", operation_id="get_policy")
def get_policy(policy_id: str) -> dict:
    """Return the policy behind a claim: its plan, add-ons, trip and travelers."""
    with closing(database.connect()) as connection:
        row = connection.execute(
            "SELECT * FROM policies WHERE policy_id = ?", (policy_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, f"Policy {policy_id} not found")
        policy = dict(row)
        policy["add_ons"] = json.loads(policy["add_ons"])
        policy["trip"] = json.loads(policy["trip"])
        policy["travelers"] = json.loads(policy["travelers"])
        return policy


@app.get("/api/customers/{customer_id}", operation_id="get_customer")
def get_customer(customer_id: str) -> dict:
    """Return a customer's contact details and claim history."""
    with closing(database.connect()) as connection:
        row = connection.execute(
            "SELECT * FROM customers WHERE customer_id = ?", (customer_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, f"Customer {customer_id} not found")
        customer = dict(row)
        customer["address"] = json.loads(customer["address"])
        customer["previous_claims"] = json.loads(customer["previous_claims"])
        return customer


@app.get("/api/plans/{plan}", operation_id="get_plan")
def get_plan(plan: str) -> dict:
    """Return one plan's limits and deductible."""
    with closing(database.connect()) as connection:
        row = connection.execute(
            "SELECT * FROM plans WHERE plan = ?", (plan,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, f"Plan {plan} not found")
        return dict(row)


@app.get("/api/add-ons", operation_id="list_add_ons")
def list_add_ons() -> list[dict]:
    """List the add-ons a policy can carry and what each one covers."""
    with closing(database.connect()) as connection:
        rows = connection.execute("SELECT * FROM add_ons ORDER BY add_on").fetchall()
        return [dict(row) for row in rows]


@app.get("/api/handlers", operation_id="list_handlers")
def list_handlers() -> list[dict]:
    """List the claims handlers."""
    with closing(database.connect()) as connection:
        rows = connection.execute(
            "SELECT * FROM handlers ORDER BY handler_id"
        ).fetchall()
        handlers = [dict(row) for row in rows]
        for handler in handlers:
            handler["can_approve_over_limit"] = bool(handler["can_approve_over_limit"])
        return handlers


@app.get("/api/policy-wording", operation_id="get_policy_wording")
def get_policy_wording() -> dict[str, str]:
    """Return the policy wording, the contract that decisions follow."""
    return {"wording": (seed.DATA / "policy_wording.md").read_text()}


@app.get("/api/agent-instructions", operation_id="get_agent_instructions")
def get_agent_instructions() -> dict[str, str]:
    """Return the agent's instructions, read only."""
    return {"instructions": INSTRUCTIONS.read_text()}


@app.post("/api/claims/{claim_id}/steps", operation_id="add_step")
def add_step(claim_id: str, step: Step) -> dict[str, str]:
    """Record one step of the agent's work on a claim."""
    with closing(database.connect()) as connection:
        claim_or_error(connection, claim_id)
        at = now()
        connection.execute(
            "INSERT INTO steps (claim_id, step, at) VALUES (?, ?, ?)",
            (claim_id, step.step, at),
        )
        connection.commit()
        return {"step": step.step, "at": at}


@app.post("/api/claims/{claim_id}/decide", operation_id="decide_claim")
def decide_claim(claim_id: str, decision: Decision) -> dict:
    """Record the decision on a claim and set where it stands."""
    with closing(database.connect()) as connection:
        row = claim_or_error(connection, claim_id)
        if row["decision"] is not None:
            raise HTTPException(409, f"Claim {claim_id} is already decided")
        status = "decided"
        if decision.decision == "approve" and decision.payout > payout_limit(
            connection
        ):
            status = "waiting_for_sign_off"
        connection.execute(
            "UPDATE claims SET decision = ?, payout = ?, reason = ?, reference = ?,"
            " decided_on = ?, status = ? WHERE claim_id = ?",
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
        connection.commit()
        return claim_json(claim_or_error(connection, claim_id))


@app.post("/api/claims/{claim_id}/pay", operation_id="pay_claim")
def pay_claim(claim_id: str, payment: Payment) -> dict:
    """Pay an approved claim, blocked over the approval limit without sign-off."""
    with closing(database.connect()) as connection:
        row = claim_or_error(connection, claim_id)
        if row["decision"] != "approve":
            raise HTTPException(409, f"Claim {claim_id} has not been approved")
        if row["paid_on"] is not None:
            raise HTTPException(409, f"Claim {claim_id} has already been paid")
        if payment.amount > row["payout"]:
            raise HTTPException(
                409, f"Claim {claim_id} was approved for ${row['payout']:.2f}"
            )
        limit = payout_limit(connection)
        if payment.amount > limit and row["signed_off_by"] is None:
            raise HTTPException(
                403,
                f"The payout on claim {claim_id} is over the ${limit:.2f}"
                " approval limit and needs a handler's sign-off",
            )
        connection.execute(
            "UPDATE claims SET paid_amount = ?, paid_on = ?, status = 'decided'"
            " WHERE claim_id = ?",
            (payment.amount, now(), claim_id),
        )
        connection.commit()
        return claim_json(claim_or_error(connection, claim_id))


@app.post("/api/claims/{claim_id}/sign-off", operation_id="sign_off_claim")
def sign_off_claim(claim_id: str, sign_off: SignOff) -> dict:
    """Sign off an over-limit approval, pay it and decide the claim."""
    with closing(database.connect()) as connection:
        row = claim_or_error(connection, claim_id)
        if row["status"] != "waiting_for_sign_off":
            raise HTTPException(409, f"Claim {claim_id} is not waiting for sign-off")
        handler = connection.execute(
            "SELECT * FROM handlers WHERE handler_id = ?", (sign_off.handler_id,)
        ).fetchone()
        if handler is None:
            raise HTTPException(404, f"Handler {sign_off.handler_id} not found")
        if not handler["can_approve_over_limit"]:
            raise HTTPException(
                403, f"{handler['name']} cannot approve payouts over the limit"
            )
        at = now()
        connection.execute(
            "UPDATE claims SET signed_off_by = ?, signed_off_on = ?, paid_amount = ?,"
            " paid_on = ?, status = 'decided' WHERE claim_id = ?",
            (sign_off.handler_id, at, row["payout"], at, claim_id),
        )
        connection.commit()
        return claim_json(claim_or_error(connection, claim_id))
