# Status

The pilot build, from `docs/PLAN.md`. Phase 1 of 6 is done: the backend has its SQLite database, seeded from `data/`.

## What's built

- `backend/database.py`: the schema and a connection per call, at `undercover.db` or the path in `UNDERCOVER_DB`
- `backend/seed.py`: fills an empty database from the six record files in `data/` (never `evals/`, `security/` or the claims manual); the queue's claims seed as `waiting`
- `backend/main.py`: seeds on startup, `GET /api/health`, and the read operations: `list_claims`, `get_claim`, `list_steps`, `get_policy`, `get_customer`, `get_plan`, `list_add_ons`, `list_handlers`, `get_policy_wording`, `get_agent_instructions`
- `backend/instructions.md`: the agent's instructions, served read-only by the API

## How to run it

`npm run dev` starts the backend and the dashboard. `npm run check` runs every check.

## Pending

- Phases 3 to 6 of the plan: the claim lifecycle, the agent, and the dashboard
