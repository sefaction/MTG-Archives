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

test("user can save a theme preference from settings", async ({ page }) => {
  await logIn(page);
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(6);

  await page.getByLabel(/Azorius Ledger/).check();
  await page.getByRole("button", { name: /^save settings$/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "azorius");

  await page.goto("/inventory");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "azorius");

  await page.goto("/settings");
  await page.getByLabel(/Golgari Night/).check();
  await page.getByRole("button", { name: /^save settings$/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "golgari");
});
