# Status

The pilot build, from `docs/PLAN.md`. Phases 1 to 5 of 6 are done: the backend, the agent, and the dashboard's queue page.

## What's built

- `backend/database.py`: the schema and a connection per call, at `undercover.db` or the path in `UNDERCOVER_DB`
- `backend/seed.py`: fills an empty database from the six record files in `data/` (never `evals/`, `security/` or the claims manual); the queue's claims seed as `waiting`
- `backend/main.py`: seeds on startup, `GET /api/health`, the read operations (`list_claims`, `get_claim`, `list_steps`, `get_policy`, `get_customer`, `get_plan`, `list_add_ons`, `list_handlers`, `get_policy_wording`, `get_agent_instructions`), and the claim lifecycle: `add_step`, `decide_claim`, `pay_claim` (blocked over $1,000 without sign-off) and `sign_off_claim` (which pays the approved payout)
- `backend/schemas.py`: the request bodies, all fields required
- `backend/instructions.md`: the agent's instructions, served read-only by the API

- `agent/main.py`: the UnderCover Agent. `run(claim_id, thread_id)` fetches its instructions from the backend, then works the claim with tools that read and act only through the backend's API: `get_claim`, `get_policy`, `get_customer`, `get_plan`, `list_add_ons`, `get_policy_wording`, `decide_claim` and `pay_claim`. Each tool records a step on the claim, so the dashboard can follow the work as it happens. Tool errors, such as a payment blocked over $1,000, come back to the model as text.
- `backend/main.py` also runs the agent: `POST /api/claims/{claim_id}/run` sets the claim `in_progress` and returns the agent's reply. The agent runs on `openai/gpt-6-luna` with low reasoning effort, or the model in `MODEL_NAME`.

A claim moves `waiting` → `in_progress` → `decided`, or `waiting_for_sign_off` → `decided` when a handler signs off. The $1,000 rule is enforced by the backend, not the agent's instructions.

- `dashboard/`: the claims team's dashboard. Hash routes: `#/` the queue, `#/claims/{id}` a claim (placeholder until Phase 6), `#/agent` the instructions (placeholder until Phase 6). The queue table shows every claim with its customer, type, date, amount claimed, payout and a status chip, in the brand's colors and fonts, in light and dark mode. It polls the backend every 2 seconds, so the queue follows the agent as it works. A Run agent button on waiting claims calls `run_agent`; queue-load and agent-run errors show in a banner. `src/lib/api.ts` is the typed API client; `src/hooks/useHashRoute.ts` follows the page's hash.

## How to run it

`npm run dev` starts the backend and the dashboard. `npm run check` runs every check.

## Pending

- Phase 6 of the plan: the claim detail page (story, items, documents, steps, decision, sign-off) and the agent instructions page
