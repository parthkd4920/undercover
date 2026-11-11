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
      status: "decided",
      decision: "approve",
      payout: 420,
      paid_amount: 420,
      paid_on: "2026-11-11",
      label: "Paid $420.00 on 2026-11-11",
    },
    {
      name: "declined",
      status: "decided",
      decision: "decline",
      payout: 0,
      paid_amount: null,
      paid_on: null,
      label: "Decline",
    },
    {
      name: "referred",
      status: "decided",
      decision: "refer",
      payout: 0,
      paid_amount: null,
      paid_on: null,
      label: "Refer",
    },
  ];
  for (const state of states) {
    await page.route("**/api/claims/CLM-1001", async (route) => {
      await route.fulfill({
        json: {
          ...(original as object),
          ...state,
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
