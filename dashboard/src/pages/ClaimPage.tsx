/** A claim in full: the story, the customer and policy, the agent's work and the decision. */

import { useEffect, useRef, useState } from "react";
import {
  getClaim,
  getCustomer,
  getPolicy,
  listHandlers,
  listSteps,
  signOffClaim,
  type Claim,
  type Customer,
  type Handler,
  type Policy,
  type Step,
} from "../lib/api";
import { claimType, money } from "../lib/format";
import { StatusChip } from "../components/StatusChip";

/** Describe a failed request. */
function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/** Display the date portion of a timestamp. */
function dateOf(at: string): string {
  return at.slice(0, 10);
}

/** Use the handler-facing decision label. */
function decisionWord(decision: string): string {
  const words: Record<string, string> = {
    approve: "Approve",
    decline: "Decline",
    refer: "Refer",
  };
  return words[decision] ?? decision;
}

/** Display one claim fact. */
function Fact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="fact">
      <span className="fact-label">{label}</span>
      <span className="fact-value">{value}</span>
    </div>
  );
}

/** Show the claim story, items and documents. */
function StoryPanel({ claim }: { readonly claim: Claim }) {
  return (
    <section className="panel">
      <h3>The claim</h3>
      <p className="story">{claim.story}</p>
      <div className="table-scroll" role="region" aria-label="Claim items">
        <table className="items">
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th className="right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {claim.items.map((item) => (
              <tr key={item.description}>
                <td>{item.description}</td>
                <td>{item.category}</td>
                <td className="right mono">{money(item.amount)}</td>
              </tr>
            ))}
            <tr>
              <td>Claimed in total</td>
              <td></td>
              <td className="right mono">{money(claim.amount_claimed)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h4>Documents</h4>
      {claim.documents.map((document) => (
        <div key={document.name} className="document">
          <p className="doc-name mono">
            {document.name} ({document.type})
          </p>
          <p>{document.content}</p>
        </div>
      ))}
    </section>
  );
}

