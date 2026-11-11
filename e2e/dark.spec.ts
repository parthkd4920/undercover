import { expect, test } from "@playwright/test";

test.use({ colorScheme: "dark" });

test("the queue and a claim read in dark mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(4, 35, 46)",
  );
  await expect(page.locator(".chip").first()).toBeVisible();
  await page.goto("/#/claims/CLM-1001");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(4, 35, 46)",
  );
  await expect(page.getByRole("heading", { name: "CLM-1001" })).toBeVisible();
  await expect(page.locator(".panel").first()).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)",
  );
});
