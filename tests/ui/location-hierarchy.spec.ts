import { expect, test } from "@playwright/test";

const username = process.env.UI_ADMIN_USERNAME || "admin";
const password = process.env.UI_ADMIN_PASSWORD || "admin123";

async function logIn(page: import("@playwright/test").Page) {
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

test("locations page exposes hierarchy controls without changing data", async ({
  page,
}) => {
  await logIn(page);
  await page.goto("/locations");

  await expect(
    page.getByRole("heading", { name: "Locations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Locations tree" }),
  ).toBeVisible();
  const parentSelectors = page.locator('select[name="parentLocationId"]');
  await expect(parentSelectors.first()).toBeVisible();
  await expect(parentSelectors.first().locator('option[value=""]')).toHaveText(
    "No parent (top level)",
  );
  await expect(
    page.locator('[title*="including sub-locations"]').first(),
  ).toBeAttached();
});

test("inventory and imports expose on-demand section controls without changing data", async ({
  page,
}) => {
  await logIn(page);

  await page.goto("/inventory");
  await expect(page.locator('input[name="locationSection"]')).toBeAttached();

  await page.goto("/imports");
  await expect(page.locator('input[name="locationSection"]')).toBeAttached();
});

test("inventory location filter remains multi-select while narrowing its visible options", async ({
  page,
}) => {
  await logIn(page);
  await page.goto("/inventory");

  await page
    .getByRole("button", { name: /Advanced Inventory Search/ })
    .click();
  await page.getByRole("button", { name: /^Location:/ }).click();
  const locationSearch = page.getByLabel("Search location options");
  await expect(locationSearch).toBeVisible();

  const locationOptions = page.locator(
    '[role="listbox"] input[type="checkbox"][name="locationId"]',
  );
  await expect(locationOptions.first()).toBeAttached();
  await locationOptions.first().check();

  await locationSearch.fill("no-location-can-match-this-value");
  await expect(page.getByText("No matching locations.")).toBeVisible();
  await expect(locationOptions.first()).toBeAttached();
  await expect(locationOptions.first()).toBeChecked();
});
