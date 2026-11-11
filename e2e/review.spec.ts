import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`pages fit ${String(width)}px in ${colorScheme} mode`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      const routes = [
        { name: "queue", hash: "/", ready: "Maya Patel" },
        {
          name: "claim",
          hash: "/#/claims/CLM-1001",
          ready: "maya.patel@example.com",
        },
        {
          name: "instructions",
          hash: "/#/agent",
          ready: "The UnderCover Agent",
        },
      ];
      for (const route of routes) {
        await page.goto(route.hash);
        await expect(
          page.getByText(route.ready, { exact: true }).first(),
        ).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: testInfo.outputPath(`${route.name}.png`),
        });
      }
    });
  }
}

test("all claim outcomes have accurate labels and sign-off is keyboard accessible", async ({
  page,
  request,
}, testInfo) => {
  const response = await request.get(
    "http://127.0.0.1:18000/api/claims/CLM-1001",
  );
  const original: unknown = await response.json();
  const states = [
    {
      name: "waiting",
      status: "waiting",
      decision: null,
      payout: null,
      paid_amount: null,
      paid_on: null,
      label: "Not decided yet",
    },
    {
      name: "in-progress",
      status: "in_progress",
      decision: null,
      payout: null,
      paid_amount: null,
      paid_on: null,
      label: "Not decided yet",
    },
    {
      name: "sign-off",
      status: "waiting_for_sign_off",
      decision: "approve",
      payout: 2000,
      paid_amount: null,
      paid_on: null,
      label: "Waiting for a handler's sign-off to pay",
    },
    {
      name: "paid",
      status: "approved",
      decision: "approve",
      payout: 420,
      paid_amount: 420,
      paid_on: "2026-11-11",
      label: "Paid $420.00 on 2026-11-11",
    },
    {
      name: "declined",
      status: "declined",
      decision: "decline",
      payout: 0,
      paid_amount: null,
      paid_on: null,
      label: "Decline",
    },
    {
      name: "referred",
      status: "waiting_for_human_review",
      decision: "refer",
      payout: 0,
      paid_amount: null,
      paid_on: null,
      label: "Awaiting human decision",
    },
  ];
  for (const state of states) {
    await page.route("**/api/claims/CLM-1001", async (route) => {
      await route.fulfill({
        json: {
          ...(original as object),
          ...state,
          referral_reason:
            "Evidence conflicts with the claim story; a handler must assess the documents before confirming coverage.",
          referral_reference: "Section 3; applicability needs review",
          referred_on: "2026-11-11",
          reason:
            "The documents support this decision under the policy wording.",
          reference: "Section 3",
        },
      });
    });
    await page.goto("/#/claims/CLM-1001");
    await page.reload();
    await expect(page.getByText("maya.patel@example.com")).toBeVisible();
    await expect(page.getByText(state.label, { exact: true })).toBeVisible();
    await page
      .getByRole("heading", { name: "The decision" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${state.name}.png`) });
    await page.unroute("**/api/claims/CLM-1001");
  }
  await page.route("**/api/claims/CLM-1001", async (route) => {
    await route.fulfill({
      json: {
        ...(original as object),
        status: "waiting_for_sign_off",
        decision: "approve",
        payout: 2000,
      },
    });
  });
  await page.goto("/#/claims/CLM-1001");
  await page.reload();
  await page.setViewportSize({ width: 390, height: 900 });
  const handler = page.getByLabel("Handler");
  await handler.focus();
  await expect(handler).toBeFocused();
  await page.keyboard.press("Tab");
  const button = page.getByRole("button", { name: "Sign off" });
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS("outline-style", "solid");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("sign-off-mobile.png") });
  await page.getByRole("link", { name: "Claims", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Agent instructions" }),
  ).toBeFocused();
});

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`human review fits ${String(width)}px in ${colorScheme}`, async ({
      page,
      request,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      const response = await request.get(
        "http://127.0.0.1:18000/api/claims/CLM-1001",
      );
      const original: unknown = await response.json();
      const reason =
        "The receipt and airline statement disagree about the incident dates. The applicable section does not clearly settle the conflicting evidence; a handler must establish the covered dates before calculating a payout.";
      await page.route("**/api/claims/CLM-1001", async (route) => {
        await route.fulfill({
          json: {
            ...(original as object),
            status: "waiting_for_human_review",
            decision: "refer",
            referral_reason: reason,
            referral_reference: "Section 3; applicability unclear",
            referred_on: "2026-11-11",
          },
        });
      });
      await page.goto("/#/claims/CLM-1001");
      await expect(page.getByText(reason, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText(
        "reason and policy reference",
      );
      await page.getByLabel("Reviewing handler").selectOption("HND-03");
      await page.getByLabel("Payout (USD)").fill("2000");
      await page
        .getByLabel("Decision reason")
        .fill("The documents establish the eligible expenses.");
      await page
        .getByLabel("Policy reference", { exact: true })
        .fill("Section 3");
      await expect(
        page.getByText(/will wait for an authorized handler/),
      ).toBeVisible();
      await page.getByLabel("Policy reference", { exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Approve", exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("button", { name: "Approve", exact: true }),
      ).toHaveCSS("outline-style", "solid");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page
        .locator(".review-form")
        .screenshot({ path: testInfo.outputPath("human-review.png") });
      await page
        .locator(".referral")
        .screenshot({ path: testInfo.outputPath("referral.png") });
    });
  }
}
