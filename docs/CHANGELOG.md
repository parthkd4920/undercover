# Product changes

## November 12, 2026: claim processing, human review and recovery

### Process the waiting queue one claim at a time

One Run agent click fetches the current waiting queue and processes those claims automatically in queue order. Each claim finishes or reports an error before the next starts. A failure does not stop the remaining queue, and the dashboard shows the current claim and position. This replaces the briefly introduced concurrent batch execution and the earlier per-claim selector.

The backend serializes agent work within its single process, including automatic recovery. The dashboard refreshes the table and six count cards: total, waiting, approved, denied, referred to human, and waiting for sign-off. Denied counts the `declined` status; referral and sign-off cards count claims currently awaiting those actions. In-progress claims are included in the total.

### Refer uncertain claims to a handler

The agent uses `refer_human` for missing required evidence, conflicting accounts, ambiguous policy wording, or cases it cannot confidently settle. It records an actionable reason and policy reference and leaves the claim `waiting_for_human_review`, without payment. A clear exclusion can still be declined directly.

Handlers can select their name, enter a payout, reason and policy reference, and Approve or Deny the referred claim. The original referral remains visible alongside the final decision and reviewer. Denial pays nothing. Approval pays immediately when the reviewer has sufficient authority; an approval over $1,000 by a reviewer without that authority waits for an eligible handler's sign-off. Human review and payment sign-off remain separate responsibilities.

The ambiguous `decided` status was replaced by explicit outcomes. The six statuses are `waiting`, `in_progress`, `waiting_for_human_review`, `waiting_for_sign_off`, `approved`, and `declined`. An approved claim has a payment recorded; a within-limit recorded approval still awaiting payment remains in progress.

### Retry stale runs, then refer repeated failures

New runs persist `run_started_on` and `run_attempts`. The backend watchdog checks every five seconds, even when the dashboard is closed. A run is eligible for recovery when it remains in progress, has no saved decision or payment, and its most recent attempt started at least two minutes ago. Recovery waits until no agent worker is active.

| Recorded attempt | Action when that attempt becomes stale |
|---|---|
| 1: initial run | Start attempt 2 automatically |
| 2: first rerun | Start attempt 3 automatically |
| 3: second rerun | Refer to human review; do not start attempt 4 |

Each rerun starts a new two-minute window. Three attempts means the initial run plus two reruns, not three additional retries. The final referral states that the agent did not complete the claim after three attempts and asks a handler to decide it. It is an operational escalation, not a denial under the policy.

The same guarded operation is available at `POST /api/claims/{id}/rerun`. Recovery never overwrites a saved decision or payment. Existing pre-upgrade claims without a trustworthy start time are left unchanged. Retry eligibility is a minimum age, not a promise to interrupt an active worker exactly at two minutes.

Model requests have a 30-second timeout and no SDK retries. A 90-second budget is checked before model turns; calls already running finish or time out before another worker starts. This avoids duplicating work while a previous attempt is still active.

### Preserve records and explain failures

SQLite schema version 1 migrated historical outcomes and added referral/reviewer records. Version 2 added persisted retry metadata without resetting business records. The claim page shows the attempt number and polls for recovery or escalation.

Run failures return a structured 502 response describing the failure category and saved claim/payment state, and log the traceback with the claim id. Plain-text backend errors and transport timeouts are returned to the agent as tool errors. A failed final response does not undo a previously saved decision, referral or payment.

### Verification and scope

The last full implementation check passed: 118 Python tests (99.10% coverage), 53 dashboard tests (95.42% statement coverage), and 22 browser tests, plus formatting, lint and type checks. Retry tests use a simulated clock at the two-minute boundary and stub models; they verify attempt limits, worker exclusion, saved-work protection and human escalation without paid model calls.

The pilot still uses one backend process, simulated payments and unauthenticated handler selection. No distributed scheduler, durable model checkpoint, new sign-in flow or later-course build was added. See [STATUS.md](STATUS.md) for architecture, run instructions and remaining limitations; [PLAN.md](PLAN.md) retains the implementation history.
