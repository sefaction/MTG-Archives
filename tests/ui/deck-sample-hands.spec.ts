import { expect, test } from "@playwright/test";

const username = process.env.UI_ADMIN_USERNAME || "admin";
const password = process.env.UI_ADMIN_PASSWORD || "admin123";
const deckName = "Playwright Sample Hands Deck";

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

async function addMainboardCopies(
  page: import("@playwright/test").Page,
  deckPath: string,
) {
  await page.goto(deckPath);
  await page.getByText("Actions", { exact: true }).click();
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Search for a card or printing").fill("Forest");
  const result = dialog.locator(".max-h-80 button").first();
  await expect(result).toBeVisible({ timeout: 15_000 });
  await result.click();
  await dialog.getByLabel("Quantity").fill("12");
  await dialog.getByRole("button", { name: "Add selected printing" }).click();
  await page.waitForLoadState("networkidle");
}

async function openPopulatedSampleHands(page: import("@playwright/test").Page) {
  await logIn(page);
  const deckPath = await openOrCreatePrivateDeck(page);
  await page.goto(`${deckPath}/hands`);
  if (
    await page.getByText(/has (?:only \d+|no) mainboard cards/i).isVisible()
  ) {
    await addMainboardCopies(page, deckPath);
    await page.goto(`${deckPath}/hands`);
  }
  return deckPath;
}

test("seeded sample hand supports a full London mulligan and draw flow", async ({
  page,
}) => {
  const deckPath = await openPopulatedSampleHands(page);

  await expect(
    page.getByRole("navigation", { name: "Deck tools" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sample Hands" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Opening seven")).toBeVisible();
  await expect(page.getByText("Average spell mana value")).toBeVisible();
  await expect(page.getByText("Expected lands")).toBeVisible();
  const hand = page.getByRole("region", { name: "Sample hand cards" });
  await expect(hand.locator("article")).toHaveCount(7);
  await page.getByRole("button", { name: "Draw card" }).click();
  await expect(
    page.getByText("Opening hand kept. Drew the first card."),
  ).toBeVisible();
  await expect(hand.locator("article")).toHaveCount(8);

  await page.getByText("Reproduce a hand with a seed").click();
  await page.getByLabel("Simulation seed").fill("phase-two-browser-seed");
  await page.getByRole("button", { name: "Deal seeded hand" }).click();
  const firstOrder = await hand.locator("article").allTextContents();
  expect(firstOrder).toHaveLength(7);
  await page.getByRole("button", { name: "Deal seeded hand" }).click();
  await expect(hand.locator("article")).toHaveCount(7);
  expect(await hand.locator("article").allTextContents()).toEqual(firstOrder);

  await page.getByRole("button", { name: "Mulligan" }).click();
  await expect(page.getByText(/Mulligan 1: choose 1 card/)).toBeVisible();
  const keepAndBottom = page.getByRole("button", {
    name: "Keep and bottom 1",
  });
  await expect(keepAndBottom).toBeDisabled();
  await page
    .getByRole("button", { name: /Select .* for mulligan bottom/ })
    .first()
    .click();
  await expect(keepAndBottom).toBeEnabled();
  await keepAndBottom.click();

  await expect(page.getByText("Kept after 1 mulligan")).toBeVisible();
  await expect(page.getByText(/1 on the bottom/)).toBeVisible();
  await expect(
    page.getByText("Hand kept. You can now draw individual cards."),
  ).toBeVisible();
  await expect(hand.locator("article")).toHaveCount(6);
  await page.getByRole("button", { name: "Draw card" }).click();
  await expect(hand.locator("article")).toHaveCount(7);

  await page.context().clearCookies();
  await page.goto(`${deckPath}/hands`);
  await expect(page.getByText(/This page could not be found/i)).toBeVisible();
});

test("sample-hand controls remain usable on a narrow touch layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPopulatedSampleHands(page);

  await expect(page.getByRole("heading", { name: deckName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mulligan" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Draw another hand" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mulligan" }).click();
  await page
    .getByRole("button", { name: /Select .* for mulligan bottom/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Keep and bottom 1" }),
  ).toBeEnabled();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(horizontalOverflow).toBe(false);
});
