/** Formatting for the dashboard: money, statuses and claim types. */

import type { ClaimStatus } from "./api";

export function money(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export function statusLabel(status: ClaimStatus): string {
  const labels: Record<ClaimStatus, string> = {
    waiting: "Waiting",
    in_progress: "In progress",
    waiting_for_sign_off: "Waiting for sign-off",
    approved: "Approved",
    declined: "Declined",
    waiting_for_human_review: "Waiting for human review",
  };
  return labels[status];
}

export function claimType(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
