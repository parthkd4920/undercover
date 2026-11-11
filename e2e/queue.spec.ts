import { expect, test } from "@playwright/test";

test("the queue lists the claims with where each stands", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Claims" })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await expect(page.locator(".chip").first()).toBeVisible();
  await expect(page.getByText("Maya Patel").first()).toBeVisible();
});

test("a claim opens from the queue", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "CLM-1001" }).click();
  await expect(
    page.getByRole("heading", { name: "Claim CLM-1001" }),
  ).toBeVisible();
});
