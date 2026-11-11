/** The recorded outcome, original referral and payout sign-off. */
import type { Claim, Handler } from "../lib/api";
import { money } from "../lib/format";

interface DecisionPanelProps {
  readonly claim: Claim;
  readonly handlers: readonly Handler[];
  readonly choice: string;
  readonly onChoice: (handlerId: string) => void;
  readonly onSignOff: () => void;
  readonly signing: boolean;
  readonly signError: string | null;
}

/** Show an approval's payment or pending authorization. */
function PaymentInfo({ claim }: { readonly claim: Claim }) {
  if (claim.decision !== "approve") return null;
  if (claim.paid_amount !== null)
    return (
      <p>
        Paid {money(claim.paid_amount)} on {claim.paid_on?.slice(0, 10)}
      </p>
    );
  const label =
    claim.status === "waiting_for_sign_off"
      ? "Waiting for a handler's sign-off to pay"
      : "Approval recorded, payment pending";
  return <p>{label}</p>;
}

/** Show the decision, its reasons, and any payment. */
function Outcome({ claim }: { readonly claim: Claim }) {
  if (claim.decision === null) return <p className="empty">Not decided yet</p>;
  const labels: Record<string, string> = {
    approve: "Approve",
    decline: "Decline",
    refer: "Awaiting human decision",
  };
  return (
    <>
      <p>
        <strong>{labels[claim.decision]}</strong>
        {claim.decision === "approve" && claim.payout !== null && (
          <span className="mono"> {money(claim.payout)}</span>
        )}
      </p>
      {claim.decision !== "refer" && (
        <>
          <p>{claim.reason}</p>
          <p className="sub">Policy reference: {claim.reference}</p>
        </>
      )}
      <PaymentInfo claim={claim} />
    </>
  );
}

/** Show the outcome, original handoff, reviewer and authorized sign-off controls. */
export function DecisionPanel(props: DecisionPanelProps) {
  const { claim } = props;
  const reviewer =
    props.handlers.find((handler) => handler.handler_id === claim.reviewed_by)
      ?.name ?? claim.reviewed_by;
  const signer =
    props.handlers.find((handler) => handler.handler_id === claim.signed_off_by)
      ?.name ?? claim.signed_off_by;
  return (
    <section className="panel">
      <h3>The decision</h3>
      {claim.referral_reason !== null && (
        <div className="referral">
          <h4>Referral to a human</h4>
          <p>{claim.referral_reason}</p>
          <p className="sub">Referral reference: {claim.referral_reference}</p>
        </div>
      )}
      {reviewer !== null && (
        <p className="sub">
          Reviewed by {reviewer} on {claim.reviewed_on?.slice(0, 10)}
        </p>
      )}
      <Outcome claim={claim} />
      {signer !== null && <p className="sub">Signed off by {signer}</p>}
      {claim.status === "waiting_for_sign_off" && (
        <div className="signoff">
          <label>
            Handler
            <select
              value={props.choice}
              onChange={(event) => {
                props.onChoice(event.target.value);
              }}
            >
              {props.handlers
                .filter((handler) => handler.can_approve_over_limit)
                .map((handler) => (
                  <option key={handler.handler_id} value={handler.handler_id}>
                    {handler.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            disabled={props.signing || props.choice === ""}
            onClick={props.onSignOff}
          >
            {props.signing ? "Signing off" : "Sign off"}
          </button>
        </div>
      )}
      {props.signError !== null && (
        <p className="error" role="alert">
          {props.signError}
        </p>
      )}
    </section>
  );
}
