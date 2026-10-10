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

for (const publicInventory of [false, true]) {
  test(`${publicInventory ? "Public" : "Private"} inventory rejects invalid regex on desktop and phone`, async ({ page }) => {
    test.setTimeout(60_000);
    if (publicInventory) await page.context().clearCookies();
    else {
      await logIn(page);
      await enterAdminMode(page);
    }
    const route = publicInventory ? "/public/inventory" : "/inventory";
    const query = "-name:/[/";
    for (const viewport of [{ width: 1366, height: 900 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${route}?scryfallQuery=${encodeURIComponent(query)}`);
      const error = page.getByRole("alert").filter({ hasText: "Invalid regular expression" });
      await expect(error).toBeVisible();
      await expect(page.getByLabel("Query arguments")).toHaveValue(query);
      await expect(page.getByText(/^0 matching cards · Page/)).toBeVisible();
      await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(0);
      await expect(page.locator('input[name="selectionMode"]')).toHaveCount(0);
      await page.screenshot({ path: `test-results/regex-${publicInventory ? "public" : "private"}-${viewport.width}.png`, fullPage: true });
    }
    const response = await page.request.get(`/api${route}/list?scryfallQuery=${encodeURIComponent(query)}`);
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.filterError).toContain("Invalid regular expression");
    expect(result.totalMatchingCount).toBe(0);
    expect(result.rows).toEqual([]);
  });
}

test("invalid negated regex rejects both filtered CSV export methods", async ({ page }) => {
  await logIn(page);
  await enterAdminMode(page);
  const filterQuery = new URLSearchParams({ scryfallQuery: "-name:/[/" }).toString();
  const get = await page.request.get(`/api/inventory/export?scope=filtered&${filterQuery}`);
  const post = await page.request.post("/api/inventory/export", {
    form: { filterQuery, selectionMode: "all", format: "moxfield" },
  });
  for (const response of [get, post]) {
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("Invalid regular expression");
    expect(response.headers()["content-disposition"]).toBeUndefined();
  }
});

test("advanced inventory search applies Scryfall syntax to local cards", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await logIn(page);
  await enterAdminMode(page);
  await page.goto("/inventory");

  await page.getByRole("button", { name: /Advanced Inventory Search/ }).click();
  await page.getByRole("tab", { name: "Query", exact: true }).click();
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
  await page.getByRole("tab", { name: "Query", exact: true }).click();
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
