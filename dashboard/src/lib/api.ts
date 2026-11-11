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

export interface ClaimItem {
  description: string;
  category: string;
  amount: number;
}

export interface ClaimDocument {
  name: string;
  type: string;
  content: string;
}

export interface Claim {
  claim_id: string;
  policy_id: string;
  customer_id: string;
  claim_type: string;
  submitted_on: string;
  incident_date: string;
  incident_location: string;
  summary: string;
  story: string;
  items: ClaimItem[];
  amount_claimed: number;
  documents: ClaimDocument[];
  status: ClaimStatus;
  decision: string | null;
  payout: number | null;
  reason: string | null;
  reference: string | null;
  decided_on: string | null;
  signed_off_by: string | null;
  signed_off_on: string | null;
  paid_amount: number | null;
  paid_on: string | null;
}

export interface Step {
  step: string;
  at: string;
}

export interface Policy {
  policy_id: string;
  customer_id: string;
  plan: string;
  add_ons: string[];
  purchased_on: string;
  sold_through: string;
  status: string;
  trip: {
    destination: string;
    departs_on: string;
    returns_on: string;
    trip_cost: number;
  };
  travelers: string[];
}

export interface PreviousClaim {
  claim_id: string;
  filed_on: string;
  incident_date: string;
  claim_type: string;
  summary: string;
  outcome: string;
  amount_paid: number;
}

export interface Customer {
  customer_id: string;
  name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  address: { street: string; city: string; state: string; zip: string };
  customer_since: string;
  previous_claims: PreviousClaim[];
}

export interface Handler {
  handler_id: string;
  name: string;
  role: string;
  email: string;
  can_approve_over_limit: boolean;
}

async function fail(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as {
    detail?: string;
  } | null;
  throw new Error(
    body?.detail ?? `The backend answered ${String(response.status)}`,
  );
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) await fail(response);
  return (await response.json()) as T;
}

export function listClaims(): Promise<ClaimRow[]> {
  return getJson<ClaimRow[]>("/api/claims");
}

export function getClaim(claimId: string): Promise<Claim> {
  return getJson<Claim>(`/api/claims/${claimId}`);
}

export function listSteps(claimId: string): Promise<Step[]> {
  return getJson<Step[]>(`/api/claims/${claimId}/steps`);
}

export function getPolicy(policyId: string): Promise<Policy> {
  return getJson<Policy>(`/api/policies/${policyId}`);
}

export function getCustomer(customerId: string): Promise<Customer> {
  return getJson<Customer>(`/api/customers/${customerId}`);
}

export function listHandlers(): Promise<Handler[]> {
  return getJson<Handler[]>("/api/handlers");
}

export function agentInstructions(): Promise<string> {
  return getJson<{ instructions: string }>("/api/agent-instructions").then(
    (body) => body.instructions,
  );
}

export async function runAgent(claimId: string): Promise<string> {
  const response = await fetch(`/api/claims/${claimId}/run`, {
    method: "POST",
  });
  if (!response.ok) await fail(response);
  const body = (await response.json()) as { reply: string };
  return body.reply;
}

export async function signOffClaim(
  claimId: string,
  handlerId: string,
): Promise<void> {
  const response = await fetch(`/api/claims/${claimId}/sign-off`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handler_id: handlerId }),
  });
  if (!response.ok) await fail(response);
}

export async function backendUp(): Promise<boolean> {
  try {
    const response = await fetch("/api/health");
    return response.ok;
  } catch {
    return false;
  }
}
