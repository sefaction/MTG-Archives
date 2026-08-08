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

test("advanced inventory search filters by exact card color combination", async ({
  page,
}) => {
  await logIn(page);
  await page.goto("/inventory?displayMode=exact&pageSize=10");

  await page
    .getByRole("button", { name: /advanced inventory search/i })
    .click();
  await expect(page.getByText("Card color", { exact: true })).toBeVisible();

  await page.locator('select[name="colorMode"]').selectOption("exact");
  const cardColors = page.locator('[aria-label="Card color"]');
  await cardColors.locator('label[title="White"]').click();
  await cardColors.locator('label[title="Blue"]').click();
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page).toHaveURL(/colorMode=exact/);
  await expect(page).toHaveURL(/colors=W/);
  await expect(page).toHaveURL(/colors=U/);
  await expect(
    page.getByRole("link", { name: "Remove Card color: Exact White" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Remove Card color: Exact Blue" }).first(),
  ).toBeVisible();
});
