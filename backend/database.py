"""The UnderCover backend's SQLite database."""

import os
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS claims (
    claim_id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    claim_type TEXT NOT NULL,
    submitted_on TEXT NOT NULL,
    incident_date TEXT NOT NULL,
    incident_location TEXT NOT NULL,
    summary TEXT NOT NULL,
    story TEXT NOT NULL,
    items TEXT NOT NULL,
    amount_claimed REAL NOT NULL,
    documents TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    decision TEXT,
    payout REAL,
    reason TEXT,
    reference TEXT,
    decided_on TEXT,
    signed_off_by TEXT,
    signed_off_on TEXT,
    paid_amount REAL,
    paid_on TEXT
);
CREATE TABLE IF NOT EXISTS policies (
    policy_id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    add_ons TEXT NOT NULL,
    purchased_on TEXT NOT NULL,
    sold_through TEXT NOT NULL,
    trip TEXT NOT NULL,
    travelers TEXT NOT NULL,
    status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
    customer_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    address TEXT NOT NULL,
    customer_since TEXT NOT NULL,
    previous_claims TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
    plan TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    trip_cancellation_max REAL NOT NULL,
    trip_delay_waiting_hours INTEGER NOT NULL,
    trip_delay_max REAL NOT NULL,
    baggage_delay_waiting_hours INTEGER NOT NULL,
    baggage_delay_max REAL NOT NULL,
    baggage_max REAL NOT NULL,
    per_item_limit REAL NOT NULL,
    passport_max REAL NOT NULL,
    emergency_medical_max REAL NOT NULL,
    deductible REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS add_ons (
    add_on TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    effect TEXT NOT NULL,
    electronics_per_item_limit REAL
);
CREATE TABLE IF NOT EXISTS handlers (
    handler_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    email TEXT NOT NULL,
    can_approve_over_limit INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS company (
    settings TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id TEXT NOT NULL,
    step TEXT NOT NULL,
    at TEXT NOT NULL
);
"""


def db_path() -> Path:
    """Return the database file's path, from UNDERCOVER_DB or the repo root."""
    return Path(os.environ.get("UNDERCOVER_DB", "undercover.db"))


def connect() -> sqlite3.Connection:
    """Return a connection to the database with its schema in place."""
    connection = sqlite3.connect(db_path())
    connection.row_factory = sqlite3.Row
    connection.executescript(SCHEMA)
    return connection
