import { expect, test } from "@playwright/test";

const username = process.env.UI_ADMIN_USERNAME || "admin";
const password = process.env.UI_ADMIN_PASSWORD || "admin123";

async function logIn(page: import("@playwright/test").Page) {
  await page.goto("/");

  if (
    await page
      .getByRole("link", { name: /^log in$/i })
      .first()
      .isVisible()
  ) {
    await page.goto("/login");
  }

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

test("decks page exposes bracket list and create controls", async ({
  page,
}) => {
  await logIn(page);
  await page.goto("/decks");

  await expect(
    page.getByRole("heading", { level: 1, name: "Decks" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Brackets", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[aria-label="Brackets filters"]')).toBeVisible();
  await expect(
    page
      .locator('[aria-label="Brackets filters"]')
      .getByRole("button", { name: /Bracket 3/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Bracket" }),
  ).toBeVisible();

  await page.getByText("+ New deck").click();
  await expect(page.locator('select[name="bracket"]').first()).toBeVisible();
});
