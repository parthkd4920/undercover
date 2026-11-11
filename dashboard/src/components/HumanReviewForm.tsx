/** A handler's decision on an uncertain claim, separate from payout sign-off. */
import { useEffect, useRef, useState } from "react";
import { resolveHumanReview, type Handler } from "../lib/api";

interface Props {
  readonly claimId: string;
  readonly handlers: readonly Handler[];
  readonly onResolved: () => void;
}

/** Validate a decision and submit the handler's coverage assessment. */
export function HumanReviewForm({ claimId, handlers, onResolved }: Props) {
  const [handlerId, setHandlerId] = useState<string | null>(null);
  const [payout, setPayout] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selected =
    handlers.find((handler) => handler.handler_id === handlerId) ??
    handlers.at(0);
  const needsSignOff =
    Number(payout) > 1000 &&
    selected !== undefined &&
    !selected.can_approve_over_limit;

  /** Denials always submit zero; approvals need a valid entered amount. */
  async function submit(decision: "approve" | "decline") {
    if (busy) return;
    if (
      selected === undefined ||
      reason.trim() === "" ||
      reference.trim() === ""
    ) {
      setError("Choose a handler and enter a reason and policy reference.");
      return;
    }
    const amount = decision === "approve" ? Number(payout) : 0;
    if (
      decision === "approve" &&
      (payout.trim() === "" || !Number.isFinite(amount) || amount < 0)
    ) {
      setError("Enter a finite payout of $0.00 or more.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resolveHumanReview(claimId, {
        handler_id: selected.handler_id,
        decision,
        payout: amount,
        reason: reason.trim(),
        reference: reference.trim(),
      });
      if (mounted.current) onResolved();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The review could not be saved",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="panel review-form">
      <h3>Human review</h3>
      <p className="sub">
        Review the evidence and record your decision under the policy.
      </p>
      <fieldset disabled={busy}>
        <label>
          Reviewing handler
          <select
            value={selected?.handler_id ?? ""}
            onChange={(event) => {
              setHandlerId(event.target.value);
            }}
          >
            {handlers.map((handler) => (
              <option key={handler.handler_id} value={handler.handler_id}>
                {handler.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Payout (USD)
          <input
            type="number"
            min="0"
            step="0.01"
            value={payout}
            onChange={(event) => {
              setPayout(event.target.value);
            }}
          />
        </label>
        <label>
          Decision reason
          <textarea
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </label>
        <label>
          Policy reference
          <input
            value={reference}
            onChange={(event) => {
              setReference(event.target.value);
            }}
          />
        </label>
        {needsSignOff && (
          <p>
            An approval above $1,000 by this handler will wait for an authorized
            handler's sign-off.
          </p>
        )}
        <div className="review-actions">
          <button
            type="button"
            disabled={busy || selected === undefined}
            onClick={() => void submit("approve")}
          >
            Approve
          </button>
          <button
            type="button"
            className="deny"
            disabled={busy || selected === undefined}
            onClick={() => void submit("decline")}
          >
            Deny
          </button>
          {busy && <span role="status">Saving review...</span>}
        </div>
      </fieldset>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
