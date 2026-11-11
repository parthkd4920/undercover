# Status

The claims pilot in `docs/PLAN.md` is complete, including the five completion phases identified during the November 11, 2026 review. The backend, agent, queue, claim detail and read-only instructions pages are implemented.

## Architecture and features

- `backend/database.py` owns the SQLite schema and opens a connection per call. The default database is `undercover.db`; `UNDERCOVER_DB` overrides its path.
- `backend/seed.py` fills an empty database from six business-record JSON files: 25 claims, 50 policies, 49 customers, three plans, three add-ons, three handlers and company settings. It never loads the answer key, security records or claims manual. Restarting does not duplicate records.
- `backend/main.py` is the FastAPI application. Startup seeds the database. Read operations serve the queue, full claims, ordered steps, policies, customers, plans, add-ons, handlers, policy wording and agent instructions. The health endpoint is `/api/health`; interactive API documentation is at `/docs` on the backend.
- Claim operations run the agent, record steps, decide, pay and sign off. Decisions require an `in_progress` claim and cannot overwrite a recorded decision. Approvals above $1,000 enter `waiting_for_sign_off`. Every payment against such an approval requires sign-off, even if the requested amount is $1,000 or less. Sign-off requires an eligible handler, pays the approved payout and records the signer and date. Duplicate payments and payments above the approved payout are refused. `backend/schemas.py` requires all request fields and rejects negative or non-finite money values.
- `backend/instructions.md` holds the instructions served read only to both the agent and dashboard. The backend serves `data/policy_wording.md` as the contract for decisions.
- `agent/main.py` exposes `run(claim_id, thread_id)` and uses LangChain's `create_agent` with OpenRouter. It fetches instructions on each run and reads and acts exclusively through the backend API. Its eight tools read the claim, policy, customer history, plan, add-ons and wording, then decide and pay. Each tool records a step; backend errors return to the model as text. The default model is `openai/gpt-6-luna` with low reasoning effort; `MODEL_NAME` overrides it. The backend's run operation uses the claim id as the thread id.
- `dashboard/src/App.tsx` selects pages through hash routes. `src/lib/api.ts` supplies typed API calls. The dashboard follows the brand fonts and colors, switches themes using the system preference, and supports narrow screens with horizontally scrolling tables and wrapping controls. Links, buttons and handler selection have visible keyboard focus.

## Dashboard routes

- `#/`: all claims with customer, type, date, claimed amount, payout and status. Waiting claims have a Run agent button. The queue refreshes every two seconds and displays load/run errors.
- `#/claims/{id}`: the story, claimed items, document contents, customer history, policy/trip, ordered agent steps, decision/reason/policy reference, payment and signer. Active claims refresh every two seconds after requests complete and stop polling when finished or unmounted. Changing claims clears the previous page and ignores late responses. Failed supporting requests have visible errors. Over-limit approvals offer only eligible handlers for sign-off, prevent submission while signing, and display sign-off errors. Declines and referrals do not display payment/sign-off messages; an unpaid within-limit approval displays Payment pending.
- `#/agent`: instructions fetched from the same API used by the agent and rendered as read-only headings, paragraphs and lists. Failed loads display an error.

A claim moves `waiting` → `in_progress` → `decided`, or `in_progress` → `waiting_for_sign_off` → `decided`. Within-limit approval and payment are separate operations: the decision sets `decided`, and the agent then pays it. The page distinguishes an unpaid approval from a paid one.

## How to run

Install with `uv sync` and `npm install` at the repository root. The project uses Python 3.12 and Node as specified in `docs/TECH_STACK.md`. Put `OPENROUTER_API_KEY` in `.env`; optionally set `MODEL_NAME`.

`npm run dev` starts the backend at `http://127.0.0.1:8000` and the dashboard at `http://localhost:5173`. Vite proxies `/api` to the backend; `UNDERCOVER_API_URL` can override its proxy target. Real agent runs require the backend to remain available while the agent calls its tools.

## Verification

`npm run check` runs Python formatting/lint/type checks and pytest, TypeScript formatting/lint/type checks and Vitest, and Playwright browser tests. Tests use stub models or prepared records and make no paid model calls.

The completion checks cover 58 Python tests (99.67% coverage), 31 dashboard tests (96.38% statement coverage), and 11 browser tests. Coverage thresholds remain at 80%. Browser checks cover sign-off/payment, read-only instructions, all six claim outcomes, keyboard focus, and the three pages at 1440px and 390px in light and dark mode.

`npm run e2e` starts dedicated servers on ports 18000 and 15173, refuses to reuse running servers, and uses a fresh temporary database that is removed on normal shutdown. It cannot reuse the development backend. Browser review screenshots are generated under ignored `e2e/test-results/`; Playwright Chromium screenshots were inspected directly because a Playwright MCP server was unavailable. Two consecutive fresh browser runs passed before the visual review; the expanded suite also passed after layout fixes.

## Known limitations

- A model or network failure during a run can leave a claim `in_progress`; the queue only offers Run agent on waiting claims. There is no automatic retry or recovery action. A regression test documents this behavior. A run that returns without deciding can likewise leave the claim in progress.
- A failed initial claim load stops polling; reload the page to retry. Supporting-record errors are retried on the next active-claim poll or page reload.
- There is no durable agent checkpointing or persisted thread conversation. The thread id is passed to the agent configuration, but does not provide recovery.
- These checks verify application behavior, not decision accuracy against the held-out answer key. This completion work did not inspect `data/evals/` or make a new live-model run; the original pilot plan records an earlier live check.
- The pilot has no sign-in, real payments or customer messages, and the agent does not use the claims manual. Later course builds are outside the current `docs/` scope. No AWS resources were created or deleted.

## Outcome and human-review change progress

Phase 1 is verified: legacy records migrate transactionally and idempotently to explicit statuses, adding referral/reviewer fields. Within-limit approvals remain in progress until payment; payment/sign-off end as approved, declines as declined, referrals as waiting for human review. Python checks pass: 60 tests, 99.71% coverage. The dashboard update and handler workflow are in progress.

Phase 2 is verified: `refer_human` and `resolve_human_review` API operations preserve referral/reviewer records and enforce payout authority in write transactions. Competing reviews resolve once, and failed activity writes roll back the decision/payment. The legacy refer decision delegates to the same handoff logic. Python checks pass: 80 tests, 99.05% coverage.
