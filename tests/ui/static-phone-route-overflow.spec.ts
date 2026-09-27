import { expect, test } from "@playwright/test";

test.use({ trace: "off", screenshot: "off", video: "off" });

const memberRoutes = [
  "/dashboard", "/inventory", "/locations", "/imports", "/decks",
  "/pricing", "/wishlist", "/trades", "/league", "/notifications",
  "/settings", "/settings/email", "/settings/webhooks",
  "/settings/pricing-alerts", "/change-password",
];
const publicRoutes = ["/public", "/public/inventory", "/public/decks"];
const adminRoutes = [
  "/admin", "/admin/backups", "/admin/metadata", "/admin/notifications",
  "/admin/notifications/trade-announcements", "/admin/prices",
];

test("static task routes avoid page-wide overflow at phone widths", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires local review account");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(240_000);
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(process.env.UI_ADMIN_USERNAME || "admin");
  await page.getByLabel(/^password$/i).fill(process.env.UI_ADMIN_PASSWORD || "admin123");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/);

  const offenders: string[] = [];
  const check = async (width: number, route: string) => {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${route} response`).toBeLessThan(500);
    await page.locator("main").first().waitFor();
    const size = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(size.width, `${route} rendered viewport`).toBe(width);
    if (size.scrollWidth > width + 1)
      offenders.push(`${width}px ${route} -> ${new URL(page.url()).pathname}: ${size.scrollWidth}px`);
  };
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of [...memberRoutes, ...publicRoutes]) await check(width, route);
  }
  await page.goto("/settings");
  await page.getByRole("button", { name: /enter admin mode/i }).click();
  await expect(page.getByRole("button", { name: /exit admin mode/i })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of adminRoutes) await check(width, route);
  }
  expect(offenders, "Page-wide horizontal overflow; locally scrolling tables/maps are allowed").toEqual([]);
});
