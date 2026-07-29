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
  await page.goto("/dashboard");
  if (
    await page.getByRole("button", { name: /enter admin mode/i }).isVisible()
  ) {
    const enterAdminMode = page.getByRole("button", {
      name: /enter admin mode/i,
    });
    await enterAdminMode.click();
    await expect(
      page.getByRole("button", { name: /exit admin mode/i }),
    ).toBeVisible();
  }
}

test("webhook settings expose encrypted destinations and category controls", async ({
  page,
}) => {
  await loginAndEnterAdminMode(page);
  await page.goto("/settings/webhooks");

  await expect(
    page.getByRole("heading", { level: 1, name: "Webhooks" }),
  ).toBeVisible();
  await expect(page.getByLabel("Trade activity")).not.toBeChecked();
  await expect(page.getByLabel("Hourly wishlist digest")).not.toBeChecked();
  await page.getByText("Add webhook endpoint", { exact: true }).click();
  await expect(page.getByLabel("Name").first()).toBeVisible();
  await expect(page.getByLabel("Webhook URL").first()).toBeVisible();
  await expect(page.getByLabel("Signing secret").first()).toBeVisible();
  const privateDestination = page
    .getByLabel("Allow private/LAN destination")
    .first();
  if (await privateDestination.isDisabled()) {
    await page.goto("/dashboard");
    const enterAdminMode = page.getByRole("button", {
      name: /enter admin mode/i,
    });
    if (await enterAdminMode.isVisible()) {
      await enterAdminMode.click();
      await expect(
        page.getByRole("button", { name: /exit admin mode/i }),
      ).toBeVisible();
    }
    await page.goto("/settings/webhooks");
    await page.getByText("Add webhook endpoint", { exact: true }).click();
  }
  await expect(
    page.getByLabel("Allow private/LAN destination").first(),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "Add webhook" })).toBeEnabled();
  await expect(page.getByText(/HMAC-SHA256/)).toBeVisible();
  await expect(
    page.getByText(/never exposes saved URLs or signing secrets/),
  ).toBeVisible();
  await expect(
    page.getByText(/manages its persistent encryption key automatically/),
  ).toBeVisible();
});
