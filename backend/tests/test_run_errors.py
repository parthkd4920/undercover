"""Failed model replies must not hide or overwrite saved claim work."""

from contextlib import closing

import httpx
import httpx2
import pytest
from fastapi.testclient import TestClient
from openai import APIConnectionError, APIStatusError

from backend import database, lifecycle
from backend.main import app
from backend.schemas import Decision, Referral

client = TestClient(app)


@pytest.mark.parametrize("outcome", ["paid", "approval", "refer", "decline"])
def test_failure_reports_preserved_work(outcome, monkeypatch, caplog):
    """An exception after a successful tool call must describe the committed state."""

    def fail_after_tool(claim_id, thread_id):
        with closing(database.connect()) as connection:
            if outcome == "refer":
                lifecycle.refer(
                    connection,
                    claim_id,
                    Referral(reason="Missing evidence", reference="Section 3"),
                )
            else:
                decision = "decline" if outcome == "decline" else "approve"
                lifecycle.decide(
                    connection,
                    claim_id,
                    Decision(
                        decision=decision,
                        payout=0 if decision == "decline" else 210,
                        reason="Policy decision",
                        reference="Section 3",
                    ),
                )
                if outcome == "paid":
                    lifecycle.pay(connection, claim_id, 210)
            connection.commit()
        raise RuntimeError("private provider payload must stay out of the response")

    monkeypatch.setattr("agent.main.run", fail_after_tool)
    response = client.post("/api/claims/CLM-1001/run")
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert "private provider payload" not in detail
    assert "CLM-1001" in caplog.text
    claim = client.get("/api/claims/CLM-1001").json()
    if outcome == "paid":
        assert claim["status"] == "approved"
        assert claim["paid_amount"] == 210
        assert "payment of $210.00 is recorded" in detail
    elif outcome == "approval":
        assert claim["status"] == "in_progress"
        assert "approval recorded, payment is not recorded" in detail
    elif outcome == "refer":
        assert claim["status"] == "waiting_for_human_review"
        assert "waiting for human review" in detail
    else:
        assert claim["status"] == "declined"
        assert "Saved status: declined" in detail


@pytest.mark.parametrize(
    "category", ["rate", "provider", "connection", "timeout", "backend"]
)
def test_run_failure_has_actionable_safe_detail(category, monkeypatch):
    request = httpx.Request("POST", "https://provider.invalid")
    response = httpx.Response(429 if category == "rate" else 500, request=request)
    provider_request = httpx2.Request("POST", "https://provider.invalid")
    provider_response = httpx2.Response(
        429 if category == "rate" else 500, request=provider_request
    )
    errors = {
        "rate": APIStatusError("private", response=provider_response, body={}),
        "provider": APIStatusError("private", response=provider_response, body={}),
        "connection": APIConnectionError(request=provider_request),
        "timeout": httpx.ReadTimeout("private"),
        "backend": httpx.HTTPStatusError("private", request=request, response=response),
    }
    expected = {
        "rate": "rate-limited",
        "provider": "model provider rejected",
        "connection": "connection to the model provider",
        "timeout": "backend timed out",
        "backend": "backend request failed",
    }

    def fail_run(claim_id, thread_id):
        raise errors[category]

    monkeypatch.setattr("agent.main.run", fail_run)
    result = client.post("/api/claims/CLM-1001/run")
    assert result.status_code == 502
    assert expected[category] in result.json()["detail"]
    assert "private" not in result.json()["detail"]
