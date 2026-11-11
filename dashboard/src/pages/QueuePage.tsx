/** The claims queue: every claim with where it stands. */

import { useCallback, useEffect, useRef, useState } from "react";
import { listClaims, runAgent, type ClaimRow } from "../lib/api";
import { claimType, money } from "../lib/format";
import { ClaimSummary } from "../components/ClaimSummary";
import { StatusChip } from "../components/StatusChip";

/** Describe a failed request without hiding which claim failed. */
function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/** Show live counts and run the entire waiting queue from one button. */
export function QueuePage() {
  const batchRunning = useRef(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [claims, setClaims] = useState<ClaimRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

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

  /** Process all waiting claims in order, allowing one active run at a time. */
  async function run() {
    if (batchRunning.current) return;
    batchRunning.current = true;
    setRunning(true);
    setRunError(null);
    setRunMessage("Starting all waiting claims...");
    try {
      const latest = await listClaims();
      setClaims(latest);
      const waiting = latest.filter((claim) => claim.status === "waiting");
      const failures: string[] = [];
      let completed = 0;
      for (const [index, claim] of waiting.entries()) {
        setRunMessage(
          `Running ${claim.claim_id} (${String(index + 1)} of ${String(waiting.length)})...`,
        );
        try {
          await runAgent(claim.claim_id);
          completed += 1;
        } catch (cause) {
          failures.push(
            claim.claim_id + ": " + message(cause, "The agent could not run"),
          );
          setRunError(failures.join("; "));
        }
        refresh();
      }
      setRunMessage(
        `Finished ${String(completed)} of ${String(waiting.length)} agent runs.`,
      );
    } catch (cause) {
      setRunError(message(cause, "Waiting claims could not be loaded"));
      setRunMessage(null);
    } finally {
      batchRunning.current = false;
      setRunning(false);
      refresh();
    }
  }

  const hasWaiting =
    claims?.some((claim) => claim.status === "waiting") ?? false;

  return (
    <>
      <ClaimSummary claims={claims} />
      <section className="panel">
        <h2>Claims</h2>
        <p className="sub">
          The queue the UnderCover Agent works, with where each claim stands
        </p>
        <div className="queue-actions">
          <button disabled={!hasWaiting || running} onClick={() => void run()}>
            {running ? "Running all waiting claims" : "Run agent"}
          </button>
          <span className="sub">
            Run all waiting claims automatically, one at a time
          </span>
        </div>
        {runMessage !== null && <p role="status">{runMessage}</p>}
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
                    <td className="right mono">
                      {money(claim.amount_claimed)}
                    </td>
                    <td className="right mono">
                      {claim.payout === null ? "—" : money(claim.payout)}
                    </td>
                    <td>
                      <StatusChip status={claim.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
