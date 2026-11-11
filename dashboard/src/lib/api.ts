/** The API client for the UnderCover backend. */

export type ClaimStatus =
  "waiting" | "in_progress" | "waiting_for_sign_off" | "decided";

export interface ClaimRow {
  claim_id: string;
  claim_type: string;
  summary: string;
  customer_name: string;
  amount_claimed: number;
  status: ClaimStatus;
  decision: string | null;
  payout: number | null;
  submitted_on: string;
}

async function fail(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as {
    detail?: string;
  } | null;
  throw new Error(
    body?.detail ?? `The backend answered ${String(response.status)}`,
  );
}

export async function listClaims(): Promise<ClaimRow[]> {
  const response = await fetch("/api/claims");
  if (!response.ok) await fail(response);
  return (await response.json()) as ClaimRow[];
}

export async function runAgent(claimId: string): Promise<string> {
  const response = await fetch(`/api/claims/${claimId}/run`, {
    method: "POST",
  });
  if (!response.ok) await fail(response);
  const body = (await response.json()) as { reply: string };
  return body.reply;
}

export async function backendUp(): Promise<boolean> {
  try {
    const response = await fetch("/api/health");
    return response.ok;
  } catch {
    return false;
  }
}
