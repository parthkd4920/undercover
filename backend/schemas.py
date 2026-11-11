"""Request bodies for the backend's operations."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class Decision(BaseModel):
    """A decision on a claim."""

    decision: Literal["approve", "decline", "refer"]
    payout: float = Field(ge=0, allow_inf_nan=False)
    reason: Text
    reference: Text

    @model_validator(mode="after")
    def validate_payout(self):
        """Only approvals may carry a nonzero payout."""
        if self.decision != "approve" and self.payout != 0:
            raise ValueError("Only approvals may have a payout")
        return self


class Payment(BaseModel):
    """A payment on a claim."""

    amount: float = Field(ge=0, allow_inf_nan=False)


class SignOff(BaseModel):
    """A handler's sign-off on a claim."""

    handler_id: str


class Step(BaseModel):
    """One step of the agent's work on a claim."""

    step: str


class Referral(BaseModel):
    """An actionable reason for human review."""

    reason: Text
    reference: Text


class HumanReview(BaseModel):
    """A handler's final decision on a referred claim."""

    handler_id: str
    decision: Literal["approve", "decline"]
    payout: float = Field(ge=0, allow_inf_nan=False)
    reason: Text
    reference: Text

    @model_validator(mode="after")
    def validate_payout(self):
        """A denied review cannot authorize a payout."""
        if self.decision == "decline" and self.payout != 0:
            raise ValueError("Only approvals may have a payout")
        return self
