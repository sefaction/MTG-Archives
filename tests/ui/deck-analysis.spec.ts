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
    await page.waitForURL(/\/decks\/[^/]+$/);
    return new URL(page.url()).pathname;
  }
  await page.getByText("+ New deck").click();
  await page.getByLabel("Deck name").fill(deckName);
  await page.getByLabel("Visibility").selectOption("PRIVATE");
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.waitForURL(/\/decks\/[^/]+$/);
  return new URL(page.url()).pathname;
}

async function ensureCurveCard(
  page: import("@playwright/test").Page,
  deckPath: string,
) {
  await page.goto(deckPath);
  if (
    await page.getByText("Llanowar Elves", { exact: true }).first().isVisible()
  ) {
    return;
  }
  await page.getByText("Actions", { exact: true }).click();
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Search for a card or printing")
    .fill("Llanowar Elves");
  const result = dialog.locator(".max-h-80 button").first();
  await expect(result).toBeVisible({ timeout: 15_000 });
  await result.click();
  await dialog.getByRole("button", { name: "Add selected printing" }).click();
  await page.waitForLoadState("networkidle");
  const closeActions = page.getByRole("button", { name: "Close deck actions" });
  if (await closeActions.isVisible()) {
    await closeActions.click();
  }
}

test("deck analysis navigation, chart selection, and private access", async ({
  page,
}) => {
  await logIn(page);
  const deckPath = await openOrCreatePrivateDeck(page);
  await ensureCurveCard(page, deckPath);
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
  await page.getByRole("button", { name: /1 mana: \d+ cards/ }).click();
  await expect(page.getByText(/1 mana cards \(\d+\)/)).toBeVisible();
  const compactCard = page.getByRole("button", {
    name: "Preview Llanowar Elves",
  });
  await expect(compactCard).toBeVisible();
  await compactCard.hover();
  await expect(
    page.getByRole("complementary", { name: "Card preview" }),
  ).toBeVisible();
  await expect(page.getByAltText("Llanowar Elves")).toBeVisible();
  const curvePanel = await page
    .getByRole("region", { name: "Mana curve chart" })
    .boundingBox();
  const selectionPanel = await page
    .getByRole("region", { name: "Mana curve selection" })
    .boundingBox();
  expect(curvePanel).not.toBeNull();
  expect(selectionPanel).not.toBeNull();
  expect(Math.abs(curvePanel!.y - selectionPanel!.y)).toBeLessThan(4);
  await expect(
    page.getByRole("heading", { name: "Mana demand and land production" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /White/ }).click();
  await expect(page.getByText("White contributors")).toBeVisible();
  await expect(page.getByText("Demanding spells")).toBeVisible();
  await expect(page.getByText("Potential land sources")).toBeVisible();

  await page.context().clearCookies();
  await page.goto(`${deckPath}/analysis`);
  await expect(page.getByText(/This page could not be found/i)).toBeVisible();
});

test("mana production comparison remains usable on a narrow touch layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await logIn(page);
  await openOrCreatePrivateDeck(page);
  await page.getByRole("link", { name: "Analysis" }).click();

  await expect(
    page.getByRole("heading", { name: "Mana demand and land production" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Green/ }).click();
  await expect(page.getByText("Green contributors")).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(horizontalOverflow).toBe(false);
});
