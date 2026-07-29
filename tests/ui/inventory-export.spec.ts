import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

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

test("imports exports a whole collection or one normal location", async ({
  page,
}) => {
  await logIn(page);
  await page.goto("/imports?exportTools=1");

  await expect(
    page.getByText("Export Inventory", { exact: true }),
  ).toBeVisible();
  const exportForm = page.locator('form[action="/api/inventory/export"]');
  const target = exportForm.locator('select[name="scope"]');
  const location = exportForm.locator('select[name="locationId"]');
  await expect(target).toHaveValue("owner");
  await expect(location).toBeDisabled();

  await target.selectOption("location");
  await expect(location).toBeEnabled();
  const locationOptions = await location.locator("option").all();
  expect(locationOptions.length).toBeGreaterThan(1);
  const chosenLocation = locationOptions[1]!;
  const chosenLocationId = await chosenLocation.getAttribute("value");
  const chosenLocationName = (await chosenLocation.textContent())?.trim() ?? "";
  expect(chosenLocationId).toBeTruthy();
  await location.selectOption(chosenLocationId!);
  await exportForm.locator('select[name="format"]').selectOption("moxfield");

  const downloadPromise = page.waitForEvent("download");
  await exportForm
    .getByRole("button", { name: "Download CSV", exact: true })
    .click();
  const download = await downloadPromise;
  const safeLocationName =
    chosenLocationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "inventory";
  expect(download.suggestedFilename()).toMatch(
    new RegExp(
      `^moxfield-inventory-${safeLocationName}-\\d{4}-\\d{2}-\\d{2}\\.csv$`,
    ),
  );
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const csv = await readFile(downloadPath!, "utf8");
  expect(csv.split(/\r?\n/, 1)[0]).toBe(
    "Count,Name,Edition,Condition,Language,Foil,Collector Number,Tag",
  );
});
