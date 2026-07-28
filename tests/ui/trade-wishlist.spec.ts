import { expect, test } from "@playwright/test";

const username = process.env.UI_ADMIN_USERNAME || "admin";
const password = process.env.UI_ADMIN_PASSWORD || "admin123";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  if (await page.getByLabel(/username or email/i).isVisible()) {
    await page.getByLabel(/username or email/i).fill(username);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/(dashboard|change-password)/);
  }
  if (page.url().includes("/change-password")) {
    await page.getByLabel(/current password/i).fill(password);
    await page.getByLabel(/^new password$/i).fill(password);
    await page.getByLabel(/confirm new password/i).fill(password);
    await page.getByRole("button", { name: /change password/i }).click();
    await page.waitForURL(/\/dashboard/);
  }
}

test("trade wishlist surfaces render from public inventory, wishlist, and trades", async ({
  page,
}) => {
  await login(page);

  await page.goto("/wishlist?tab=trades");
  await expect(
    page.getByRole("heading", { level: 1, name: "Wishlist" }),
  ).toBeVisible();
  await expect(page.getByText("Trade wants").first()).toBeVisible();

  await page.goto("/trades");
  await expect(
    page.getByRole("heading", { level: 1, name: "Trades" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Trade Wishlist" }),
  ).toBeVisible();

  await page.goto("/public/inventory?displayMode=exact&pageSize=10");
  if (
    await page.getByText("No public inventory is available yet.").isVisible()
  ) {
    test.skip(true, "local database has no public inventory rows");
  }

  const firstCard = page.locator("tbody button").first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();
  await expect(
    page.getByText(/Wishlist from|Choose trade target/),
  ).toBeVisible();
});
