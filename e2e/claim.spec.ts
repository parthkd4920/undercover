import { expect, test } from "@playwright/test";

test("an approval over the limit is signed off on the claim page and paid", async ({
  page,
  request,
}) => {
  const claimId = "CLM-1004";
  const decide = await request.post(
    `http://127.0.0.1:18000/api/claims/${claimId}/decide`,
    {
      data: {
        decision: "approve",
        payout: 2000,
        reason: "The documents support the claim under the policy wording.",
        reference: "Section 10",
      },
    },
  );
  expect(decide.ok()).toBeTruthy();

  await page.goto(`/#/claims/${claimId}`);
  await expect(page.getByText("Waiting for sign-off")).toBeVisible();
  await page.getByLabel("Handler").selectOption({ label: "Dana Whitfield" });
  await page.getByRole("button", { name: "Sign off" }).click();
  await expect(page.getByText("Decided")).toBeVisible();
  await expect(page.getByText(/Paid \$[\d,]+\.\d\d on/)).toBeVisible();
  await expect(page.getByText("Signed off by Dana Whitfield")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign off" })).toHaveCount(0);
  const result = await request.get(
    `http://127.0.0.1:18000/api/claims/${claimId}`,
  );
  expect(await result.json()).toMatchObject({
    status: "decided",
    paid_amount: 2000,
    signed_off_by: "HND-01",
  });
});
