"""Request bodies for the backend's operations."""

from typing import Literal

from pydantic import BaseModel


class Decision(BaseModel):
    """A decision on a claim."""

    decision: Literal["approve", "decline", "refer"]
    payout: float
    reason: str
    reference: str


class Payment(BaseModel):
    """A payment on a claim."""

    amount: float


class SignOff(BaseModel):
    """A handler's sign-off on a claim."""

    handler_id: str


class Step(BaseModel):
    """One step of the agent's work on a claim."""

    step: str
