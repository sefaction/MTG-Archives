import { expect, test } from "@playwright/test";

const username = process.env.UI_ADMIN_USERNAME || "admin";
const password = process.env.UI_ADMIN_PASSWORD || "admin123";

async function logIn(page: import("@playwright/test").Page) {
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

async function enterAdminMode(page: import("@playwright/test").Page) {
  const enterButton = page.getByRole("button", { name: /enter admin mode/i });
  if (await enterButton.isVisible()) {
    await enterButton.click();
    await expect(
      page.getByRole("button", { name: /exit admin mode/i }),
    ).toBeVisible();
  }
}

test("advanced inventory search applies Scryfall syntax to local cards", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await logIn(page);
  await enterAdminMode(page);
  await page.goto("/inventory");

  await page.getByRole("button", { name: /Advanced Inventory Search/ }).click();
  const query = page.getByLabel("Query arguments");
  await expect(query).toBeVisible();
  await query.fill("t:creature");
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page).toHaveURL(/scryfallQuery=t%3Acreature/, {
    timeout: 15_000,
  });
  await expect(page.getByLabel("Query arguments")).toHaveValue("t:creature");
  const summary = page.getByText(/^\d+ matching cards · Page \d+ of \d+$/);
  await expect(summary).toBeVisible();
  const localMatchCount = Number(
    (await summary.textContent())?.match(/^\d+/)?.[0],
  );
  expect(localMatchCount).toBeGreaterThan(0);
  expect(localMatchCount).toBeLessThan(5_000);
  await expect(
    page.getByRole("alert").filter({ hasText: /Scryfall/ }),
  ).toHaveCount(0);
});

test("anonymous public inventory applies Scryfall syntax to public local cards", async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.goto("/public/inventory");
  await page.getByRole("button", { name: /Advanced Inventory Search/ }).click();
  const query = page.getByLabel("Query arguments");
  await expect(query).toBeVisible();
  await query.fill("t:creature");
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page).toHaveURL(/scryfallQuery=t%3Acreature/, {
    timeout: 15_000,
  });
  await expect(page.getByLabel("Query arguments")).toHaveValue("t:creature");
  const summary = page.getByText(/^\d+ matching cards · Page \d+ of \d+$/);
  await expect(summary).toBeVisible();
  const localMatchCount = Number(
    (await summary.textContent())?.match(/^\d+/)?.[0],
  );
  expect(localMatchCount).toBeGreaterThan(0);
  expect(localMatchCount).toBeLessThan(4_568);
  await expect(
    page.getByRole("alert").filter({ hasText: /Scryfall/ }),
  ).toHaveCount(0);
});
