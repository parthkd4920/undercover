"""Seed the database from UnderCover's records in data/."""

import json
import sqlite3
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent.parent / "data"


def load(name: str) -> Any:
    """Return one of the record files in data/ as JSON."""
    return json.loads((DATA / name).read_text())


def seed(connection: sqlite3.Connection) -> bool:
    """Fill an empty database from the records in data/; return whether it seeded."""
    if connection.execute("SELECT COUNT(*) FROM claims").fetchone()[0]:
        return False
    _seed_claims(connection)
    _seed_policies(connection)
    _seed_customers(connection)
    _seed_plans(connection)
    _seed_handlers(connection)
    _seed_company(connection)
    connection.commit()
    return True


def _seed_claims(connection: sqlite3.Connection) -> None:
    """Load the twenty-five claims of the queue, all waiting."""
    connection.executemany(
        "INSERT INTO claims (claim_id, policy_id, customer_id, claim_type,"
        " submitted_on, incident_date, incident_location, summary, story,"
        " items, amount_claimed, documents, status)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')",
        [
            (
                claim["claim_id"],
                claim["policy_id"],
                claim["customer_id"],
                claim["claim_type"],
                claim["submitted_on"],
                claim["incident_date"],
                claim["incident_location"],
                claim["summary"],
                claim["story"],
                json.dumps(claim["items"]),
                claim["amount_claimed"],
                json.dumps(claim["documents"]),
            )
            for claim in load("claims.json")
        ],
    )


def _seed_policies(connection: sqlite3.Connection) -> None:
    """Load the policies, one per trip."""
    connection.executemany(
        "INSERT INTO policies (policy_id, customer_id, plan, add_ons,"
        " purchased_on, sold_through, trip, travelers, status)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                policy["policy_id"],
                policy["customer_id"],
                policy["plan"],
                json.dumps(policy["add_ons"]),
                policy["purchased_on"],
                policy["sold_through"],
                json.dumps(policy["trip"]),
                json.dumps(policy["travelers"]),
                policy["status"],
            )
            for policy in load("policies.json")
        ],
    )


def _seed_customers(connection: sqlite3.Connection) -> None:
    """Load the customers with their contact details and claim history."""
    connection.executemany(
        "INSERT INTO customers (customer_id, name, email, phone, date_of_birth,"
        " address, customer_since, previous_claims)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                customer["customer_id"],
                customer["name"],
                customer["email"],
                customer["phone"],
                customer["date_of_birth"],
                json.dumps(customer["address"]),
                customer["customer_since"],
                json.dumps(customer["previous_claims"]),
            )
            for customer in load("customers.json")
        ],
    )


def _seed_plans(connection: sqlite3.Connection) -> None:
    """Load the three plans and the add-ons a policy can carry."""
    plans = load("plans.json")
    connection.executemany(
        "INSERT INTO plans (plan, name, trip_cancellation_max,"
        " trip_delay_waiting_hours, trip_delay_max, baggage_delay_waiting_hours,"
        " baggage_delay_max, baggage_max, per_item_limit, passport_max,"
        " emergency_medical_max, deductible)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                plan["plan"],
                plan["name"],
                plan["trip_cancellation_max"],
                plan["trip_delay_waiting_hours"],
                plan["trip_delay_max"],
                plan["baggage_delay_waiting_hours"],
                plan["baggage_delay_max"],
                plan["baggage_max"],
                plan["per_item_limit"],
                plan["passport_max"],
                plan["emergency_medical_max"],
                plan["deductible"],
            )
            for plan in plans["plans"]
        ],
    )
    connection.executemany(
        "INSERT INTO add_ons (add_on, name, effect, electronics_per_item_limit)"
        " VALUES (?, ?, ?, ?)",
        [
            (
                add_on["add_on"],
                add_on["name"],
                add_on["effect"],
                add_on.get("electronics_per_item_limit"),
            )
            for add_on in plans["add_ons"]
        ],
    )


def _seed_handlers(connection: sqlite3.Connection) -> None:
    """Load the claims handlers."""
    connection.executemany(
        "INSERT INTO handlers (handler_id, name, role, email,"
        " can_approve_over_limit)"
        " VALUES (?, ?, ?, ?, ?)",
        [
            (
                handler["handler_id"],
                handler["name"],
                handler["role"],
                handler["email"],
                handler["can_approve_over_limit"],
            )
            for handler in load("handlers.json")
        ],
    )


def _seed_company(connection: sqlite3.Connection) -> None:
    """Load the company settings, including the payout approval limit."""
    connection.execute(
        "INSERT INTO company (settings) VALUES (?)",
        (json.dumps(load("company.json")),),
    )
