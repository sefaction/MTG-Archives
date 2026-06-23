import { expect, test } from "@playwright/test";

const adminUsername = process.env.UI_ADMIN_USERNAME || "admin";
const adminPassword = process.env.UI_ADMIN_PASSWORD || "admin123";

async function logInAsAdmin(page: import("@playwright/test").Page) {
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
}

test("inventory detail drawer renders card information blocks", async ({
  page,
}) => {
  await logInAsAdmin(page);
  await page.goto("/inventory");

  await expect(
    page.getByRole("heading", { level: 1, name: /inventory/i }),
  ).toBeVisible();

  const firstActions = page
    .getByRole("button", { name: /actions for/i })
    .first();
  test.skip(
    (await firstActions.count()) === 0,
    "Local database has no inventory rows to inspect.",
  );

  await firstActions.click();
  await page.getByRole("button", { name: "View details" }).click();

  await expect(page.getByText("Printing")).toBeVisible();
  await expect(page.getByText("Treatment")).toBeVisible();
  await expect(page.getByText("Legalities")).toBeVisible();
  await expect(page.getByText("Inventory")).toBeVisible();
  await expect(page.getByText("Price")).toBeVisible();
  await expect(page.getByText("Copies by location")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View on Scryfall" }),
  ).toBeVisible();
  await expect(page.getByText("Location Summary")).toHaveCount(0);
  await expect(page.getByText("Scryfall fallback prices")).toHaveCount(0);
});

test("inventory detail drawer supports meld card flip and partner links", async ({
  page,
}) => {
  await logInAsAdmin(page);
  await page.goto("/inventory?cardName=Hanweir");

  await expect(
    page.getByRole("heading", { level: 1, name: /inventory/i }),
  ).toBeVisible();

  const firstActions = page
    .getByRole("button", { name: /actions for/i })
    .first();
  test.skip(
    (await firstActions.count()) === 0,
    "Local database has no Hanweir meld inventory rows to inspect.",
  );

  await firstActions.click();
  await page.getByRole("button", { name: "View details" }).click();

  await expect(page.getByRole("button", { name: "Show back face" })).toBeVisible();
  await page.getByRole("button", { name: "Show back face" }).click();
  await expect(page.getByRole("button", { name: "Show front face" })).toBeVisible();
  await expect(page.getByText("Meld partner")).toBeVisible();
  await expect(page.getByRole("link", { name: "Find in inventory" })).toBeVisible();
  expect(
    await page.getByRole("link", { name: "View on Scryfall" }).count(),
  ).toBeGreaterThanOrEqual(2);
});
