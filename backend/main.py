"""The UnderCover backend."""

import json
import sqlite3
from contextlib import asynccontextmanager, closing
from pathlib import Path

from fastapi import FastAPI, HTTPException

from agent import main as agent
from backend import database, lifecycle, seed
from backend.lifecycle import claim_or_error, now
from backend.schemas import Decision, HumanReview, Payment, Referral, SignOff, Step

INSTRUCTIONS = Path(__file__).resolve().parent / "instructions.md"


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Seed the database when it is empty."""
    with closing(database.connect()) as connection:
        seed.seed(connection)
    yield


app = FastAPI(title="UnderCover", lifespan=lifespan)


def claim_json(row: sqlite3.Row) -> dict:
    """Return a claim row as a dictionary, with its items and documents parsed."""
    claim = dict(row)
    claim["items"] = json.loads(claim["items"])
    claim["documents"] = json.loads(claim["documents"])
    return claim


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


@app.post("/api/claims/{claim_id}/run", operation_id="run_agent")
def run_agent(claim_id: str) -> dict[str, str]:
    """Set a claim in progress and run the UnderCover Agent on it."""
    with closing(database.connect()) as connection:
        row = claim_or_error(connection, claim_id)
        if row["status"] != "waiting":
            raise HTTPException(409, f"Claim {claim_id} is not waiting in the queue")
        connection.execute(
            "UPDATE claims SET status = 'in_progress' WHERE claim_id = ?", (claim_id,)
        )
        connection.commit()
    reply = agent.run(claim_id, claim_id)
    return {"reply": reply}


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
    """Record an agent decision or a pending human referral."""
    with closing(database.connect()) as connection:
        lifecycle.decide(connection, claim_id, decision)
        connection.commit()
        return claim_json(claim_or_error(connection, claim_id))


@app.post("/api/claims/{claim_id}/pay", operation_id="pay_claim")
def pay_claim(claim_id: str, payment: Payment) -> dict:
    """Pay an approval, enforcing sign-off based on the approved payout."""
    with closing(database.connect()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        lifecycle.pay(connection, claim_id, payment.amount)
        connection.commit()
        return claim_json(claim_or_error(connection, claim_id))


@app.post("/api/claims/{claim_id}/sign-off", operation_id="sign_off_claim")
def sign_off_claim(claim_id: str, sign_off: SignOff) -> dict:
    """Sign off and pay an over-limit approval."""
    with closing(database.connect()) as connection:
        lifecycle.sign_off(connection, claim_id, sign_off.handler_id)
        connection.commit()
        return claim_json(claim_or_error(connection, claim_id))


@app.post("/api/claims/{claim_id}/refer", operation_id="refer_human")
def refer_human(claim_id: str, referral: Referral) -> dict:
    """Refer a running claim to a human with an explanation."""
    with closing(database.connect()) as connection:
        lifecycle.refer(connection, claim_id, referral)
        connection.commit()
        return claim_json(claim_or_error(connection, claim_id))


@app.post("/api/claims/{claim_id}/human-review", operation_id="resolve_human_review")
def resolve_human_review(claim_id: str, review: HumanReview) -> dict:
    """Record a handler decision and pay it when authorized."""
    with closing(database.connect()) as connection:
        lifecycle.resolve(connection, claim_id, review)
        connection.commit()
        return claim_json(claim_or_error(connection, claim_id))
