import { expect, test, type Page } from "@playwright/test";
import { publicWishlistLink } from "../../lib/public-inventory-link";

test.skip(process.env.MTG_PUBLIC_WISHLIST_FIXTURE !== "1", "Requires scripts/verify-public-wishlist.ts in its explicitly isolated fixture.");
const ownerPath = "/public/wishlist/public-wishlist-owner";
const sharing = (page: Page) => page.getByRole("region", { name: "Public Wishlist sharing", exact: true });

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByLabel(/^password$/i).fill("public-wishlist-fixture-only");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/);
}

for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
  test(`public Wishlist ${viewport.width}: opt-in, privacy, owner settings, revocation and links`, async ({ page, browser }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const anonymous = await browser.newContext({ viewport });
    const visitor = await anonymous.newPage();
    try {
      await visitor.goto(ownerPath + "?owner=foreign&ownerId=foreign&categories=all&reason=manual");
      await expect(visitor.getByText("No Wishlist categories are shared.", { exact: true })).toBeVisible();
      await expect(visitor.getByText("Manual public card", { exact: true })).toHaveCount(0);
      await login(page, "public-wishlist-owner");
      await page.goto("/settings");
      for (const box of await sharing(page).getByRole("checkbox").all()) await expect(box).not.toBeChecked();
      await expect(sharing(page).getByRole("link", { name: "Your public Wishlist" })).toHaveAttribute("href", ownerPath);
      await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
          writeText: async (value: string) => { (window as unknown as { copiedWishlist: string }).copiedWishlist = value; },
        } });
      });
      await sharing(page).getByRole("button", { name: "Copy link", exact: true }).click();
      await expect(sharing(page).getByText("Link copied.", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { copiedWishlist: string }).copiedWishlist)).toBe(new URL(ownerPath, page.url()).href);
      // Neither forged owner fields nor an unknown category may widen this save.
      await sharing(page).locator("form").evaluate(form => {
        for (const [name, value] of [["ownerUserId", "public-wishlist-fixture-peer"], ["publicWishlistCategories", "all"]]) {
          const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.append(input);
        }
      });
      for (const box of await sharing(page).getByRole("checkbox").all()) await box.check();
      await sharing(page).getByRole("button", { name: "Save Wishlist sharing", exact: true }).click();
      await expect(sharing(page).getByText("Wishlist sharing saved.")).toBeVisible();
      await page.reload();
      for (const box of await sharing(page).getByRole("checkbox").all()) await expect(box).toBeChecked();
      await visitor.goto(ownerPath + "?owner=foreign&categories=all");
      for (const [category, name, quantity] of [["Manual wishes", "Manual public card", 3], ["Deck needs", "Deck public card", 2],
        ["From members", "Member public card", 2], ["Set Completion", "Set public card", 1]] as const) {
        const region = visitor.getByRole("region", { name: category, exact: true });
        await expect(region.getByText(name, { exact: true })).toBeVisible();
        await expect(region.getByText(`Wanted ${quantity}`, { exact: true })).toBeVisible();
      }
      const response = await visitor.request.get(ownerPath);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(await response.text()).not.toMatch(/PRIVATE-|FOREIGN-|LEAGUE-|PRIVATE-CONDITION|PRIVATE-LANGUAGE/);
      expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await visitor.screenshot({ path: `.local-data/public-wishlist-${viewport.width}.png`, fullPage: true });
      await login(visitor, "public-wishlist-peer");
      await visitor.goto(ownerPath);
      await expect(visitor.getByText("Manual public card", { exact: true })).toBeVisible();
      await visitor.goto("/public/wishlist/public-wishlist-peer?owner=public-wishlist-owner&categories=all");
      await expect(visitor.getByText("No Wishlist categories are shared.", { exact: true })).toBeVisible();
      await page.goto("/settings");
      for (const box of await sharing(page).getByRole("checkbox").all()) await box.uncheck();
      await sharing(page).getByRole("checkbox", { name: "From members", exact: true }).check();
      await sharing(page).getByRole("button", { name: "Save Wishlist sharing", exact: true }).click();
      await expect(sharing(page).getByText("Wishlist sharing saved.")).toBeVisible();
      await visitor.goto(ownerPath + "?categories=manual,decks,sets&owner=foreign");
      await expect(visitor.getByText("Member public card", { exact: true })).toBeVisible();
      for (const name of ["Manual public card", "Deck public card", "Set public card"]) await expect(visitor.getByText(name, { exact: true })).toHaveCount(0);
      await page.goto("/settings");
      for (const box of await sharing(page).getByRole("checkbox").all()) await box.uncheck();
      await sharing(page).getByRole("button", { name: "Save Wishlist sharing", exact: true }).click();
      await expect(sharing(page).getByText("Wishlist sharing saved.")).toBeVisible();
      await visitor.goto(ownerPath);
      await expect(visitor.getByText("No Wishlist categories are shared.", { exact: true })).toBeVisible();
      for (const username of [".", "A/B #1", "~public", "%2F"]) {
        await visitor.goto(publicWishlistLink(username));
        await expect(visitor.getByRole("heading", { name: `${username}'s public Wishlist`, exact: true })).toBeVisible();
        if (username === ".") await expect(visitor.getByText("No wishes in this category.", { exact: true })).toBeVisible();
      }
      for (const username of ["public-wishlist-unknown", "public-wishlist-inactive"]) {
        const result = await visitor.request.get(publicWishlistLink(username));
        expect(result.status()).toBe(404);
        expect(await result.text()).not.toContain("Manual public card");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.local-data/public-wishlist-settings-${viewport.width}.png`, fullPage: true });
    } finally { await anonymous.close(); }
  });
}
