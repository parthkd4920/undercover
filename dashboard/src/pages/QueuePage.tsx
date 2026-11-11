/** The claims queue: every claim with where it stands. */

import { useCallback, useEffect, useState } from "react";
import { listClaims, runAgent, type ClaimRow } from "../lib/api";
import { claimType, money } from "../lib/format";
import { StatusChip } from "../components/StatusChip";

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function QueuePage() {
  const [claims, setClaims] = useState<ClaimRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listClaims().then(
      (rows) => {
        setClaims(rows);
        setLoadError(null);
      },
      (cause: unknown) => {
        setLoadError(message(cause, "The queue could not be loaded"));
      },
    );
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      clearInterval(timer);
    };
  }, [refresh]);

  async function run(claimId: string) {
    setRunning(claimId);
    setRunError(null);
    try {
      await runAgent(claimId);
    } catch (cause) {
      setRunError(message(cause, "The agent could not run"));
    }
    setRunning(null);
    refresh();
  }

  return (
    <section className="panel">
      <h2>Claims</h2>
      <p className="sub">
        The queue the UnderCover Agent works, with where each claim stands
      </p>
      {loadError !== null && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {runError !== null && (
        <p className="error" role="alert">
          {runError}
        </p>
      )}
      {claims === null ? (
        <p className="empty">Loading the queue...</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Claims table">
          <table className="queue">
            <thead>
              <tr>
                <th>Claim</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Submitted</th>
                <th className="right">Claimed</th>
                <th className="right">Payout</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (
                <tr key={claim.claim_id}>
                  <td>
                    <a className="mono" href={`#/claims/${claim.claim_id}`}>
                      {claim.claim_id}
                    </a>
                    <div className="summary">{claim.summary}</div>
                  </td>
                  <td>{claim.customer_name}</td>
                  <td>{claimType(claim.claim_type)}</td>
                  <td className="mono">{claim.submitted_on}</td>
                  <td className="right mono">{money(claim.amount_claimed)}</td>
                  <td className="right mono">
                    {claim.payout === null ? "—" : money(claim.payout)}
                  </td>
                  <td>
                    <StatusChip status={claim.status} />
                  </td>
                  <td className="right">
                    {claim.status === "waiting" && (
                      <button
                        disabled={running === claim.claim_id}
                        onClick={() => void run(claim.claim_id)}
                      >
                        {running === claim.claim_id ? "Running" : "Run agent"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
