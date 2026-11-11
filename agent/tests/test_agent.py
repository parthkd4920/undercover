"""Tests for the UnderCover Agent."""

from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from agent import main
from backend.main import app


class StubModel(GenericFakeChatModel):
    """A chat model that gives scripted replies in place of a real model."""

    def bind_tools(self, tools, **kwargs):
        return self


def tool_call(name: str, args: dict, id: str) -> AIMessage:
    """Return a scripted model turn that calls one tool."""
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": id}])


def work_a_claim(
    replies: list[AIMessage], client: TestClient, monkeypatch
) -> TestClient:
    """Run the agent with scripted replies against the backend test client."""
    monkeypatch.setattr(main, "backend", lambda: client)
    main.run("CLM-1001", "CLM-1001", StubModel(messages=iter(replies)))
    return client


def test_instructions_come_from_the_backend(monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(main, "backend", lambda: client)
    assert "You are the UnderCover Agent" in main.instructions()


def test_run_reads_the_records_then_decides_and_pays(monkeypatch):
    client = work_a_claim(
        [
            tool_call("get_claim", {"claim_id": "CLM-1001"}, "1"),
            tool_call("get_policy", {"policy_id": "POL-2001"}, "2"),
            tool_call("get_customer", {"customer_id": "CUS-3001"}, "3"),
            tool_call("get_plan", {"plan": "premium"}, "4"),
            tool_call("list_add_ons", {}, "5"),
            tool_call("get_policy_wording", {}, "6"),
            tool_call(
                "decide_claim",
                {
                    "claim_id": "CLM-1001",
                    "decision": "approve",
                    "payout": 420.0,
                    "reason": "The carrier canceled the flight and the delay was past"
                    " the waiting period.",
                    "reference": "Policy wording, section 3",
                },
                "7",
            ),
            tool_call("pay_claim", {"claim_id": "CLM-1001", "amount": 420.0}, "8"),
            AIMessage(content="Claim CLM-1001 approved and paid."),
        ],
        TestClient(app),
        monkeypatch,
    )
    claim = client.get("/api/claims/CLM-1001").json()
    assert claim["status"] == "decided"
    assert claim["decision"] == "approve"
    assert claim["payout"] == 420.0
    assert claim["paid_amount"] == 420.0
    steps = client.get("/api/claims/CLM-1001/steps").json()
    assert [step["step"] for step in steps] == [
        "Read claim CLM-1001",
        "Read policy POL-2001",
        "Read customer CUS-3001",
        "Read the premium plan",
        "Read the add-ons",
        "Read the policy wording",
        "Decision on CLM-1001: approve, payout $420.00",
        "Paid $420.00 on CLM-1001",
    ]


def test_run_over_the_limit_leaves_the_claim_waiting_for_sign_off(monkeypatch):
    client = work_a_claim(
        [
            tool_call("get_claim", {"claim_id": "CLM-1001"}, "1"),
            tool_call("get_policy_wording", {}, "2"),
            tool_call(
                "decide_claim",
                {
                    "claim_id": "CLM-1001",
                    "decision": "approve",
                    "payout": 2000.0,
                    "reason": "The baggage and its receipts are covered.",
                    "reference": "Policy wording, section 5",
                },
                "3",
            ),
            tool_call("pay_claim", {"claim_id": "CLM-1001", "amount": 2000.0}, "4"),
            AIMessage(content="Approved; the payout waits for sign-off."),
        ],
        TestClient(app),
        monkeypatch,
    )
    claim = client.get("/api/claims/CLM-1001").json()
    assert claim["status"] == "waiting_for_sign_off"
    assert claim["paid_on"] is None
    steps = client.get("/api/claims/CLM-1001/steps").json()
    assert steps[-1]["step"] == "Could not pay $2,000.00 on CLM-1001"


def test_run_returns_the_blocked_payment_message(monkeypatch):
    replies = [
        tool_call("get_claim", {"claim_id": "CLM-1001"}, "1"),
        tool_call(
            "decide_claim",
            {
                "claim_id": "CLM-1001",
                "decision": "approve",
                "payout": 2000.0,
                "reason": "Covered.",
                "reference": "Policy wording, section 5",
            },
            "2",
        ),
        tool_call("pay_claim", {"claim_id": "CLM-1001", "amount": 2000.0}, "3"),
        AIMessage(content="The payout waits for a handler's sign-off."),
    ]
    client = TestClient(app)
    monkeypatch.setattr(main, "backend", lambda: client)
    reply = main.run("CLM-1001", "CLM-1001", StubModel(messages=iter(replies)))
    assert reply == "The payout waits for a handler's sign-off."


def test_model_name(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.delenv("MODEL_NAME", raising=False)
    assert main.model().model_name == "openai/gpt-6-luna"
    monkeypatch.setenv("MODEL_NAME", "openrouter/free")
    assert main.model().model_name == "openrouter/free"
