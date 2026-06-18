import { expect, test } from "@playwright/test";

const adminUsername = process.env.UI_ADMIN_USERNAME || "admin";
const adminPassword = process.env.UI_ADMIN_PASSWORD || "admin123";

test("admin can reach backups page without restore actions", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /log in|dashboard|mtg inventory/i }),
  ).toBeVisible();

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

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page).not.toHaveURL(/\/change-password/);

  if (await page.getByRole("button", { name: /enter admin mode/i }).isVisible()) {
    await page.getByRole("button", { name: /enter admin mode/i }).click();
  }

  await page.goto("/admin/backups");

  if (page.url().includes("auth=admin-mode")) {
    await page.getByRole("button", { name: /enter admin mode/i }).click();
    await page.goto("/admin/backups");
  }

  await expect(
    page.getByRole("heading", { level: 1, name: "Backups" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Backup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload Backup" })).toBeVisible();
  await expect(page.getByText("Restore command")).toBeVisible();
  await expect(page.getByText("Recent backups")).toBeVisible();
  if ((await page.getByRole("link", { name: "Download" }).count()) > 0) {
    await expect(page.getByRole("link", { name: "Download" }).first()).toHaveAttribute(
      "href",
      /\/api\/admin\/backups\/download\//,
    );
  }
  if ((await page.getByRole("button", { name: "Restore Backup" }).count()) > 0) {
    await expect(page.getByText("Destructive. Type RESTORE").first()).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /^restore$/i })).toHaveCount(0);
});
