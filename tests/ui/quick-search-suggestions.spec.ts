import { expect, test } from "@playwright/test";

// Read-only routes and controlled suggestion replies: no collection fixtures or
// Inventory writes. Delays are released explicitly, not timed against a network.
const scenarios = ["/public/inventory", "/inventory"].flatMap((actionPath) =>
  [{ width: 1366, height: 768 }, { width: 320, height: 740 }].map((viewport) => ({ actionPath, viewport })),
);
for (const { actionPath, viewport } of scenarios) {
  test(`${actionPath} quick search Enter uses current text while suggestions are pending at ${viewport.width}px`, async ({ page, baseURL }) => {
    expect(baseURL).toBe("http://127.0.0.1:13001");
    if (actionPath === "/inventory") {
      test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires the local admin snapshot login");
      await page.goto("/login");
      await page.getByLabel(/username or email/i).fill(process.env.UI_ADMIN_USERNAME || "admin");
      await page.getByLabel(/^password$/i).fill(process.env.UI_ADMIN_PASSWORD || "admin123");
      await page.getByRole("button", { name: /^log in$/i }).click();
      await page.waitForURL(/\/dashboard/);
    }
    await page.setViewportSize(viewport);
    let release!: () => void;
    let requested!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const requestSeen = new Promise<void>((resolve) => { requested = resolve; });
    await page.route("**/api/inventory/filter-suggestions?**", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q");
      if (query === "Island") {
        requested();
        await pending;
      }
      const name = query === "Island" ? "Island" : "Forest";
      await route.fulfill({ json: { suggestions: [{ value: name, label: name }] } });
    });
    try {
      await page.goto(`${actionPath}?language=EN&displayMode=exact&pageSize=10&sort=setCode&sortDir=desc`);
      const search = page.getByRole("combobox", { name: "Quick card name search" });
      await search.fill("For");
      await expect(page.getByRole("option", { name: "Forest", exact: true })).toBeVisible();
      await search.fill("Island");
      await requestSeen;
      await search.press("Enter");
      await expect(page).toHaveURL(/[?&]cardName=Island(?:&|$)/);
      const params = new URL(page.url()).searchParams;
      expect(params.get("language")).toBe("EN");
      expect(params.get("displayMode")).toBe("exact");
      expect(params.get("pageSize")).toBe("10");
      expect(params.get("sort")).toBe("setCode");
      expect(params.get("sortDir")).toBe("desc");
      expect(params.get("page")).toBe("1");
      await expect(search).toHaveValue("Island");
      await page.screenshot({ path: `test-results/quick-search-pending-${actionPath.startsWith("/public") ? "public" : "private"}-${viewport.width}.png` });
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}

test("quick search drops superseded replies, clears options, and selects current suggestions", async ({ page, baseURL }) => {
  expect(baseURL).toBe("http://127.0.0.1:13001");
  let release!: () => void;
  let requested!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const requestSeen = new Promise<void>((resolve) => { requested = resolve; });
  await page.route("**/api/inventory/filter-suggestions?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "For") {
      requested();
      await pending;
    }
    await route.fulfill({ json: { suggestions: query === "For"
      ? [{ value: "Forest", label: "Forest" }]
      : [{ value: "Island", label: "Island" }, { value: "Island Sanctuary", label: "Island Sanctuary" }] } });
  });
  try {
    await page.goto("/public/inventory?language=EN&pageSize=10");
    const search = page.getByRole("combobox", { name: "Quick card name search" });
    await search.fill("For");
    await requestSeen;
    await search.fill("Isl");
    await expect(page.getByRole("option", { name: "Island", exact: true })).toBeVisible();
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(page.getByRole("option", { name: "Forest", exact: true })).toHaveCount(0);
    await search.press("ArrowDown");
    await expect(page.getByRole("option", { name: "Island Sanctuary", exact: true })).toHaveAttribute("aria-selected", "true");
    await search.press("Enter");
    await expect(page).toHaveURL(/[?&]cardName=Island\+Sanctuary(?:&|$)/);

    await page.route("**/api/inventory/filter-suggestions?**", (route) => route.fulfill({ json: { suggestions: [{ value: "Forest", label: "Forest" }] } }));
    await search.fill("For");
    await expect(page.getByRole("option", { name: "Forest", exact: true })).toBeVisible();
    await search.fill("");
    await expect(page.locator('[role="listbox"] [role="option"]')).toHaveCount(0);
    await search.press("Enter");
    await expect(page).not.toHaveURL(/[?&]cardName=/);
    await expect(search).toHaveValue("");
    await search.fill("For");
    await page.getByRole("option", { name: "Forest", exact: true }).click();
    await expect(page).toHaveURL(/[?&]cardName=Forest(?:&|$)/);
    expect(new URL(page.url()).searchParams.get("language")).toBe("EN");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
