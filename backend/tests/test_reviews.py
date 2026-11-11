"""Human referrals, financial authority and transactional review regression tests."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import database, lifecycle
from backend.main import app

client = TestClient(app)
REASON = "The required receipt is missing. A handler must assess the evidence."
REFERENCE = "Section 3; applicability needs review"
REVIEW = {
    "handler_id": "HND-01",
    "decision": "approve",
    "payout": 420,
    "reason": "The additional evidence confirms eligible expenses.",
    "reference": "Section 3",
}


def start_claim():
    """Arrange a running claim without calling a model."""
    with closing(database.connect()) as connection:
        connection.execute(
            "UPDATE claims SET status='in_progress' WHERE claim_id='CLM-1001'"
        )
        connection.execute(
            "UPDATE handlers SET can_approve_over_limit=0 WHERE handler_id='HND-03'"
        )
        connection.commit()


def refer():
    """Send the running claim for human review."""
    return client.post(
        "/api/claims/CLM-1001/refer", json={"reason": REASON, "reference": REFERENCE}
    )


def review(**changes):
    """Resolve a referral using the selected decision overrides."""
    return client.post("/api/claims/CLM-1001/human-review", json=REVIEW | changes)


@pytest.mark.parametrize("legacy", [False, True])
def test_referral_preserves_explanation_without_payment(legacy):
    start_claim()
    body = {"reason": REASON, "reference": REFERENCE}
    path = "refer"
    if legacy:
        body |= {"decision": "refer", "payout": 0}
        path = "decide"
    response = client.post(f"/api/claims/CLM-1001/{path}", json=body)
    assert response.status_code == 200
    claim = response.json()
    assert claim["status"] == "waiting_for_human_review"
    assert claim["referral_reason"] == REASON
    assert claim["referral_reference"] == REFERENCE
    assert claim["referred_on"] is not None
    assert claim["decided_on"] is None
    assert claim["paid_on"] is None
    assert len(client.get("/api/claims/CLM-1001/steps").json()) == 1


@pytest.mark.parametrize(
    ("decision", "payout", "status"),
    [("approve", 420, "approved"), ("decline", 0, "declined")],
)
def test_handler_resolves_and_keeps_referral(decision, payout, status):
    start_claim()
    refer()
    response = review(decision=decision, payout=payout)
    assert response.status_code == 200
    claim = response.json()
    assert claim["status"] == status
    assert claim["reviewed_by"] == "HND-01"
    assert claim["reviewed_on"] is not None
    assert claim["decided_on"] is not None
    assert claim["referral_reason"] == REASON
    assert claim["reason"] == REVIEW["reason"]
    assert claim["paid_amount"] == (payout if decision == "approve" else None)
    assert review(decision=decision, payout=payout).status_code == 409
    assert len(client.get("/api/claims/CLM-1001/steps").json()) == 2


@pytest.mark.parametrize(
    ("handler_id", "status"),
    [("HND-01", "approved"), ("HND-03", "waiting_for_sign_off")],
)
def test_over_limit_human_approval_requires_authority(handler_id, status):
    start_claim()
    refer()
    claim = review(handler_id=handler_id, payout=2000).json()
    assert claim["status"] == status
    if status == "approved":
        assert claim["signed_off_by"] == handler_id
        assert claim["paid_amount"] == 2000
    else:
        assert claim["signed_off_by"] is None
        assert claim["paid_on"] is None
        assert (
            client.post("/api/claims/CLM-1001/pay", json={"amount": 1000}).status_code
            == 403
        )
        signed = client.post(
            "/api/claims/CLM-1001/sign-off", json={"handler_id": "HND-01"}
        ).json()
        assert signed["status"] == "approved"
        assert signed["reviewed_by"] == "HND-03"
        assert signed["paid_amount"] == 2000


@pytest.mark.parametrize(
    "changes",
    [
        {"handler_id": "UNKNOWN"},
        {"payout": -1},
        {"payout": "NaN"},
        {"payout": "Infinity"},
        {"decision": "decline", "payout": 10},
        {"decision": "refer"},
        {"reason": "  "},
        {"reference": ""},
    ],
)
def test_invalid_review_changes_nothing(changes):
    start_claim()
    before = refer().json()
    assert review(**changes).status_code in {404, 422}
    assert client.get("/api/claims/CLM-1001").json() == before
    assert len(client.get("/api/claims/CLM-1001/steps").json()) == 1


def test_review_and_referral_require_correct_state():
    assert refer().status_code == 409
    assert review().status_code == 409
    start_claim()
    refer()
    assert refer().status_code == 409
    assert (
        client.post(
            "/api/claims/UNKNOWN/refer", json={"reason": REASON, "reference": REFERENCE}
        ).status_code
        == 404
    )
    assert (
        client.post("/api/claims/UNKNOWN/human-review", json=REVIEW).status_code == 404
    )


@pytest.mark.parametrize("decision", ["decline", "refer"])
def test_nonapproval_cannot_carry_payout(decision):
    start_claim()
    assert (
        client.post(
            "/api/claims/CLM-1001/decide",
            json={
                "decision": decision,
                "payout": 1,
                "reason": REASON,
                "reference": REFERENCE,
            },
        ).status_code
        == 422
    )
    assert client.get("/api/claims/CLM-1001").json()["decision"] is None


def test_competing_reviews_resolve_only_once():
    start_claim()
    refer()
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: review(), range(2)))
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert len(client.get("/api/claims/CLM-1001/steps").json()) == 2
    assert client.get("/api/claims/CLM-1001").json()["paid_amount"] == 420


def test_failed_activity_write_rolls_back_review_and_payment(monkeypatch):
    start_claim()
    before = refer().json()

    def fail_step(*args):
        raise HTTPException(500, "Activity write failed")

    monkeypatch.setattr(lifecycle, "record_step", fail_step)
    assert review().status_code == 500
    assert client.get("/api/claims/CLM-1001").json() == before


def test_openapi_operations_require_all_review_inputs():
    schema = client.get("/openapi.json").json()
    for path, name, body in [
        ("refer", "refer_human", "Referral"),
        ("human-review", "resolve_human_review", "HumanReview"),
    ]:
        assert (
            schema["paths"][f"/api/claims/{{claim_id}}/{path}"]["post"]["operationId"]
            == name
        )
        fields = schema["components"]["schemas"][body]
        assert set(fields["required"]) == set(fields["properties"])
