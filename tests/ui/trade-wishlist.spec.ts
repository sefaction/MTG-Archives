import { expect, test } from "@playwright/test";

const username = process.env.UI_ADMIN_USERNAME || "admin";
const password = process.env.UI_ADMIN_PASSWORD || "admin123";

async function login(page: import("@playwright/test").Page) {
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

test("trade wishlist surfaces render from public inventory, wishlist, and trades", async ({
  page,
}) => {
  await login(page);

  await page.goto("/wishlist?tab=trades");
  await expect(
    page.getByRole("heading", { level: 1, name: "Wishlist" }),
  ).toBeVisible();
  await expect(page.getByText("Trade wants").first()).toBeVisible();

  await page.goto("/trades");
  await expect(
    page.getByRole("heading", { level: 1, name: "Trades" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trade Desk" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cards I want" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Wanted from me" }),
  ).toBeVisible();
  const editableWishlistQuantity = page.getByLabel(/Wishlist quantity for/);
  if (await editableWishlistQuantity.count()) {
    await expect(editableWishlistQuantity.first()).toHaveAttribute("min", "1");
    await expect(editableWishlistQuantity.first()).toHaveAttribute(
      "max",
      "999",
    );
  }
  await expect(
    page.getByText(/Build a multi-card exchange with/),
  ).toBeVisible();
  await expect(page.getByText("0 cards offered")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit Proposal" }),
  ).toBeDisabled();
  await expect(page.getByText(/Search .*'s inventory/).first()).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Trade value comparison" }),
  ).toBeVisible();
  await expect(page.getByText("Value gap")).toBeVisible();
  await expect(page.getByText("Pairing board:")).toBeVisible();
  await expect(page.getByText("Drop cards here")).toHaveCount(2);

  await page.goto("/trades?counterTradeId=counter-test");
  await expect(
    page.getByText(
      /Counter proposal: submitting this draft will decline and replace/,
    ),
  ).toBeVisible();
  await expect(page.locator('input[name="counterTradeId"]')).toHaveValue(
    "counter-test",
  );

  await page.goto("/trades");
  const requestButton = page.getByRole("button", { name: "Request" }).first();
  const offerButton = page.getByRole("button", { name: "Offer" }).first();
  const requestCount = await requestButton.count();
  const offerCount = await offerButton.count();
  if (requestCount && offerCount) {
    await requestButton
      .locator("xpath=ancestor::article[1]")
      .dragTo(offerButton.locator("xpath=ancestor::article[1]"));
    await expect(
      page.locator('input[name="offeredLinesJson"]'),
    ).not.toHaveValue("[]");
    await expect(
      page.locator('input[name="requestedLinesJson"]'),
    ).not.toHaveValue("[]");
  } else if (requestCount) {
    await requestButton.click();
    await expect(
      page.locator('input[name="requestedLinesJson"]'),
    ).not.toHaveValue("[]");
  } else if (offerCount) {
    await offerButton.click();
    await expect(
      page.locator('input[name="offeredLinesJson"]'),
    ).not.toHaveValue("[]");
  }

  await page.goto("/trades?view=wishlist");
  await expect(
    page.getByRole("heading", { level: 2, name: "Trade Wishlist" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Every open person-to-person want/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cards I want" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Wanted from me" }),
  ).toBeVisible();

  await page.goto("/public/inventory?displayMode=exact&pageSize=10");
  if (
    await page.getByText("No public inventory is available yet.").isVisible()
  ) {
    test.skip(true, "local database has no public inventory rows");
  }

  const firstCard = page.locator("tbody button").first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();
  await expect(
    page.getByText(/Wishlist from|Choose trade target/),
  ).toBeVisible();
  await expect(page.getByLabel(/Wishlist quantity from/).first()).toBeVisible();
});
