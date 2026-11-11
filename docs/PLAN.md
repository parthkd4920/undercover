# Plan: the claims pilot

From `docs/SPEC.md`. The pilot gives UnderCover a claims platform: a backend over the records in `data/`, a dashboard for the handlers, and the UnderCover Agent that works the queue by reading each claim and deciding it under the policy wording.

Out of scope, per the spec: the claims manual, sign-in, real payments, messages to customers. The answer key in `data/evals/` is never read by the agent and is not part of this build; checking the agent's accuracy against it comes later.

## Design

### Claim state machine

A claim moves through the four states the team needs to see:

- `waiting` — in the queue, nobody working it
- `in_progress` — the agent is working it
- `waiting_for_sign_off` — the agent approved a payout over $1,000; payment is blocked until a handler signs off
- `decided` — the agent has decided (approve within the limit and paid, decline, or refer)

Transitions: `waiting` → `run_agent` → `in_progress` → `decide_claim` → `decided` (approve up to the limit, decline or refer) or `waiting_for_sign_off` (approve over the limit) → handler signs off, which pays the approved payout → `decided`.

### Backend

FastAPI and SQLite. The database is seeded from `data/` on startup when it is empty: claims, policies, customers, plans, add-ons, handlers and company settings (including the $1,000 `payout_approval_limit`). Never `data/evals/`, `data/security/` or the claims manual. `data/policy_wording.md` and the agent's instructions are files the backend serves; they never need to change.

The database file is `undercover.db` at the repo root (already gitignored as `*.db`), overridable with the `UNDERCOVER_DB` environment variable so tests can seed fresh databases in temporary directories.

Every operation has an `operation_id`, a one-line docstring and no optional inputs. Request bodies are Pydantic models with all fields required.

| Operation | What it does |
|---|---|
| `health` | Check the backend is running (exists) |
| `list_claims` | The queue: claim id, type, summary, customer name, amount claimed, status, decision and payout |
| `get_claim` | One claim in full: story, items, documents, status, decision, payout, reason, policy reference, sign-off and payment |
| `list_steps` | The agent's steps on a claim, in order |
| `run_agent` | Set a claim `in_progress` and run the agent on it; returns the agent's final reply |
| `decide_claim` | Record decision (approve, decline, refer), payout, reason and policy reference; sets the status |
| `pay_claim` | Pay an approved claim; takes the amount; blocked over $1,000 without sign-off |
| `sign_off_claim` | A handler signs off an over-limit approval; the payout is then paid and the claim is decided |
| `add_step` | Record one step of the agent's work on a claim |
| `get_policy` | One policy: plan, add-ons, purchase date, trip, travelers |
| `get_customer` | One customer: contact details and claim history |
| `get_plan` | One plan's limits and deductible |
| `list_add_ons` | The three add-ons and their effects |
| `get_policy_wording` | The policy wording text |
| `get_agent_instructions` | The agent's instructions, read only |

Rules enforced by the backend, not by the prompt: `pay_claim` refuses an amount over the approval limit unless the claim has been signed off, refuses a claim that is not approved or is already paid, and refuses to pay more than the approved payout. `decide_claim` refuses a claim that is not in progress or already decided. `sign_off_claim` requires a handler with `can_approve_over_limit` and a claim that is waiting for sign-off. Failures are HTTP errors with a plain-English `detail`, which the agent's tools return to the model as text so it can respond sensibly when a payment is blocked.

The agent's instructions live in `backend/instructions.md`, served by `get_agent_instructions` and read by both the agent and the dashboard, so everyone sees the same text.

### Agent

`agent/main.py` keeps the one entry point `run(claim_id, thread_id)`. On each run it fetches its instructions from the backend API and uses them as the system prompt. It reads everything and acts only through the backend's API, using these tools, each of which records a step on the claim so the team can follow the work:

`get_claim`, `get_policy`, `get_customer`, `get_plan`, `list_add_ons`, `get_policy_wording`, `decide_claim`, `pay_claim`.

The instructions tell the agent to work like a handler: read the claim, the policy, the customer's claim history, the plan limits, the add-ons and the policy wording; decide approve, decline or refer strictly under the wording; work out the payout by the wording's calculation rules; explain the decision in two or three sentences with the policy section it rests on; and pay an approval itself only when the payout is within the $1,000 limit, leaving larger payouts for a handler's sign-off.

The dashboard triggers the agent through `run_agent` on the backend, which calls `agent.run(claim_id, thread_id)` with the claim id as the thread id.

### Dashboard

