# The claims pilot

From the head of claims operations at UnderCover Travel Insurance.

## How claims work today

UnderCover sells travel insurance on three plans: Economy, Premium and First. Our three claims handlers work through a queue of claims by hand. For each claim, a handler reads the customer's story and documents and checks them against the policy and our policy wording. Then they approve the claim with a payout, decline it or refer it. A claim is referred when it needs someone's judgment or more information, as the claims manual explains.

## The pilot

We want an AI agent, the UnderCover Agent, to work the queue the way a handler does. For each claim it should:

- read the claim, the customer's policy and claim history, and the policy wording
- approve, decline or refer the claim
- work out the payout when it approves
- explain the decision in two or three sentences, along with the relevant section of the policy

Our goal is to handle claims straight through, as accurately as our handlers do.

## What the team needs to see

- The queue, with where each claim stands: waiting, in progress, waiting for sign-off, waiting for human review, approved or declined. Approved means the payout has been recorded; an approval awaiting payment is still in progress.
- Six large count cards above the queue: total claims, waiting, approved, denied, referred to a human, and waiting for sign-off.
- One Run agent button automatically processes all currently waiting claims one by one, without selecting claims individually.
- Each claim in full, with the agent's decision and its reasons.
- Uncertain cases referred to a human with an explanation of what needs review. A handler can approve or deny them with a reason and policy reference; the original referral and the reviewer remain visible.
- What the agent is doing on a claim while it works, step by step.
- The agent's instructions, read only.

## Rules

- A payout over $1,000 needs a handler's sign-off. The agent can approve such a claim, but the payment waits until a handler signs off. The system must block the payment until then, even if the agent tries to pay.
- A timed, undecided, unpaid run still in progress at least two minutes after its latest attempt started is retried automatically once the active worker has stopped. Each retry starts a new two-minute window. There are three attempts total: the initial run and two reruns. If the third attempt is stale, refer the claim to a human with an explanation instead of starting a fourth attempt. Saved decisions and payments are not overwritten by retries.
- Decisions follow the policy wording.
- Our handlers' own decisions on these claims are in `data/evals/`. We use them to check the agent's work. The agent must never see them.
- Amounts are in US dollars.

## Human referrals

A claim can reach human review because the agent cannot confidently settle it under the supplied policy, or because three timed attempts have remained unresolved. A referral is not a denial and does not make a payment. The handler must be able to read the referral reason, review the evidence, and approve or deny with a reason and policy reference. The original referral and the final reviewer must remain recorded. Any approval still follows the $1,000 payment-authority rule.

## Our records

Everything is in `data/`, described in `data/README.md`: the claims queue, the policies, the customers, the plans, the handlers, the policy wording and the claims manual. The held-out claims in `data/evals/` are for checking the agent later and stay out of the queue.

## Not for now

- The claims manual. For the pilot, the agent works from the policy wording alone.
- No sign-in. Everyone who uses the screens sees everything.
- No real payments.
- No messages to customers.

Implementation and delivered changes are recorded in [STATUS.md](STATUS.md) and [CHANGELOG.md](CHANGELOG.md).
