import { test, expect, type Page } from "@playwright/test";
type Fixture = {
  user: string;
  tokenBatch: string;
  artBatch: string;
  repairBatch: string;
  goblin: string;
  treasure: string;
  art: string;
};
const fixture: Fixture = JSON.parse(
  process.env.MTG_PAIRED_REVIEW_FIXTURE ?? "null",
);
test.beforeEach(async ({ page }) => {
  test.skip(
    !fixture,
    "Requires the dedicated paired-browser synthetic actor; no scanner/hardware is used",
  );
  await login(page, fixture.user);
});
async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(user);
  await page.getByLabel(/^password$/i).fill("admin123");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/dashboard/);
}
async function search(
  page: Page,
  label: string,
  query: string,
  identity: string,
) {
  const field = page.getByRole("group", { name: label, exact: true });
  await field.getByRole("textbox").fill(query);
  await field.getByRole("button", { name: "Find printing" }).click();
  await expect(
    field.getByRole("combobox").locator(`option[value="${identity}"]`),
  ).toHaveCount(1);
  await field.getByRole("combobox").selectOption(identity);
}
test("token review preserves drafts and retries the same lost-ACK confirmation before adding one physical copy", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto(`/imports/scan?batch=${fixture.tokenBatch}`);
  await search(page, "Token face 1", "Goblin", fixture.goblin + ":0");
  await search(page, "Token face 2", "Treasure", fixture.treasure + ":0");
  await page.getByLabel("Condition", { exact: true }).selectOption("LP");
  await page.reload();
  await expect(page.getByLabel("Condition", { exact: true })).toHaveValue("LP");
  const sizes = await page
    .getByRole("region", { name: "Review both sides", exact: true })
    .locator("img")
    .evaluateAll((images) =>
      images.map((i) => i.parentElement!.getBoundingClientRect().height),
    );
  expect(sizes).toHaveLength(4);
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(2);
  await page.getByRole("slider", { name: "Paired image size" }).fill("340");
  await page.reload();
  await expect(
    page.getByRole("slider", { name: "Paired image size" }),
  ).toHaveValue("340");
  await page.getByRole("checkbox", { name: /I checked both images/ }).check();
  let lost = false;
  await page.route(
    `**/api/acquisition/${fixture.tokenBatch}/paired`,
    async (route) => {
      const body = route.request().postDataJSON();
      if (
        route.request().method() === "POST" &&
        body.action === "confirm" &&
        !lost
      ) {
        lost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page
    .getByRole("button", { name: "Confirm physical item", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry saved request", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Retry saved request", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry saved request", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add 1 confirmed to Inventory", exact: true })
    .click();
  await expect(
    page.getByRole("region", {
      name: "Confirm Inventory addition",
      exact: true,
    }),
  ).toContainText("1 copy");
  await page
    .getByRole("button", { name: "Add 1 copy to Inventory", exact: true })
    .click();
  await expect(
    page.getByText("Added 1 copy to Inventory.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Saved to Inventory", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/paired-token-desktop.png",
    fullPage: true,
  });
});
test("art review keeps stamp choices separate and remains usable on desktop and phone", async ({
  page,
}) => {
  await page.goto(`/imports/scan?batch=${fixture.artBatch}`);
  await search(page, "Art-series printing", "Island", fixture.art + ":0");
  await page
    .getByLabel("Stamp", { exact: true })
    .selectOption("GOLD_PLANESWALKER");
  await page.getByLabel("Artwork is on", { exact: true }).selectOption("BACK");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Confirm physical item", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/paired-art-${width}.png`,
      fullPage: true,
    });
  }
  await page.reload();
  await expect(page.getByLabel("Stamp", { exact: true })).toHaveValue(
    "GOLD_PLANESWALKER",
  );
  await page.getByRole("checkbox", { name: /I checked both images/ }).check();
  await page
    .getByRole("button", { name: "Confirm physical item", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Confirmed pair", exact: true }),
  ).toBeVisible();
  const state = await (
    await page.request.get(`/api/acquisition/${fixture.artBatch}/paired`)
  ).json();
  expect(state.item.saved.stamp).toBe("GOLD_PLANESWALKER");
  expect(state.item.review.finish).toBe("NONFOIL");
});
test("pair repair is explicit and never consumes a third image", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto(`/imports/scan?batch=${fixture.repairBatch}`);
  const endpoint = `/api/acquisition/${fixture.repairBatch}/paired`;
  const original = (
    await (await page.request.get(endpoint)).json()
  ).item.photos.map((p: { id: string }) => p.id);
  await page.getByText("More", { exact: true }).click();
  await page
    .getByRole("button", { name: "Unpair these images", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(endpoint)).json()).repairSources.length,
    )
    .toBe(3);
  const state = await (await page.request.get(endpoint)).json();
  await page.getByText("Repair pairing", { exact: true }).click();
  const sources = original.map((id: string) =>
    state.repairSources.find((p: { photoId: string }) => p.photoId === id),
  );
  await page
    .getByLabel("First source", { exact: true })
    .selectOption(sources[0].photoId);
  await page
    .getByLabel("Second source", { exact: true })
    .selectOption(sources[1].photoId);
  await page
    .getByLabel("Reason for repair", { exact: true })
    .fill("Checked the two sides of the same physical token");
  await expect(
    page.getByRole("button", { name: "Pair these two images", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "These two images are opposite sides of the same physical item.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Pair these two images", exact: true })
    .click();
  await expect
    .poll(async () => (await (await page.request.get(endpoint)).json()).total)
    .toBe(2);
  const after = await (await page.request.get(endpoint)).json();
  expect(after.unresolvedImages).toBe(1);
});
test("profiles are visible at setup and private paired sources reject foreign users and missing origins", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/imports/scan?input=scanner");
  await page.getByLabel("Scan profile", { exact: true }).selectOption("ART");
  await expect(page.getByText(/Automatic duplex: both sides/)).toBeVisible();
  await page.getByLabel("Scan profile", { exact: true }).selectOption("TOKEN");
  const source = await (
    await page.request.get(`/api/acquisition/${fixture.artBatch}/paired`)
  ).json();
  const rejected = await page.request.post(
    `/api/acquisition/${fixture.artBatch}/paired`,
    { data: { action: "settle" } },
  );
  expect(rejected.ok()).toBe(false);
  expect(await rejected.text()).toContain("Request origin");
  const context = await browser.newContext({ baseURL });
  try {
    const foreign = await context.newPage();
    await login(foreign, fixture.user + "-other");
    const denied = await foreign.request.get(
      `/api/acquisition/${fixture.artBatch}/paired`,
    );
    expect(denied.status()).toBe(403);
    const photo = await foreign.request.get(
      `/api/acquisition/${fixture.artBatch}/photos/${source.item.photos[0].id}`,
    );
    expect(photo.status()).toBe(403);
  } finally {
    await context.close();
  }
});
