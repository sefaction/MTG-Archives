import { expect, test } from "@playwright/test";

const username = process.env.UI_ADMIN_USERNAME || "admin";
const password = process.env.UI_ADMIN_PASSWORD || "admin123";
const deckName = "Playwright Mana Curve Deck";

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

async function openOrCreatePrivateDeck(page: import("@playwright/test").Page) {
  await page.goto("/decks");
  const existing = page.getByRole("link", { name: deckName }).first();
  if (await existing.isVisible()) {
    await existing.click();
    return;
  }
  await page.getByText("+ New deck").click();
  await page.getByLabel("Deck name").fill(deckName);
  await page.getByLabel("Visibility").selectOption("PRIVATE");
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.waitForURL(/\/decks\/[^/]+$/);
}

test("deck analysis navigation, chart selection, and private access", async ({
  page,
}) => {
  await logIn(page);
  await openOrCreatePrivateDeck(page);

  const deckUrl = new URL(page.url());
  const deckPath = deckUrl.pathname;
  await expect(
    page.getByRole("navigation", { name: "Deck tools" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Analysis" })).toBeVisible();
  await page.getByRole("link", { name: "Analysis" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: deckName }),
  ).toBeVisible();
  await expect(page.getByText("Average mana value").first()).toBeVisible();
  await expect(page.getByText("Median mana value")).toBeVisible();
  await expect(page.getByText("Total mana value")).toBeVisible();
  await expect(page.getByText(/^Average MV$/)).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Deck mana curve" }),
  ).toBeVisible();
  await expect(page.getByText("Accessible curve table")).toBeVisible();
  await page.getByRole("button", { name: "0 mana: 0 cards" }).click();
  await expect(page.getByText("0 mana cards (0)")).toBeVisible();

  await page.context().clearCookies();
  await page.goto(`${deckPath}/analysis`);
  await expect(page.getByText(/This page could not be found/i)).toBeVisible();
});
