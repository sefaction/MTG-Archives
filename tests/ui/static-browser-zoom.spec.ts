import { expect, test } from "@playwright/test";
import { readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { openLocalPageAt200Percent } from "./local-browser-zoom";

test.use({ trace: "off", screenshot: "off", video: "off" });

function staticRoutes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return staticRoutes(path);
    if (entry.name !== "page.tsx") return [];
    const parent = dirname(relative("app", path));
    const route = parent === "." ? "/" : `/${parent.split(sep).join("/")}`;
    return route.includes("[") || route === "/" || route === "/login" ? [] : [route];
  });
}

test("static app routes remain reachable without page overflow at actual 200% browser zoom", async ({ baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires local review account and Chromium zoom extension");
  test.setTimeout(240_000);
  const username = process.env.UI_ADMIN_USERNAME || "admin";
  const password = process.env.UI_ADMIN_PASSWORD || "admin123";
  const routes = staticRoutes("app");
  const regular = routes.filter((route) => !route.startsWith("/admin"));
  const admin = routes.filter((route) => route.startsWith("/admin"));
  const { context, page } = await openLocalPageAt200Percent(baseURL, username, password, "/inventory");
  const offenders: string[] = [];
  try {
    const check = async (route: string) => {
      const response = await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${route} response`).toBeLessThan(500);
      await page.locator("main").first().waitFor();
      const size = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(size, `${route} retained 200% browser zoom`).toMatchObject({
        width: 683, height: 384, pixelRatio: 2,
      });
      if (size.scrollWidth > size.width + 1)
        offenders.push(`${route} -> ${new URL(page.url()).pathname}: ${size.scrollWidth}px`);
    };
    for (const route of regular) await check(route);
    await page.goto(`${baseURL}/settings`);
    await page.getByRole("button", { name: /enter admin mode/i }).click();
    await expect(page.getByRole("button", { name: /exit admin mode/i })).toBeVisible();
    for (const route of admin) await check(route);
    expect(routes).toHaveLength(24);
    expect(offenders, "Page-wide overflow at actual 200% browser zoom").toEqual([]);
  } finally {
    await context.close();
  }
});
