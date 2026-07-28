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

test("local notification center is available without intrusive browser prompts", async ({
  page,
}) => {
  await login(page);
  await page.goto("/dashboard");

  const notificationButton = page.getByRole("link", {
    name: /Notifications, \d+ unread/,
  });
  await expect(notificationButton).toBeVisible();

  const summary = await page.request.get("/api/notifications/summary");
  expect(summary.ok()).toBeTruthy();
  const { unreadCount } = (await summary.json()) as { unreadCount: number };
  expect(Number.isInteger(unreadCount)).toBeTruthy();
  await expect(notificationButton).toHaveAttribute(
    "aria-label",
    `Notifications, ${unreadCount} unread`,
  );
  await expect(page).toHaveTitle(
    unreadCount ? `(${unreadCount}) MTG Inventory` : "MTG Inventory",
  );

  await notificationButton.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByText(/Quiet updates from trades/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark all read" }),
  ).toBeVisible();

  const permissionState = await page.evaluate(() => {
    return typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission;
  });
  expect(permissionState).not.toBe("granted");

  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByLabel(/Trade activity/)).toBeChecked();
  await expect(page.getByLabel(/Hourly trade-wishlist digest/)).toBeChecked();
});
