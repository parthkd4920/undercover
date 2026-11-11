"""Tests for the backend's read operations."""

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_list_claims():
    response = client.get("/api/claims")
    assert response.status_code == 200
    claims = response.json()
    assert len(claims) == 25
    claim = next(c for c in claims if c["claim_id"] == "CLM-1001")
    assert claim["claim_type"] == "trip_delay"
    assert claim["status"] == "waiting"
    assert claim["customer_name"] == "Maya Patel"
    assert claim["amount_claimed"] == 420.0
    assert claim["decision"] is None
    assert claim["payout"] is None


def test_get_claim():
    response = client.get("/api/claims/CLM-1001")
    assert response.status_code == 200
    claim = response.json()
    assert claim["policy_id"] == "POL-2001"
    assert claim["customer_id"] == "CUS-3001"
    assert (
        claim["summary"]
        == "Flight home canceled by the airline, rebooked the next morning"
    )
    assert "Rome" in claim["story"]
    assert len(claim["items"]) == 3
    assert claim["items"][0] == {
        "description": "Airport hotel, one night",
        "category": "accommodation",
        "amount": 245.0,
    }
    assert len(claim["documents"]) == 4
    assert claim["documents"][0]["type"] == "carrier_report"
    assert claim["status"] == "waiting"


def test_get_claim_that_does_not_exist():
    assert client.get("/api/claims/CLM-9999").status_code == 404


def test_list_steps_on_an_unworked_claim():
    assert client.get("/api/claims/CLM-1001/steps").json() == []
    assert client.get("/api/claims/CLM-9999/steps").status_code == 404


def test_get_policy():
    response = client.get("/api/policies/POL-2001")
    assert response.status_code == 200
    policy = response.json()
    assert policy["customer_id"] == "CUS-3001"
    assert policy["plan"] == "premium"
    assert policy["add_ons"] == []
    assert policy["trip"]["destination"] == "Rome, Italy"
    assert policy["trip"]["trip_cost"] == 3100.0
    assert policy["travelers"] == ["Maya Patel"]
    assert policy["status"] == "active"


def test_get_policy_that_does_not_exist():
    assert client.get("/api/policies/POL-9999").status_code == 404


def test_get_customer():
    response = client.get("/api/customers/CUS-3001")
    assert response.status_code == 200
    customer = response.json()
    assert customer["name"] == "Maya Patel"
    assert customer["address"]["city"] == "Jersey City"
    assert customer["previous_claims"][0]["claim_id"] == "CLM-0412"
    assert customer["previous_claims"][0]["outcome"] == "approved"


def test_get_customer_that_does_not_exist():
    assert client.get("/api/customers/CUS-9999").status_code == 404


def test_get_plan():
    response = client.get("/api/plans/premium")
    assert response.status_code == 200
    plan = response.json()
    assert plan["name"] == "UnderCover Premium"
    assert plan["trip_delay_waiting_hours"] == 6
    assert plan["trip_delay_max"] == 800.0
    assert plan["baggage_max"] == 1500.0
    assert plan["per_item_limit"] == 300.0
    assert plan["deductible"] == 50.0


def test_get_plan_that_does_not_exist():
    assert client.get("/api/plans/platinum").status_code == 404


def test_list_add_ons():
    response = client.get("/api/add-ons")
    assert response.status_code == 200
    add_ons = response.json()
    assert len(add_ons) == 3
    electronics = next(a for a in add_ons if a["add_on"] == "electronics_plus")
    assert electronics["electronics_per_item_limit"] == 1200.0
    sports = next(a for a in add_ons if a["add_on"] == "adventure_sports")
    assert sports["electronics_per_item_limit"] is None


def test_list_handlers():
    response = client.get("/api/handlers")
    assert response.status_code == 200
    handlers = response.json()
    assert len(handlers) == 3
    assert handlers[0]["handler_id"] == "HND-01"
    assert handlers[0]["can_approve_over_limit"] is True


def test_get_policy_wording():
    response = client.get("/api/policy-wording")
    assert response.status_code == 200
    wording = response.json()["wording"]
    assert "UnderCover Travel Insurance: Policy Wording" in wording
    assert "Baggage and Personal Effects" in wording


def test_get_agent_instructions():
    response = client.get("/api/agent-instructions")
    assert response.status_code == 200
    instructions = response.json()["instructions"]
    assert "You are the UnderCover Agent" in instructions
    assert "$1,000" in instructions
