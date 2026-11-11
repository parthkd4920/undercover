"""Tests for the claim lifecycle: steps, decisions, payments and sign-off."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from backend import database, main
from backend.main import app

client = TestClient(app)

REASON = (
    "The carrier canceled the flight for a crew problem and the delay was"
    " past the waiting period."
)
REFERENCE = "Policy wording, section 3"


def decide(claim_id: str, decision: str, payout: float):
    """Decide a claim through the API."""
    with closing(database.connect()) as connection:
        connection.execute(
            "UPDATE claims SET status = 'in_progress'"
            " WHERE claim_id = ? AND status = 'waiting'",
            (claim_id,),
        )
        connection.commit()
    return client.post(
        f"/api/claims/{claim_id}/decide",
        json={
            "decision": decision,
            "payout": payout,
            "reason": REASON,
            "reference": REFERENCE,
        },
    )


def pay(claim_id: str, amount: float):
    """Pay a claim through the API."""
    return client.post(f"/api/claims/{claim_id}/pay", json={"amount": amount})


def sign_off(claim_id: str, handler_id: str = "HND-01"):
    """Sign off a claim through the API."""
    return client.post(
        f"/api/claims/{claim_id}/sign-off", json={"handler_id": handler_id}
    )


def add_step(claim_id: str, step: str):
    """Record a step on a claim through the API."""
    return client.post(f"/api/claims/{claim_id}/steps", json={"step": step})


def test_deciding_an_approval_within_the_limit_decides_the_claim():
    response = decide("CLM-1001", "approve", 420.0)
    assert response.status_code == 200
    claim = response.json()
    assert claim["status"] == "in_progress"
    assert claim["decision"] == "approve"
    assert claim["payout"] == 420.0
    assert claim["reason"] == REASON
    assert claim["reference"] == REFERENCE
    assert claim["decided_on"] is not None
    assert claim["paid_on"] is None


def test_deciding_a_decline_or_a_refer_decides_the_claim():
    assert decide("CLM-1002", "decline", 0.0).json()["status"] == "declined"
    assert (
        decide("CLM-1003", "refer", 0.0).json()["status"] == "waiting_for_human_review"
    )


def test_deciding_an_approval_over_the_limit_waits_for_sign_off():
    response = decide("CLM-1004", "approve", 2000.0)
    assert response.status_code == 200
    claim = response.json()
    assert claim["status"] == "waiting_for_sign_off"
    assert claim["payout"] == 2000.0
    assert claim["paid_on"] is None


def test_deciding_a_claim_twice_is_refused():
    decide("CLM-1005", "approve", 300.0)
    response = decide("CLM-1005", "approve", 300.0)
    assert response.status_code == 409
    assert "already decided" in response.json()["detail"]


def test_deciding_an_unknown_claim_is_not_found():
    assert decide("CLM-9999", "approve", 100.0).status_code == 404


def test_deciding_with_an_unknown_decision_is_refused():
    response = client.post(
        "/api/claims/CLM-1006/decide",
        json={
            "decision": "settle",
            "payout": 0,
            "reason": REASON,
            "reference": REFERENCE,
        },
    )
    assert response.status_code == 422


def test_paying_an_approval_within_the_limit():
    decide("CLM-1007", "approve", 420.0)
    response = pay("CLM-1007", 420.0)
    assert response.status_code == 200
    claim = response.json()
    assert claim["status"] == "approved"
    assert claim["paid_amount"] == 420.0
    assert claim["paid_on"] is not None


def test_paying_over_the_limit_is_blocked():
    decide("CLM-1008", "approve", 2000.0)
    response = pay("CLM-1008", 2000.0)
    assert response.status_code == 403
    assert "sign-off" in response.json()["detail"]
    claim = client.get("/api/claims/CLM-1008").json()
    assert claim["status"] == "waiting_for_sign_off"
    assert claim["paid_on"] is None


def test_paying_a_claim_that_was_not_approved_is_refused():
    decide("CLM-1009", "refer", 0.0)
    assert pay("CLM-1009", 100.0).status_code == 409


def test_paying_more_than_the_payout_is_refused():
    decide("CLM-1010", "approve", 500.0)
    response = pay("CLM-1010", 600.0)
    assert response.status_code == 409
    assert "$500.00" in response.json()["detail"]


def test_paying_a_claim_twice_is_refused():
    decide("CLM-1011", "approve", 200.0)
    pay("CLM-1011", 200.0)
    response = pay("CLM-1011", 200.0)
    assert response.status_code == 409
    assert "already been paid" in response.json()["detail"]


def test_signing_off_pays_an_over_limit_approval():
    decide("CLM-1012", "approve", 2500.0)
    response = sign_off("CLM-1012", "HND-02")
    assert response.status_code == 200
    claim = response.json()
    assert claim["status"] == "approved"
    assert claim["signed_off_by"] == "HND-02"
    assert claim["signed_off_on"] is not None
    assert claim["paid_amount"] == 2500.0
    assert claim["paid_on"] is not None


def test_signing_off_by_a_handler_without_the_power_is_refused():
    with closing(database.connect()) as connection:
        connection.execute(
            "UPDATE handlers SET can_approve_over_limit = 0 WHERE handler_id = 'HND-03'"
        )
        connection.commit()
    decide("CLM-1013", "approve", 1500.0)
    response = sign_off("CLM-1013", "HND-03")
    assert response.status_code == 403
    assert "cannot approve" in response.json()["detail"]


def test_signing_off_a_claim_that_is_not_waiting_is_refused():
    response = sign_off("CLM-1014")
    assert response.status_code == 409
    assert "not waiting for sign-off" in response.json()["detail"]


def test_signing_off_with_an_unknown_handler_is_not_found():
    decide("CLM-1015", "approve", 1500.0)
    assert sign_off("CLM-1015", "HND-99").status_code == 404


def test_paying_after_a_sign_off_cannot_pay_twice():
    decide("CLM-1016", "approve", 1500.0)
    sign_off("CLM-1016")
    response = pay("CLM-1016", 1500.0)
    assert response.status_code == 409
    assert "already been paid" in response.json()["detail"]


def test_run_agent(monkeypatch):
    def fake_run(claim_id: str, thread_id: str, llm=None) -> str:
        assert (claim_id, thread_id) == ("CLM-1018", "CLM-1018")
        return "Claim CLM-1018 approved."

    monkeypatch.setattr("agent.main.run", fake_run)
    response = client.post("/api/claims/CLM-1018/run")
    assert response.status_code == 200
    assert response.json() == {"reply": "Claim CLM-1018 approved."}
    assert client.get("/api/claims/CLM-1018").json()["status"] == "in_progress"


def test_run_agent_on_a_claim_that_is_not_waiting():
    decide("CLM-1019", "approve", 100.0)
    response = client.post("/api/claims/CLM-1019/run")
    assert response.status_code == 409
    assert "not waiting" in response.json()["detail"]


def test_run_agent_on_an_unknown_claim():
    assert client.post("/api/claims/CLM-9999/run").status_code == 404


def test_steps_are_listed_in_order():
    assert add_step("CLM-1017", "Read claim CLM-1017").status_code == 200
    add_step("CLM-1017", "Read the policy wording")
    steps = client.get("/api/claims/CLM-1017/steps").json()
    assert [step["step"] for step in steps] == [
        "Read claim CLM-1017",
        "Read the policy wording",
    ]
    assert steps[0]["at"] <= steps[1]["at"]
    assert add_step("CLM-9999", "nope").status_code == 404


def test_waiting_claim_cannot_be_decided():
    response = client.post(
        "/api/claims/CLM-1001/decide",
        json={
            "decision": "approve",
            "payout": 420,
            "reason": REASON,
            "reference": REFERENCE,
        },
    )
    assert response.status_code == 409
    assert client.get("/api/claims/CLM-1001").json()["decision"] is None


def test_smaller_payment_cannot_bypass_sign_off():
    decide("CLM-1001", "approve", 2000)
    assert pay("CLM-1001", 1000).status_code == 403
    claim = client.get("/api/claims/CLM-1001").json()
    assert claim["status"] == "waiting_for_sign_off"
    assert claim["paid_on"] is None


@pytest.mark.parametrize("payout", [1000, 1000.01])
def test_sign_off_boundary(payout):
    decide("CLM-1001", "approve", payout)
    response = pay("CLM-1001", payout)
    assert response.status_code == (200 if payout == 1000 else 403)


@pytest.mark.parametrize("amount", [-1, "NaN", "Infinity", "-Infinity"])
@pytest.mark.parametrize("operation", ["decide", "pay"])
def test_invalid_money_cannot_change_a_claim(amount, operation):
    decide("CLM-1001", "approve", 420)
    before = client.get("/api/claims/CLM-1001").json()
    body = (
        {"amount": amount}
        if operation == "pay"
        else {
            "decision": "approve",
            "payout": amount,
            "reason": REASON,
            "reference": REFERENCE,
        }
    )
    response = client.post(f"/api/claims/CLM-1001/{operation}", json=body)
    assert response.status_code == 422
    assert client.get("/api/claims/CLM-1001").json() == before


def test_failed_agent_run_leaves_claim_in_progress(monkeypatch):
    """Document the pilot's current lack of automatic run recovery."""

    def fail_run(claim_id, thread_id):
        raise RuntimeError("Model unavailable")

    monkeypatch.setattr("agent.main.run", fail_run)
    failed_client = TestClient(app, raise_server_exceptions=False)
    response = failed_client.post("/api/claims/CLM-1001/run")
    assert response.status_code == 502
    assert "RuntimeError" in response.json()["detail"]
    assert "Saved status: in progress" in response.json()["detail"]
    claim = client.get("/api/claims/CLM-1001").json()
    assert claim["status"] == "in_progress"
    assert claim["decision"] is None


def test_competing_agent_starts_run_claim_only_once(monkeypatch):
    """Two dashboards must not invoke the model twice for the same waiting claim."""
    barrier = Barrier(2)
    original = main.claim_or_error
    runs = []

    def read_together(connection, claim_id):
        row = original(connection, claim_id)
        barrier.wait(timeout=5)
        return row

    def fake_run(claim_id, thread_id):
        runs.append(claim_id)
        return "Done"

    monkeypatch.setattr(main, "claim_or_error", read_together)
    monkeypatch.setattr("agent.main.run", fake_run)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(lambda _: client.post("/api/claims/CLM-1001/run"), range(2))
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert runs == ["CLM-1001"]
