import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

const api = "http://127.0.0.1:18000/api/claims";
const referral =
  "The required receipt is missing. A handler must assess the evidence.";

for (const scenario of [
  {
    id: "CLM-1005",
    action: "Approve",
    payout: "420",
    handler: "HND-01",
    outcome: "Approved",
    paid: 420,
  },
  {
    id: "CLM-1006",
    action: "Deny",
    payout: "",
    handler: "HND-01",
    outcome: "Declined",
    paid: null,
  },
  {
    id: "CLM-1007",
    action: "Approve",
    payout: "2000",
    handler: "HND-03",
    outcome: "Approved",
    paid: 2000,
  },
  {
    id: "CLM-1008",
    action: "Approve",
    payout: "2000",
    handler: "HND-01",
    outcome: "Approved",
    paid: 2000,
  },
]) {
  test(`human ${scenario.action} resolves ${scenario.id} with correct payment authority`, async ({
    page,
    request,
  }) => {
    const referred = await request.post(`${api}/${scenario.id}/refer`, {
      data: { reason: referral, reference: "Section 3" },
    });
    expect(referred.ok()).toBeTruthy();
    await page.goto(`/#/claims/${scenario.id}`);
    await expect(
      page.getByText("Waiting for human review", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(referral, { exact: true })).toBeVisible();
    await page.getByLabel("Reviewing handler").selectOption(scenario.handler);
    await page.getByLabel("Payout (USD)").fill(scenario.payout);
    await page
      .getByLabel("Decision reason")
      .fill("The handler reviewed the evidence under the policy wording.");
    await page
      .getByLabel("Policy reference", { exact: true })
      .fill("Section 3");
    await page
      .getByRole("button", { name: scenario.action, exact: true })
      .click();
    await finishSignOff(page, scenario.handler);
    await expect(
      page.getByText(scenario.outcome, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(referral, { exact: true })).toBeVisible();
    await expect(page.getByText(/Reviewed by/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: scenario.action, exact: true }),
    ).toHaveCount(0);
    const result = await request.get(`${api}/${scenario.id}`);
    expect(await result.json()).toMatchObject({
      paid_amount: scenario.paid,
      reviewed_by: scenario.handler,
      referral_reason: referral,
    });
    await page.getByRole("link", { name: "Claims", exact: true }).click();
    const row = page.getByRole("row").filter({
      has: page.getByRole("link", { name: scenario.id, exact: true }),
    });
    await expect(
      row.getByText(scenario.outcome, { exact: true }),
    ).toBeVisible();
  });
}

for (const scenario of [
  { id: "CLM-1009", decision: "approve", payout: 420, label: "Approved" },
  { id: "CLM-1010", decision: "decline", payout: 0, label: "Declined" },
]) {
  test(`a clear ${scenario.decision} displays its explicit outcome`, async ({
    page,
    request,
  }) => {
    const response = await request.post(`${api}/${scenario.id}/decide`, {
      data: {
        decision: scenario.decision,
        payout: scenario.payout,
        reason: "The policy terms clearly determine the outcome.",
        reference: "Section 3",
      },
    });
    expect(response.ok()).toBeTruthy();
    await payClearApproval(request, scenario);
    await page.goto(`/#/claims/${scenario.id}`);
    await expect(page.getByText(scenario.label, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Human review", exact: true }),
    ).toHaveCount(0);
  });
}

/** Complete the additional authorization required by the restricted reviewer. */
async function finishSignOff(page: Page, handler: string) {
  if (handler !== "HND-03") return;
  await expect(
    page.getByText("Waiting for sign-off", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Handler", { exact: true }).selectOption("HND-01");
  await page.getByRole("button", { name: "Sign off", exact: true }).click();
}

/** Pay only the prepared approval; declines have no payment operation. */
async function payClearApproval(
  request: APIRequestContext,
  scenario: { id: string; decision: string; payout: number },
) {
  if (scenario.decision !== "approve") return;
  const response = await request.post(`${api}/${scenario.id}/pay`, {
    data: { amount: scenario.payout },
  });
  expect(response.ok()).toBeTruthy();
}
