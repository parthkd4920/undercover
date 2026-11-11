import { expect, test } from "@playwright/test";
import type { ClaimRow } from "../dashboard/src/lib/api";

test("one click starts all waiting claims and refreshes the count cards", async ({
  page,
}) => {
  const records: ClaimRow[] = [
    {
      claim_id: "CLM-1001",
      customer_name: "Maya Patel",
      claim_type: "trip_delay",
      summary: "Delayed flight",
      amount_claimed: 420,
      payout: null,
      decision: null,
      submitted_on: "2026-11-11",
      status: "waiting",
    },
    {
      claim_id: "CLM-1002",
      customer_name: "Liam Nguyen",
      claim_type: "baggage",
      summary: "Lost bag",
      amount_claimed: 500,
      payout: null,
      decision: null,
      submitted_on: "2026-11-11",
      status: "waiting",
    },
    {
      claim_id: "CLM-1003",
      customer_name: "Sam",
      claim_type: "baggage",
      summary: "Paid claim",
      amount_claimed: 500,
      payout: 500,
      decision: "approve",
      submitted_on: "2026-11-11",
      status: "approved",
    },
  ];
  const started: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/claims", async (route) => {
    await route.fulfill({ json: records });
  });
  await page.route("**/api/claims/*/run", async (route) => {
    const id = route.request().url().split("/").at(-2) ?? "";
    started.push(id);
    await pending;
    const target = records.find((claim) => claim.claim_id === id);
    if (target === undefined) throw new Error(`Unexpected claim ${id}`);
    target.status = "approved";
    target.decision = "approve";
    target.payout = target.amount_claimed;
    await route.fulfill({ json: { reply: "Approved and paid" } });
  });
  await page.goto("/");
  const summary = page.getByRole("region", { name: "Claim summary" });
  await expect(summary.locator(".summary-total dd")).toHaveText("3");
  await expect(summary.locator(".summary-waiting dd")).toHaveText("2");
  await expect(summary.locator(".summary-approved dd")).toHaveText("1");
  await page.getByRole("button", { name: "Run agent", exact: true }).click();
  await expect
    .poll(() => started.toSorted((left, right) => left.localeCompare(right)))
    .toEqual(["CLM-1001", "CLM-1002"]);
  await expect(
    page.getByRole("button", { name: "Running all waiting claims" }),
  ).toBeDisabled();
  release();
  await expect(page.getByRole("status")).toContainText(
    "Finished 2 of 2 agent runs",
  );
  await expect(summary.locator(".summary-waiting dd")).toHaveText("0");
  await expect(summary.locator(".summary-approved dd")).toHaveText("3");
  await expect(
    page.getByRole("button", { name: "Run agent", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("combobox")).toHaveCount(0);
});