/** Show contact details and claim history. */
function CustomerPanel({
  customer,
  error,
}: {
  readonly customer: Customer | null;
  readonly error: string | null;
}) {
  if (error !== null)
    return (
      <section className="panel">
        <p role="alert" className="error">
          {error}
        </p>
      </section>
    );
  return (
    <section className="panel">
      <h3>The customer</h3>
      {customer === null ? (
        <p className="empty">Loading the customer...</p>
      ) : (
        <>
          <p>
            <strong>{customer.name}</strong>
          </p>
          <p>{customer.email}</p>
          <p className="mono">{customer.phone}</p>
          <p>
            {customer.address.street}, {customer.address.city},{" "}
            {customer.address.state} {customer.address.zip}
          </p>
          <p className="sub">Customer since {customer.customer_since}</p>
          {customer.previous_claims.length === 0 ? (
            <p className="sub">No previous claims</p>
          ) : (
            <ul>
              {customer.previous_claims.map((previous) => (
                <li key={previous.claim_id}>
                  {previous.claim_id}, {claimType(previous.claim_type)}:{" "}
                  {money(previous.amount_paid)} paid
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Show the policy and insured trip. */
function PolicyPanel({
  policy,
  error,
}: {
  readonly policy: Policy | null;
  readonly error: string | null;
}) {
  if (error !== null)
    return (
      <section className="panel">
        <p role="alert" className="error">
          {error}
        </p>
      </section>
    );
  return (
    <section className="panel">
      <h3>The policy</h3>
      {policy === null ? (
        <p className="empty">Loading the policy...</p>
      ) : (
        <>
          <p>
            <strong>{policy.plan}</strong> plan, {policy.status}
          </p>
          <p>{policy.trip.destination}</p>
          <p className="sub">
            {policy.trip.departs_on} to {policy.trip.returns_on},{" "}
            {money(policy.trip.trip_cost)} trip
          </p>
          <p>{policy.travelers.join(", ")}</p>
          <p className="sub">
            Add-ons:{" "}
            {policy.add_ons.length === 0 ? "none" : policy.add_ons.join(", ")}
          </p>
        </>
      )}
    </section>
  );
}

/** Show the ordered agent activity. */
function StepsPanel({
  steps,
  error,
}: {
  readonly steps: readonly Step[];
  readonly error: string | null;
}) {
  return (
    <section className="panel">
      <h3>The agent's work</h3>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {error === null && steps.length === 0 && (
        <p className="sub">No steps recorded yet</p>
      )}
      <ol className="steps">
        {steps.map((step, index) => (
          <li key={`${step.at}-${String(index)}`}>{step.step}</li>
        ))}
      </ol>
    </section>
  );
}

interface DecisionPanelProps {
  readonly claim: Claim;
  readonly handlers: readonly Handler[];
  readonly choice: string;
  readonly onChoice: (handlerId: string) => void;
  readonly onSignOff: () => void;
  readonly signing: boolean;
  readonly signError: string | null;
}

/** Show the decision, payment and authorized sign-off controls. */
function DecisionPanel(props: DecisionPanelProps) {
  const { claim } = props;
  const signer =
    props.handlers.find((handler) => handler.handler_id === claim.signed_off_by)
      ?.name ?? claim.signed_off_by;
  return (
    <section className="panel">
      <h3>The decision</h3>
      {claim.decision === null ? (
        <p className="empty">Not decided yet</p>
      ) : (
        <>
          <p>
            <strong>{decisionWord(claim.decision)}</strong>
            {claim.decision === "approve" && claim.payout !== null && (
              <span className="mono"> {money(claim.payout)}</span>
            )}
          </p>
          <p>{claim.reason}</p>
          <p className="sub">Policy reference: {claim.reference}</p>
          {claim.decision === "approve" &&
            (claim.paid_amount !== null ? (
              <p>
                Paid {money(claim.paid_amount)} on {dateOf(claim.paid_on ?? "")}
              </p>
            ) : (
              <p>
                {claim.status === "waiting_for_sign_off"
                  ? "Waiting for a handler's sign-off to pay"
                  : "Payment pending"}
              </p>
            ))}
          {signer !== null && <p className="sub">Signed off by {signer}</p>}
        </>
      )}
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

/** Reset claim state when the selected claim changes. */
export function ClaimPage({ claimId }: { readonly claimId: string }) {
  return <ClaimDetail key={claimId} claimId={claimId} />;
}

/** Load and follow one claim until it finishes. */
function ClaimDetail({ claimId }: { readonly claimId: string }) {
  const [claim, setClaim] = useState<Claim | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [handlerChoice, setHandlerChoice] = useState<string | null>(null);

  const [refresh, setRefresh] = useState(0);
  const [errors, setErrors] = useState<(string | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    /** Check whether this request still belongs to the selected page. */
    const isActive = () => active;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Fetch the claim and its supporting records, keeping failures visible. */
    async function load() {
      try {
        const loaded = await getClaim(claimId);
        if (!isActive()) return;
        setClaim(loaded);
        setLoadError(null);
        const results = await Promise.allSettled([
          getCustomer(loaded.customer_id),
          getPolicy(loaded.policy_id),
          listSteps(claimId),
          listHandlers(),
        ]);
        if (!isActive()) return;
        const [customerResult, policyResult, stepsResult, handlersResult] =
          results;
        setCustomer(
          customerResult.status === "fulfilled" ? customerResult.value : null,
        );
        setPolicy(
          policyResult.status === "fulfilled" ? policyResult.value : null,
        );
        setSteps(stepsResult.status === "fulfilled" ? stepsResult.value : []);
        setHandlers(
          handlersResult.status === "fulfilled" ? handlersResult.value : [],
        );
        const labels = ["Customer", "Policy", "Agent steps", "Handlers"];
        setErrors(
          results.map((result, index) =>
            result.status === "rejected"
              ? labels[index] +
                " could not be loaded: " +
                message(result.reason, "Request failed")
              : null,
          ),
        );
        if (loaded.status === "in_progress")
          timer = setTimeout(() => void load(), 2000);
      } catch (cause) {
        if (isActive())
          setLoadError(message(cause, "The claim could not be loaded"));
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [claimId, refresh]);

  /** Submit the selected handler and refresh the claim. */
  async function signOff() {
    if (claim === null) return;
    const chosen =
      handlerChoice ??
      handlers.find((handler) => handler.can_approve_over_limit)?.handler_id;
    if (chosen === undefined) return;
    setSigning(true);
    try {
      await signOffClaim(claim.claim_id, chosen);
      if (!mounted.current) return;
      setSignError(null);
    } catch (cause) {
      if (!mounted.current) return;
      setSignError(message(cause, "The claim could not be signed off"));
    }
    setSigning(false);
    setRefresh((value) => value + 1);
  }

  const choice =
    handlerChoice ??
    handlers.find((handler) => handler.can_approve_over_limit)?.handler_id ??
    "";

  return (
    <div className="claim">
      {loadError !== null && (
        <section className="panel">
          <p className="error" role="alert">
            {loadError}
          </p>
        </section>
      )}
      {claim === null ? (
        <section className="panel">
          {loadError === null && <p className="empty">Loading the claim...</p>}
        </section>
      ) : (
        <>
          <section className="panel">
            <h2 className="claim-id mono">{claim.claim_id}</h2>
            <StatusChip status={claim.status} />
            <p className="sub">{claim.summary}</p>
            <div className="facts">
              <Fact label="Type" value={claimType(claim.claim_type)} />
              <Fact label="Claimed" value={money(claim.amount_claimed)} />
              <Fact label="Submitted" value={claim.submitted_on} />
              <Fact
                label="Incident"
                value={`${dateOf(claim.incident_date)}, ${claim.incident_location}`}
              />
            </div>
          </section>
          <div className="claim-grid">
            <StoryPanel claim={claim} />
            <div className="claim-side">
              <CustomerPanel customer={customer} error={errors[0] ?? null} />
              <PolicyPanel policy={policy} error={errors[1] ?? null} />
            </div>
          </div>
          <StepsPanel steps={steps} error={errors[2] ?? null} />
          {errors[3] !== null && (
            <p className="error" role="alert">
              {errors[3]}
            </p>
          )}
          <DecisionPanel
            claim={claim}
            handlers={handlers}
            choice={choice}
            onChoice={setHandlerChoice}
            onSignOff={() => void signOff()}
            signing={signing}
            signError={signError}
          />
        </>
      )}
    </div>
  );
}
