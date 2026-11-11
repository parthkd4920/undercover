/** Live counts for the claims team's queue. */
import type { ClaimRow, ClaimStatus } from "../lib/api";

const metrics: { label: string; status: ClaimStatus | null; tone: string }[] = [
  { label: "Total claims", status: null, tone: "total" },
  { label: "Waiting claims", status: "waiting", tone: "waiting" },
  { label: "Approved claims", status: "approved", tone: "approved" },
  { label: "Denied claims", status: "declined", tone: "denied" },
  {
    label: "Referred to human",
    status: "waiting_for_human_review",
    tone: "review",
  },
  {
    label: "Waiting to sign off",
    status: "waiting_for_sign_off",
    tone: "signoff",
  },
];

/** Count current statuses, showing a dash until records are available. */
export function ClaimSummary({
  claims,
}: {
  readonly claims: readonly ClaimRow[] | null;
}) {
  return (
    <section aria-label="Claim summary">
      <dl className="claim-summary">
        {metrics.map((metric) => {
          const count = claims?.filter(
            (claim) => metric.status === null || claim.status === metric.status,
          ).length;
          return (
            <div
              className={`summary-card summary-${metric.tone}`}
              key={metric.label}
            >
              <dt>{metric.label}</dt>
              <dd className="mono">{count ?? "—"}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
