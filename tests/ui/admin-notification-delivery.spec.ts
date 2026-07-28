import { expect, test } from "@playwright/test";

const username = process.env.UI_ADMIN_USERNAME || "admin";
const password = process.env.UI_ADMIN_PASSWORD || "admin123";

async function loginAndEnterAdminMode(page: import("@playwright/test").Page) {
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
  if (
    await page.getByRole("button", { name: /enter admin mode/i }).isVisible()
  ) {
    await page.getByRole("button", { name: /enter admin mode/i }).click();
  }
}

test("admin can inspect the outbound notification delivery foundation", async ({
  page,
}) => {
  await loginAndEnterAdminMode(page);
  await page.goto("/admin/notifications");
  if (page.url().includes("auth=admin-mode")) {
    await page.goto("/dashboard");
    const enterAdminMode = page.getByRole("button", {
      name: /enter admin mode/i,
    });
    if (await enterAdminMode.isVisible()) await enterAdminMode.click();
    await page.goto("/admin/notifications");
  }

  await expect(
    page.getByRole("heading", { level: 1, name: "Notification delivery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Queue success test" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Queue failure test" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent jobs" })).toBeVisible();
  await expect(page.getByText("PENDING", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("SENDING", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("SENT", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("FAILED", { exact: true }).first()).toBeVisible();
});
