import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { ClaimRow, ClaimStatus } from "../lib/api";
import { ClaimSummary } from "./ClaimSummary";

afterEach(cleanup);

/** Prepare each queue state without a model call. */
function row(status: ClaimStatus): ClaimRow {
  return {
    claim_id: status,
    customer_name: "Customer",
    claim_type: "trip_delay",
    summary: "Claim",
    submitted_on: "2026-11-11",
    amount_claimed: 420,
    status,
    payout: null,
    decision: null,
  };
}

it("counts the total and each requested pending or final state", () => {
  render(
    <ClaimSummary
      claims={[
        row("waiting"),
        row("waiting"),
        row("in_progress"),
        row("approved"),
        row("declined"),
        row("waiting_for_human_review"),
        row("waiting_for_sign_off"),
      ]}
    />,
  );
  for (const [label, count] of [
    ["Total claims", "7"],
    ["Waiting claims", "2"],
    ["Approved claims", "1"],
    ["Denied claims", "1"],
    ["Referred to human", "1"],
    ["Waiting to sign off", "1"],
  ]) {
    expect(screen.getByText(label).nextElementSibling?.textContent).toBe(count);
  }
});

it("shows unknown counts while loading and zeros for an empty queue", () => {
  const view = render(<ClaimSummary claims={null} />);
  expect(screen.getAllByText("—")).toHaveLength(6);
  view.rerender(<ClaimSummary claims={[]} />);
  expect(screen.getAllByText("0")).toHaveLength(6);
});
