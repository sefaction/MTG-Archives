import { expect, test } from "@playwright/test";

const path = "/public/inventory?cardName=no-matching-public-card-zz";

for (const width of [1366, 390, 320]) {
  test(`Public inventory explains disabled JavaScript at ${width}px`, async (
    { browser, baseURL },
    testInfo,
  ) => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      viewport: { width, height: 844 },
    });
    try {
      const page = await context.newPage();
      await page.goto(path);
      const heading = page.getByRole("heading", {
        name: "Public inventory requires JavaScript",
      });
      await expect(heading).toBeVisible();
      await expect(
        page.getByText(/Enable JavaScript in your browser/),
      ).toBeVisible();
      await expect(page.locator(".public-inventory-interactive")).toBeHidden();
      await expect(page.locator(".animate-pulse").first()).toBeHidden();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const reload = page.getByRole("link", { name: "Reload this page" });
      await expect(reload).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(reload).toBeFocused();
      await Promise.all([page.waitForNavigation(), reload.press("Enter")]);
      await expect(page).toHaveURL(
        /\/public\/inventory\?cardName=no-matching-public-card-zz$/,
      );
      await expect(heading).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("disabled-javascript.png"),
      });
    } finally {
      await context.close();
    }
  });
}

test("Public inventory still browses with JavaScript enabled", async ({ page }) => {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Public inventory", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".inventory-workspace")).toBeVisible();
  await expect(
    page.getByText("No public cards match these filters."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Public inventory requires JavaScript" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /advanced inventory search/i }).click();
  await expect(page.getByRole("dialog", { name: "Filter inventory" })).toBeVisible();
  await page.getByRole("button", { name: "Close filters", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Filter inventory" })).toBeHidden();
  const search = page.getByRole("combobox", { name: "Quick card name search" });
  await search.fill("no-matching-public-card-zz-second");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/cardName=no-matching-public-card-zz-second/);
  await expect(search).toHaveValue("no-matching-public-card-zz-second");
  await expect(page.locator(".inventory-workspace")).toBeVisible();
});
