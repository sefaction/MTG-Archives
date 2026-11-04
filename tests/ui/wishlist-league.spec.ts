import { expect, test } from "@playwright/test";

// Run after scripts/verify-wishlist-league.ts, against that disposable runtime.
test.skip(process.env.MTG_WISHLIST_LEAGUE_FIXTURE !== "1", "requires the isolated #1002 SQL fixture");
for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
  test(`Wishlist excludes League demand in table, binder, filters and details at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill("wishlist1002");
    await page.getByLabel(/^password$/i).fill("wishlist1002-test");
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/wishlist");
    await expect(page.getByRole("heading", { level: 1, name: "Wishlist" })).toBeVisible();
    const summary = page.getByText("Manual rows", { exact: true }).locator("../..");
    for (const [label, value] of [["Manual rows", "2"], ["Deck-needed rows", "1"],
      ["Need", "5"], ["Ready", "1"], ["Get", "4"], ["Estimated cost to get", "$17.00"]]) {
      await expect(summary.getByText(label, { exact: true }).locator("..")).toContainText(value);
    }
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(page.getByText("League Only Card", { exact: true })).toHaveCount(0);
    await expect(page.getByText("league Commander", { exact: true })).toHaveCount(0);
    await expect(page.getByText("frozen Commander", { exact: true })).toHaveCount(0);
    await expect(page.locator('input[name="deckId"][value="league"], input[name="deckId"][value="frozen"]')).toHaveCount(0);
    const shared = page.locator("tbody tr").filter({ hasText: "Shared Wishlist Card" });
    await expect(shared).toContainText("normal Commander");
    await shared.getByRole("button", { name: "Shared Wishlist Card", exact: true }).click();
    await expect(page.getByRole("link", { name: "normal Commander", exact: true })).toHaveAttribute("href", "/decks/normal");
    await expect(page.locator('input[name="deckId"]')).not.toHaveCount(0);
    for (const input of await page.locator('input[name="deckId"]').all()) await expect(input).toHaveValue("normal");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Binder View", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Shared Wishlist Card", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Manual Only Card", exact: true })).toBeVisible();
    await page.screenshot({ path: `.local-data/evidence/wishlist-${viewport.width}.png`, fullPage: true });
    for (const [query, expected] of [["deck=league", 0], ["deck=frozen", 0], ["q=League+Only", 0],
      ["deck=normal", 1], ["tab=manual", 2], ["tab=decks", 1], ["tab=available", 1], ["tab=missing", 2]]) {
      await page.goto(`/wishlist?${query}&viewMode=table`);
      // The browser's saved Binder preference takes precedence on a fresh load.
      await page.getByRole("button", { name: "Table View", exact: true }).click();
      await expect(page.locator("tbody tr")).toHaveCount(Number(expected));
    }
  });
}
