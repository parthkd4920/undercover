# Status

The pilot and the explicit-outcome/human-review change in `docs/PLAN.md` are implemented. Claims have six statuses: `waiting`, `in_progress`, `waiting_for_sign_off`, `waiting_for_human_review`, `approved`, and `declined`.

## Architecture

- `backend/database.py` opens SQLite connections at `undercover.db`, or the path in `UNDERCOVER_DB`. `backend/migrations.py` upgrades old databases transactionally and once only using SQLite schema version 1. It adds referral/reviewer fields, maps old `decided` records to their outcome or pending action, preserves business records and activity history, and does not reseed or reset them. Legacy referrals retain their original reason/reference/date and become pending human reviews. Unpaid approvals remain in progress or wait for sign-off. An inconsistent legacy record that cannot be mapped reports its claim id and rolls back the upgrade.
- `backend/seed.py` fills an empty database from six business-record JSON files: 25 claims, 50 policies, 49 customers, three plans, three add-ons, three handlers and company settings. It never loads `data/evals/`, security records or the claims manual.
- `backend/main.py` exposes FastAPI read operations for the queue, claims, ordered steps, policies, customers, plans, add-ons, handlers, policy wording and agent instructions. Health is `/api/health`; interactive API documentation is at `/docs`. Request bodies are in `backend/schemas.py`, with all fields required, nonblank decision/referral explanations and finite nonnegative amounts. Only approvals may carry nonzero payouts.
- `backend/lifecycle.py` handles decisions, payments, referrals, human resolution and sign-off under SQLite write transactions. Reviewer, decision, payment/sign-off and activity are committed together. Competing reviews resolve once; invalid or failed operations leave no partial decision or payment.
- `agent/main.py` exposes `run(claim_id, thread_id)`, using LangChain's `create_agent` through OpenRouter. It fetches `backend/instructions.md` through the API and uses nine API-only tools: claim, policy, customer, plan, add-ons, wording, decision, payment and `refer_human`. Clear policy outcomes stay automatic; missing evidence, conflicting accounts or unresolved applicability are referred with an actionable explanation. Instructions require the agent to stop after referral; human resolution is not exposed as an agent tool. The default model is `openai/gpt-6-luna` with low reasoning effort, or `MODEL_NAME` when set.
- `dashboard/src/App.tsx` selects hash routes, backed by the typed client in `src/lib/api.ts`. Components separate claim content, recorded decisions/sign-off and human review. Brand themes follow the system preference; tables scroll horizontally on narrow screens and controls have visible keyboard focus.

## Claim lifecycle and human review

Running a waiting claim sets `in_progress`. A clear denial becomes `declined` without payment. A within-limit approval records its decision and remains `in_progress` until the separate payment operation succeeds and sets `approved`. The page displays Approval recorded, payment pending in between. An approval above $1,000 waits for an eligible handler's sign-off; signing off records the signer, pays it, and sets `approved`.

`POST /api/claims/{id}/refer` (`refer_human`) accepts a reason and policy reference on an undecided running claim. It records the handoff as `waiting_for_human_review`, without payment or a final-decision timestamp. The old `decide_claim` refer option delegates to the same behavior and requires zero payout.

`POST /api/claims/{id}/human-review` (`resolve_human_review`) accepts a handler, approve/decline decision, payout, reason and reference. A denial sets `declined` with no payment. A within-limit human approval pays immediately. An over-limit approval pays immediately only if the reviewer has `can_approve_over_limit`; otherwise it waits for another eligible handler's sign-off. Payment checks use the approved payout, so a smaller requested payment cannot bypass sign-off. Duplicate payments and payments above the approved payout are blocked.

Claims retain `referral_reason`, `referral_reference` and `referred_on` separately from the final decision. `reviewed_by` and `reviewed_on` identify the reviewer; `signed_off_by` and `signed_off_on` identify any over-limit payment authorization. Every existing handler can review coverage, but only eligible handlers can authorize over-limit payments. The backend enforces these rules independently of the dashboard.

## Dashboard routes

- `#/`: queue with customer, type, date, claimed amount, payout and explicit status chips. A top selector and Run agent button work one waiting claim at a time; no batch dispatcher is added. The queue polls every two seconds and displays load/run errors.
- `#/claims/{id}`: story, items, document contents, customer history, policy/trip, steps, original referral, final reason/reference, reviewer, payment and signer. Referred claims show a handler selector, payout, reason/reference and Approve/Deny buttons; denial always submits zero payout. Sign-off remains a separate control on sign-off claims. Forms report errors and prevent double submission. Running, review and sign-off claims poll after requests complete, allowing another handler's resolution to remove stale controls. Final outcomes stop polling; navigation discards old responses.
- `#/agent`: the same instructions used by the agent, rendered read only as headings, paragraphs and lists. Failed requests display errors.

## Run and verify

At the repository root, install with `uv sync` and `npm install`, then run `npm run dev`. The backend is at `http://127.0.0.1:8000` and the dashboard at `http://localhost:5173`. Existing databases upgrade on the next database connection; restart the backend to load the new code. `OPENROUTER_API_KEY` in `.env` is required for real agent runs; `MODEL_NAME` is optional. Vite proxies `/api` to the backend, overridable with `UNDERCOVER_API_URL`.

`npm run check` runs Python formatting/lint/type checks and pytest, TypeScript formatting/lint/type checks and Vitest, and Playwright. Current coverage is 89 Python tests (99.30%), 47 dashboard tests (96.12% statements) and 21 browser tests. Thresholds remain at 80%; tests use stub models or prepared records without paid model calls.

Playwright refuses existing servers and uses dedicated ports 18000/15173 and a fresh temporary database. It cannot reuse the development backend. Browser journeys cover human approval/denial, over-limit approvals with and without authority, sign-off/payment, direct clear outcomes, and consistent queue/detail labels. Screenshots of queue, referral, review and sign-off controls were inspected at 1440px and 390px in light and dark mode, including errors and keyboard focus. Direct Playwright Chromium screenshots substituted for the unavailable Playwright MCP server; images are under ignored `e2e/test-results/`.

## Known limitations

- There is no sign-in. Handler selection records attribution, not authenticated identity; the human-review endpoint is not an authenticated human-only boundary.
- Failed or incomplete agent runs can remain in progress, including an approval whose payment failed. There is no automatic retry/recovery action or durable agent checkpoint. The thread id alone does not persist a conversation.
- An initial claim load failure requires a page reload; supporting-request failures retry on the next pending-state poll or reload. A handler decision rejected because another handler acted will refresh on polling.
- Automated checks validate workflow behavior, not accuracy against the held-out answer key. This change did not inspect that answer key or make new live-model calls.
- Payments are simulated; there are no customer messages or claims-manual access. Later course briefs remain outside the current build.
