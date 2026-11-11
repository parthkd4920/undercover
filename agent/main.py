"""The UnderCover Agent."""

import json
import os

import httpx
from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_core.language_models import BaseChatModel
from langchain_core.tools import BaseTool, tool
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

load_dotenv(override=True)

BACKEND_URL = "http://localhost:8000"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "openai/gpt-6-luna"


def backend() -> httpx.Client:
    """Return a client for the UnderCover backend."""
    return httpx.Client(base_url=BACKEND_URL, timeout=10)


def model() -> ChatOpenAI:
    """Return the model named in MODEL_NAME, or GPT-6 Luna by default."""
    name = os.getenv("MODEL_NAME")
    return ChatOpenAI(
        model=name or DEFAULT_MODEL,
        base_url=OPENROUTER_BASE_URL,
        api_key=SecretStr(os.environ["OPENROUTER_API_KEY"]),
        reasoning_effort=None if name else "low",
    )


def money(amount: float) -> str:
    """Format an amount as dollars, such as $1,250.00."""
    return f"${amount:,.2f}"


def call(method: str, path: str, **body: object) -> str:
    """Call the backend and return its reply, or the error it reports."""
    with backend() as client:
        response = client.request(method, path, json=body or None)
    if response.is_error:
        return f"Error: {response.json()['detail']}"
    return json.dumps(response.json(), indent=2)


def instructions() -> str:
    """Fetch the agent's instructions from the backend."""
    with backend() as client:
        response = client.get("/api/agent-instructions")
    response.raise_for_status()
    return response.json()["instructions"]


def tools_for(claim_id: str) -> list[BaseTool]:
    """Build the agent's tools, each recording its step on the claim being worked."""
    return reading_tools_for(claim_id) + action_tools_for(claim_id)


def reading_tools_for(claim_id: str) -> list[BaseTool]:
    """Build the tools that read a claim's records."""

    def record(step: str) -> None:
        """Tell the backend one step of the agent's work on the claim."""
        call("POST", f"/api/claims/{claim_id}/steps", step=step)

    @tool
    def get_claim(claim_id: str) -> str:
        """Read one claim in full: the story, the items claimed and the documents."""
        result = call("GET", f"/api/claims/{claim_id}")
        record(f"Read claim {claim_id}")
        return result

    @tool
    def get_policy(policy_id: str) -> str:
        """Read the policy behind a claim: its plan, add-ons, trip and travelers."""
        result = call("GET", f"/api/policies/{policy_id}")
        record(f"Read policy {policy_id}")
        return result

    @tool
    def get_customer(customer_id: str) -> str:
        """Read a customer's contact details and their claim history."""
        result = call("GET", f"/api/customers/{customer_id}")
        record(f"Read customer {customer_id}")
        return result

    @tool
    def get_plan(plan: str) -> str:
        """Read one plan's limits and deductible."""
        result = call("GET", f"/api/plans/{plan}")
        record(f"Read the {plan} plan")
        return result

    @tool
    def list_add_ons() -> str:
        """Read the add-ons a policy can carry and what each one covers."""
        result = call("GET", "/api/add-ons")
        record("Read the add-ons")
        return result

    @tool
    def get_policy_wording() -> str:
        """Read the policy wording, the contract every decision follows."""
        result = call("GET", "/api/policy-wording")
        record("Read the policy wording")
        return result

    return [
        get_claim,
        get_policy,
        get_customer,
        get_plan,
        list_add_ons,
        get_policy_wording,
    ]


def action_tools_for(claim_id: str) -> list[BaseTool]:
    """Build the tools that decide and pay a claim."""

    def record(step: str) -> None:
        """Tell the backend one step of the agent's work on the claim."""
        call("POST", f"/api/claims/{claim_id}/steps", step=step)

    @tool
    def decide_claim(
        claim_id: str, decision: str, payout: float, reason: str, reference: str
    ) -> str:
        """Record the decision on a claim: approve, decline or refer, with the payout,
        the reason and the section of the policy wording it rests on."""
        result = call(
            "POST",
            f"/api/claims/{claim_id}/decide",
            decision=decision,
            payout=payout,
            reason=reason,
            reference=reference,
        )
        payment = f", payout {money(payout)}" if decision == "approve" else ""
        record(f"Decision on {claim_id}: {decision}{payment}")
        return result

    @tool
    def pay_claim(claim_id: str, amount: float) -> str:
        """Pay an approved claim; payouts over $1,000 are blocked until a
        handler signs off."""
        result = call("POST", f"/api/claims/{claim_id}/pay", amount=amount)
        if result.startswith("Error"):
            record(f"Could not pay {money(amount)} on {claim_id}")
        else:
            record(f"Paid {money(amount)} on {claim_id}")
        return result

    return [decide_claim, pay_claim]


def run(claim_id: str, thread_id: str, llm: BaseChatModel | None = None) -> str:
    """Run the agent on one claim and return its final reply."""
    agent = create_agent(
        llm or model(),
        tools=tools_for(claim_id),
        system_prompt=instructions(),
    )
    result = agent.invoke(
        {"messages": [{"role": "user", "content": f"Work claim {claim_id}."}]},
        config={"configurable": {"thread_id": thread_id}},
    )
    return result["messages"][-1].text
