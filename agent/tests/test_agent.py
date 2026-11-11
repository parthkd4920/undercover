"""Tests for the UnderCover Agent."""

from contextlib import closing

import httpx
import pytest
from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from agent import main
from backend import database
from backend.main import app


@pytest.fixture(autouse=True)
def start_claim(fresh_database):
    """Arrange the running claim without invoking a paid model."""
    with closing(database.connect()) as connection:
        connection.execute(
            "UPDATE claims SET status = 'in_progress' WHERE claim_id = 'CLM-1001'"
        )
        connection.commit()


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
    assert claim["status"] == "approved"
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


@pytest.mark.parametrize(
    "reason",
    [
        "The required receipt is missing; a handler needs to assess the evidence.",
        "The story conflicts with the notice; a handler must resolve the dates.",
        "Policy applicability is ambiguous; a handler must determine coverage.",
    ],
)
def test_uncertain_cases_are_referred_without_payment(reason, monkeypatch):
    client = work_a_claim(
        [
            tool_call(
                "refer_human",
                {
                    "reason": reason,
                    "reference": "Applicability unclear; review section 3",
                },
                "1",
            ),
            AIMessage(content="Referred to a human for review."),
        ],
        TestClient(app),
        monkeypatch,
    )
    claim = client.get("/api/claims/CLM-1001").json()
    assert claim["status"] == "waiting_for_human_review"
    assert claim["referral_reason"] == reason
    assert claim["paid_on"] is None
    assert (
        client.get("/api/claims/CLM-1001/steps")
        .json()[0]["step"]
        .startswith("Referred to a human")
    )


def test_clear_exclusion_is_declined(monkeypatch):
    client = work_a_claim(
        [
            tool_call(
                "decide_claim",
                {
                    "claim_id": "CLM-1001",
                    "decision": "decline",
                    "payout": 0,
                    "reason": "The incident is outside the insured trip dates.",
                    "reference": "Section 9",
                },
                "1",
            ),
            AIMessage(content="The claim was declined under section 9."),
        ],
        TestClient(app),
        monkeypatch,
    )
    claim = client.get("/api/claims/CLM-1001").json()
    assert claim["status"] == "declined"
    assert claim["referred_on"] is None
    assert claim["paid_on"] is None


def test_human_resolution_is_not_an_agent_tool():
    names = {tool.name for tool in main.tools_for("CLM-1001")}
    assert "refer_human" in names
    assert "resolve_human_review" not in names


def test_referral_error_is_returned_to_the_model(monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(main, "backend", lambda: client)
    referral = next(
        tool for tool in main.tools_for("CLM-1001") if tool.name == "refer_human"
    )
    body = {"reason": "Missing evidence", "reference": "Section 3"}
    referral.invoke(body)
    result = referral.invoke(body)
    assert result.startswith("Error:")
    assert "not in progress" in result
    assert client.get("/api/claims/CLM-1001").json()["paid_on"] is None


@pytest.mark.parametrize("body", ["Internal Server Error", "{}", "[]"])
def test_nonstandard_backend_error_is_returned_to_model(body, monkeypatch):
    """A plain-text server error must not crash the tool's JSON decoder."""
    transport = httpx.MockTransport(lambda _: httpx.Response(500, text=body))
    monkeypatch.setattr(
        main,
        "backend",
        lambda: httpx.Client(transport=transport, base_url="http://backend.test"),
    )
    result = main.call("POST", "/api/claims/CLM-1001/pay", amount=420)
    assert result.startswith("Error:")
    assert "HTTP 500" in result


def test_backend_timeout_is_returned_with_saved_work_caution(monkeypatch):
    """A lost action reply must not be interpreted as proof that nothing was saved."""

    def timeout(request):
        raise httpx.ReadTimeout("private transport details", request=request)

    monkeypatch.setattr(
        main,
        "backend",
        lambda: httpx.Client(
            transport=httpx.MockTransport(timeout), base_url="http://backend.test"
        ),
    )
    result = main.call("POST", "/api/claims/CLM-1001/pay", amount=420)
    assert "ReadTimeout" in result
    assert "request may already have saved work" in result
    assert "private transport details" not in result
