import { expect, test } from "@playwright/test";

for (const width of [1366, 320]) {
  test(`Public clear filters restores visible inventory at ${width}px`, async ({ page }) => {
    test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires the local public inventory snapshot");
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/public/inventory?cardName=no-matching-public-card-zz");
    const results = page.locator(".inventory-results");
    await expect(results.getByText("No public cards match these filters.")).toBeVisible();
    const clear = results.getByRole("link", { name: "Clear filters", exact: true });
    await expect(clear).toHaveAttribute("href", "/public/inventory?displayMode=exact");
    await clear.click();
    await expect(page).toHaveURL(/\/public\/inventory\?displayMode=exact$/);
    await expect(page.locator(".inventory-result-summary")).toBeVisible();
    await expect(results.getByText("No public cards match these filters.")).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Card Name", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/cardName=no-matching-public-card-zz$/);
    await expect(results.getByText("No public cards match these filters.")).toBeVisible();
  });
}

test("Public clear filters retains browse options and resets pagination", async ({ page }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires the local public inventory snapshot");
  await page.goto("/public/inventory?cardName=no-matching-public-card-zz&displayMode=grouped&pageSize=10&sort=cardName&sortDir=desc&page=3");
  const clear = page.locator(".inventory-results").getByRole("link", { name: "Clear filters", exact: true });
  await expect(clear).toHaveAttribute("href", "/public/inventory?displayMode=grouped&pageSize=10&sort=cardName&sortDir=desc");
  await clear.click();
  await expect(page).toHaveURL(/displayMode=grouped&pageSize=10&sort=cardName&sortDir=desc$/);
  await expect(page.locator(".inventory-result-summary")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Card Name", exact: true })).toBeVisible();
  await expect(page.locator(".inventory-results").getByText("No public cards match these filters.")).toHaveCount(0);
});