React with Vite and TypeScript, hash routes, no router dependency. Brand per `docs/BRAND.md`: Instrument Sans for headings and body, Instrument Serif for the tagline, JetBrains Mono for ids, numbers and money; panels rounded with no outline; light and dark modes via `prefers-color-scheme`. The four claim states use Sea Green (`decided`), Marigold (`in_progress`), Coral (`waiting_for_sign_off`) and Cerulean (`waiting`), with Midnight text on the first three and white on Cerulean.

- `#/` the queue: every claim with its status, amount and a Run agent button on waiting claims; refreshed while the agent works
- `#/claims/{id}` the claim in full: story, items, documents, the customer and policy, the agent's steps as they happen (polled while the claim is in progress), the decision with payout, reason and policy reference, payment, and a sign-off with a handler choice on claims waiting for sign-off
- `#/agent` the agent's instructions, read only

### Testing

Unit tests never call a model: backend tests use FastAPI's `TestClient` against a fresh seeded database; agent tests script a stub model (`GenericFakeChatModel`) through the tool calls, as the skeleton's `agent/tests/test_agent.py` already does. The dashboard is tested with vitest and Testing Library with stubbed `fetch`; Playwright covers the pages end to end, arranging claim state through the backend API where needed.

## Phase 1: the backend's database and seed

Build `backend/database.py` (SQLite connection, schema, `UNDERCOVER_DB` override) and `backend/seed.py` (load `data/` into an empty database: 25 claims, 50 policies, 49 customers, 3 plans, 3 add-ons, 3 handlers, company settings). Seed on startup when the database is empty. Add `undercover.db` handling to `.gitignore` (already covered by `*.db`).

- [x] `uv run pytest backend/tests` passes with tests asserting the seeded counts, the company's `payout_approval_limit` of 1000, and that each claims row keeps its items and documents as JSON
- [x] A test asserts the seed never reads `data/evals/`, `data/security/` or `claims_manual.md` (the seed only opens the seven seed files)
- [x] Starting the backend twice does not duplicate data: `uv run -m uvicorn backend.main:app`, then `curl http://127.0.0.1:8000/api/health` twice, still one set of claims in the database
- [x] `uv run ruff format --check`, `uv run ruff check` and `uv run pyright` pass

## Phase 2: the backend's read API

Operations `list_claims`, `get_claim`, `list_steps`, `get_policy`, `get_customer`, `get_plan`, `list_add_ons`, `get_policy_wording` and `get_agent_instructions`, each with an `operation_id`, a one-line docstring and no optional inputs. `backend/instructions.md` holds the agent's instructions.

- [x] `curl http://127.0.0.1:8000/api/claims` returns 25 claims with `status: "waiting"`, ids from CLM-1001 to CLM-1025
- [x] `curl http://127.0.0.1:8000/api/claims/CLM-1001` returns the full claim: story, three items, documents, `policy_id: "POL-2001"`
- [x] `curl http://127.0.0.1:8000/api/policies/POL-2001`, `/api/customers/CUS-3001`, `/api/plans/premium`, `/api/add-ons`, `/api/policy-wording` and `/api/agent-instructions` each return their record, and the wording matches `data/policy_wording.md`
- [x] `get_claim` on an unknown claim returns 404; tests cover every read operation, including empty steps on an unworked claim
- [x] `npm run check:python` passes, with backend coverage at 80% or more

## Phase 3: the claim lifecycle

Operations `add_step`, `decide_claim`, `pay_claim` and `sign_off_claim`, with the money rules enforced in the backend. Status transitions: `decide_claim` sets `decided` for a decline, a refer or an approval within the limit, and `waiting_for_sign_off` for an approval over the limit. `pay_claim` pays an approved claim within its payout, blocked over the approval limit unless signed off. `sign_off_claim` records the handler, pays the approved payout and sets `decided`.

- [x] Tests: deciding CLM-1001 as approve with payout 420 records decision, reason, reference and `decided_on`, and the status becomes `decided`
- [x] Tests: deciding with payout 2000 sets `waiting_for_sign_off`, and `pay_claim` of 2000 returns an error whose `detail` says the payout needs a handler's sign-off
- [x] Tests: after `sign_off_claim` with a handler who `can_approve_over_limit`, the claim is `decided` with `paid_amount` 2000, `signed_off_by` and `paid_on` set
- [x] Tests: `pay_claim` refuses a claim that is not approved, an amount over the approved payout, a claim already paid, and a handler without `can_approve_over_limit` signing off; `decide_claim` refuses a claim that is already decided, so a test can arrange a claim without calling a model
- [x] Tests: `add_step` then `list_steps` returns the steps in order
- [x] `npm run check:python` passes with coverage at 80% or more

