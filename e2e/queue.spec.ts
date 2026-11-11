import { expect, test } from "@playwright/test";

test("the queue lists the claims with where each stands", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Claims" })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await expect(page.locator(".chip").first()).toBeVisible();
  await expect(
    page.getByText("Maya Patel", { exact: true }).first(),
  ).toBeVisible();
});

test("a claim opens from the queue", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "CLM-1001" }).click();
  await expect(page.getByRole("heading", { name: "CLM-1001" })).toBeVisible();
});

test("claim content and agent instructions are readable", async ({ page }) => {
  await page.goto("/#/claims/CLM-1001");
  await expect(page.locator(".story")).toContainText("Rome");
  await expect(page.getByText("Airport hotel, one night")).toBeVisible();
  await expect(
    page.getByText(/Meridian Air cancellation notice/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Agent instructions" }).click();
  await expect(
    page.getByRole("heading", { name: "The UnderCover Agent" }),
  ).toBeVisible();
  await expect(
    page.locator("main input, main textarea, main [contenteditable=true]"),
  ).toHaveCount(0);
});
