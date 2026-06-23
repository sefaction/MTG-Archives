import { expect, test } from "@playwright/test";

const adminUsername = process.env.UI_ADMIN_USERNAME || "admin";
const adminPassword = process.env.UI_ADMIN_PASSWORD || "admin123";

async function loginAndEnterAdminMode(page: import("@playwright/test").Page) {
  await page.goto("/");

  if (await page.getByRole("link", { name: /^log in$/i }).first().isVisible()) {
    await page.goto("/login");
  }

  if (await page.getByLabel(/username or email/i).isVisible()) {
    await page.getByLabel(/username or email/i).fill(adminUsername);
    await page.getByLabel(/^password$/i).fill(adminPassword);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/(dashboard|change-password)/);
  }

  if (page.url().includes("/change-password")) {
    await page.getByLabel(/current password/i).fill(adminPassword);
    await page.getByLabel(/^new password$/i).fill(adminPassword);
    await page.getByLabel(/confirm new password/i).fill(adminPassword);
    await page.getByRole("button", { name: /change password/i }).click();
    await page.waitForURL(/\/dashboard/);
  }

  if (await page.getByRole("button", { name: /enter admin mode/i }).isVisible()) {
    await page.getByRole("button", { name: /enter admin mode/i }).click();
  }
}

test("admin metadata page renders refresh-all controls", async ({
  page,
}) => {
  await loginAndEnterAdminMode(page);
  await page.goto("/admin/metadata");

  if (page.url().includes("auth=admin-mode")) {
    await page.goto("/dashboard");
    const enterAdminMode = page.getByRole("button", {
      name: /enter admin mode/i,
    });
    if (await enterAdminMode.isVisible()) {
      await enterAdminMode.click();
    }
    await page.goto("/admin/metadata");
  }

  await expect(
    page.getByRole("heading", { level: 1, name: "Card metadata" }),
  ).toBeVisible();
  await expect(page.getByText("Refresh card metadata")).toBeVisible();
  await expect(page.getByText("Inventory quantities, locations, decks")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh all card metadata" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Refresh \d+ selected/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Scan for changes" })).toHaveCount(0);
});