## Phase 4: the agent and its instructions

Rewrite `agent/main.py`: fetch the instructions from `get_agent_instructions` and use them as the system prompt; the eight tools over the backend API, each recording a step on the claim; tool errors returned to the model as text. Write `backend/instructions.md` to the design above: work like a handler, decide under the policy wording alone, calculate payouts by its rules, explain in two or three sentences with the policy section, pay within the limit and leave larger payouts for sign-off. Add `run_agent` to the backend, which sets the claim `in_progress`, calls `agent.run(claim_id, claim_id)` and returns the reply.

- [x] Tests with a stub model scripting the tool calls: the agent reads a claim, policy, customer, plan, add-ons and wording, decides approve with payout 420 and pays; the claim ends `decided` and paid, and `list_steps` shows the steps in order
- [x] Tests with a stub model: an approval of 2000 leaves the claim `waiting_for_sign_off`, and the blocked `pay_claim` returns the sign-off message to the model
- [x] Tests: `run_agent` on a waiting claim returns the agent's reply; running it on a claim that is not waiting returns an error
- [x] `npm run check:python` passes with coverage at 80% or more
- [x] Live check with `OPENROUTER_API_KEY` set: run the agent on CLM-1001 through the run operation on a running backend, then `curl http://127.0.0.1:8000/api/claims/CLM-1001` shows a decision with a reason and a policy reference, and the claim is decided and paid (approved at $420, referencing sections 3, 10 and 12); running it from the queue is checked in the browser in Phase 5

## Phase 5: the dashboard's queue

The queue page with the brand: layout, fonts and colors from `docs/BRAND.md`, light and dark modes, status chips in the four state colors, money in JetBrains Mono as `$1,250.00`, and a Run agent button on waiting claims that calls `run_agent` and refreshes the queue while the agent works. Hash routes for queue, claim and instructions pages. A typed API client in `src/lib/api.ts`.

- [x] `npm run check:ts` passes with vitest coverage at 80% statements or more, testing the queue with a stubbed `fetch`: 25 claims, statuses, amounts, the run button on waiting claims and its absence on decided claims
- [x] With `npm run dev`, the Playwright MCP server sees the queue at `http://localhost:5173` with 25 claims, each with a status chip, in both light and dark mode
- [x] An e2e test covers the queue: claims listed with their statuses, and a claim detail route opens
- [x] The existing health e2e test still passes

## Phase 6: the claim detail and instructions pages, and the end-to-end run

The claim page: story, items and documents, the customer and policy, the agent's steps polled while the claim is in progress, the decision panel with payout, reason and policy reference, payment, and sign-off with a handler choice on claims waiting for it. The instructions page renders the agent's instructions read only. Finish `docs/STATUS.md`.

- [ ] `npm run check:ts` passes with vitest coverage at 80% statements or more, covering the claim page with stubbed `fetch` (decision, steps, sign-off button when waiting for sign-off) and the instructions page
- [ ] With `npm run dev`, the Playwright MCP server: open a claim, see the story, items and documents; open the agent instructions, read only
- [ ] An e2e test decides a claim over $1,000 through the backend API, then signs off on the claim page and sees the claim decided and paid
- [ ] An e2e test runs the pages in dark mode
- [ ] `npm run check` passes in full: ruff, pyright, pytest, prettier, eslint, tsc, vitest and Playwright
- [ ] `docs/STATUS.md` describes the whole build, how to run it and any known gaps

## Next steps after the current-code review (November 11, 2026)

This is a completion plan for the pilot, preserving the original phases above. No later build brief is present in `docs/`, so the next work stays within the pilot. Implementation requires the student's review of this plan first.

### Review baseline

`docs/STATUS.md` says Phase 6 is pending, but the working tree already contains the claim detail and instructions pages, their unit tests, and sign-off and dark-mode end-to-end tests. Review and finish these changes rather than rebuild them. Existing edits also include notebooks and `docs/CODE_STANDARDS.md`; preserve those and keep unrelated edits out of product commits.

`npm run check` passed during this review: 45 Python tests (99.67% coverage), 19 dashboard tests (93.96% statement coverage), and 5 Playwright tests. ESLint reported one warning for a conditional in `e2e/claim.spec.ts`. Passing checks do not yet cover the gaps below. Playwright can reuse running servers, so this result alone does not establish isolation from the local development database. No model calls or answer-key inspection were needed.

### Completion phase 1: enforce the claim lifecycle and sign-off rule

