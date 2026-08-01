import { expect, test } from "@playwright/test";

const username = process.env.UI_ADMIN_USERNAME || "admin";
const password = process.env.UI_ADMIN_PASSWORD || "admin123";
const deckName = "Playwright Playtest Deck";

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

async function ensureMainboard(
  page: import("@playwright/test").Page,
  deckPath: string,
) {
  await page.goto(`${deckPath}/playtest`);
  const libraryCount = Number.parseInt(
    (await page
      .getByRole("region", { name: "Library" })
      .getByText(/\d+ cards/)
      .textContent()) ?? "0",
    10,
  );
  if (libraryCount > 0) return;

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

async function openPopulatedPlaytest(page: import("@playwright/test").Page) {
  await logIn(page);
  const deckPath = await openOrCreatePrivateDeck(page);
  await ensureMainboard(page, deckPath);
  await page.goto(`${deckPath}/playtest`);
  return deckPath;
}

test("manual playtest actions are reversible and never persist to the deck", async ({
  page,
}) => {
  const deckPath = await openPopulatedPlaytest(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });

  await expect(page.getByRole("link", { name: "Playtest" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const library = page.getByRole("region", { name: "Library" });
  const initialLibraryCount = Number.parseInt(
    (await library.getByText(/\d+ cards/).textContent()) ?? "0",
    10,
  );
  expect(initialLibraryCount).toBeGreaterThanOrEqual(7);
  const hand = page.getByRole("region", { name: "Hand" });
  const battlefield = page.getByRole("region", { name: "Battlefield" });

  await page.getByRole("button", { name: "Draw 7" }).click();
  await expect(hand.locator("article")).toHaveCount(7);
  await expect(library).toContainText(`${initialLibraryCount - 7} cards`);

  const handCard = hand.locator("article").first();
  await handCard.getByRole("button", { name: /Card actions for/ }).click();
  await handCard.getByLabel("Move to").selectOption("battlefield");
  await handCard.getByRole("button", { name: "Move card" }).click();
  await expect(battlefield.locator("article")).toHaveCount(1);

  const permanent = battlefield.locator("article").first();
  await permanent.getByRole("button", { name: /Card actions for/ }).click();
  await permanent.getByRole("button", { name: "Tap", exact: true }).click();
  await expect(
    permanent.getByRole("button", { name: "Untap", exact: true }),
  ).toBeVisible();
  await permanent.getByRole("button", { name: /Add counter/ }).click();
  await expect(permanent.getByText("1 counters")).toBeVisible();

  await page.getByRole("button", { name: "Next turn" }).click();
  await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
  await expect(
    permanent.getByRole("button", { name: "Tap", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    permanent.getByRole("button", { name: "Untap", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();

  await page.getByRole("button", { name: "Lose 5 life" }).click();
  await expect(
    page.getByRole("region", { name: "Playtest controls" }),
  ).toContainText("35");

  await page.getByText("Search library", { exact: true }).click();
  await page.getByLabel("Search library cards").fill("");
  await page
    .getByText("Search library", { exact: true })
    .locator("..")
    .getByRole("button", { name: "Graveyard" })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "Graveyard" }).locator("article"),
  ).toHaveCount(1);

  await page.reload();
  await expect(hand.locator("article")).toHaveCount(0);
  await expect(battlefield.locator("article")).toHaveCount(0);
  await expect(library).toContainText(`${initialLibraryCount} cards`);
  expect(writes).toEqual([]);

  await page.context().clearCookies();
  await page.goto(`${deckPath}/playtest`);
  await expect(page.getByText(/This page could not be found/i)).toBeVisible();
});

test("playtest controls and zones remain usable on a narrow touch layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPopulatedPlaytest(page);

  await expect(page.getByRole("button", { name: "Draw 7" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Battlefield" })).toBeVisible();
  await page.getByRole("button", { name: "Draw 7" }).click();
  await expect(
    page.getByRole("region", { name: "Hand" }).locator("article"),
  ).toHaveCount(7);

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(horizontalOverflow).toBe(false);
});
