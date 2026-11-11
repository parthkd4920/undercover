"""Request bodies for the backend's operations."""

from typing import Literal

from pydantic import BaseModel, Field


class Decision(BaseModel):
    """A decision on a claim."""

    decision: Literal["approve", "decline", "refer"]
    payout: float = Field(ge=0, allow_inf_nan=False)
    reason: str
    reference: str


class Payment(BaseModel):
    """A payment on a claim."""

    amount: float = Field(ge=0, allow_inf_nan=False)


class SignOff(BaseModel):
    """A handler's sign-off on a claim."""

    handler_id: str


class Step(BaseModel):
    """One step of the agent's work on a claim."""

    step: str