The backend currently allows a decision on a waiting claim, despite the original design requiring `in_progress`. It also checks the requested payment amount against the sign-off limit: an approval for $2,000 can be paid $1,000 without sign-off and become `decided`. Base the sign-off requirement on the approved payout so smaller payment requests cannot bypass it. Reject negative and non-finite money inputs, keeping payment separate from the decision.

- [x] Add regression tests showing a waiting claim cannot be decided, an in-progress claim can be decided, and a decided claim cannot be decided again.
- [x] Add a regression test: approve $2,000, request payment of $1,000 without sign-off, receive an error, and retain `waiting_for_sign_off` with no payment recorded.
- [x] Verify the boundary: a $1,000 approval can be paid without sign-off; an approval above $1,000 requires sign-off; authorized sign-off pays the approved payout exactly once.
- [x] Money validation rejects negative and non-finite values without changing the claim. Keep zero-payout declines and referrals valid.
- [x] Update lifecycle and stub-agent test setup to enter `in_progress` without calling a real model; `npm run check:python` passes with coverage at least 80%.

### Completion phase 2: finish the claim page's decision and loading behavior

`DecisionPanel` currently labels every unpaid decision as waiting for sign-off, including declines and referrals. Show payment and sign-off information according to the decision and status. The page also silently converts failed customer/policy loads into permanent loading placeholders and failed step loads into an empty history. Show useful errors for these required sections. Clear previous claim state on navigation and ignore responses for a claim that is no longer selected.

- [x] Tests cover approve, decline and refer: only an approval waiting for sign-off displays the sign-off message and controls; an unpaid approval within the limit has an accurate payment label.
- [x] Tests cover sign-off failure, disabled submission while signing, and exclusion of handlers without approval authority.
- [x] Tests show customer, policy, steps and handler load failures visibly, without suggesting that missing results are still loading or that the history is empty.
- [x] A delayed-response test navigates between claim ids and verifies that the earlier response cannot overwrite the selected claim.
- [x] Timer-based tests verify that steps refresh during `in_progress`, the completed decision appears, and polling stops when the claim finishes or the page unmounts. Repeated step descriptions render without duplicate React keys.
- [x] Add the brief function comments required by `docs/CODE_STANDARDS.md` to the new page functions; `npm run check:ts` passes with coverage at least 80%.

### Completion phase 3: make end-to-end verification repeatable

The sign-off test currently chooses any waiting claim and changes it, while Playwright is configured to reuse an existing backend. Give the suite a dedicated database and servers, and arrange known claim states without a live model. Update the sign-off setup to respect the lifecycle rule from completion phase 1.

- [ ] Automated tests cannot reuse the ordinary development backend or change its database; use dedicated test ports and an isolated test database with deterministic setup.
- [ ] Replace the conditional early return in `e2e/claim.spec.ts` with deterministic setup and assertions; ESLint reports no warnings for this test.
- [ ] The sign-off journey verifies an over-limit approval, eligible handler selection, payment, recorded signer, and removal of sign-off controls.
- [ ] Add a browser test for read-only agent instructions and assert story, item and document content on the claim page.
- [ ] `npm run e2e` passes on two consecutive runs without manual database cleanup or paid model calls.

### Completion phase 4: inspect the pages in the browser

Automated assertions cover behavior, but the original Phase 6 browser review remains outstanding. Use the Playwright MCP server when available; otherwise record the browser-tool substitution used for visual review.

- [ ] Inspect queue, claim detail and instructions in light and dark mode, including a narrow viewport; content, tables and sign-off controls remain readable and usable.
- [ ] Check keyboard navigation and visible focus for links, handler selection and sign-off.
- [ ] Inspect waiting, in-progress, waiting-for-sign-off, approved-and-paid, declined and referred claims using test fixtures; the visible labels match each state.
- [ ] Record the outcome and resolve any layout or usability defects before marking the original Phase 6 browser criterion complete.

### Completion phase 5: reconcile documentation and hand over the pilot

Update the documentation to describe the verified product and any remaining limitations. Keep future harness, database migration and deployment work out of this pilot completion.

- [ ] `docs/STATUS.md` describes all three dashboard routes, the backend and agent architecture, payment/sign-off enforcement, run commands and known limitations. Assess and document the current behavior where a failed agent run can leave a claim `in_progress`; do not claim retry or recovery exists.
- [ ] Tick the original Phase 6 criteria only when their corresponding checks and browser review are complete.
- [ ] Run `npm run check` after the final product changes; all checks pass without lowering thresholds or disabling rules.
- [ ] Commit each completed implementation phase with the pre-commit hook enabled, staging only its intended files and preserving unrelated student work. Do not push.
