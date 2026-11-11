"""Safe, actionable diagnostics for agent runs that fail after saving work."""

import sqlite3
from http import HTTPStatus

import httpx
from openai import APIConnectionError, APIStatusError


def describe_error(error: Exception) -> str:
    """Describe the failure category without returning provider payloads or secrets."""
    if isinstance(error, APIStatusError):
        if error.status_code == HTTPStatus.TOO_MANY_REQUESTS:
            return "The model provider rate-limited this run (HTTP 429)."
        return f"The model provider rejected this run (HTTP {error.status_code})."
    if isinstance(error, APIConnectionError):
        return "The connection to the model provider failed or timed out."
    if isinstance(error, httpx.TimeoutException):
        return "An agent request to the backend timed out."
    if isinstance(error, httpx.HTTPStatusError):
        return f"An agent backend request failed (HTTP {error.response.status_code})."
    return f"The agent run failed ({type(error).__name__})."


def saved_work(row: sqlite3.Row) -> str:
    """Explain persisted work so a failed reply is not mistaken for a lost outcome."""
    status = row["status"].replace("_", " ").replace("sign off", "sign-off")
    if row["paid_on"] is not None:
        return (
            f"Saved status: {status}; payment of "
            f"${row['paid_amount']:,.2f} is recorded."
        )
    if row["decision"] == "approve":
        return f"Saved status: {status}; approval recorded, payment is not recorded."
    return f"Saved status: {status}; payment is not recorded."
