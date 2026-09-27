import { chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";

// A disposable Chromium profile isolates the local zoom fixture from the user's browser.
export async function openLocalPageAt200Percent(
  baseURL: string | undefined,
  username: string,
  password: string,
  route: string,
): Promise<{ context: BrowserContext; page: Page }> {
  if (baseURL !== "http://127.0.0.1:13001" || !route.startsWith("/"))
    throw new Error("Real browser zoom runs only against the local review app");
  const extensionPath = path.resolve("tests/ui/fixtures/local-zoom-extension");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 1366, height: 768 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    await page.goto(`${baseURL}/login`);
    await page.getByLabel(/username or email/i).fill(username);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto(`${baseURL}${route}`);
    const before = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
    if (before.join(",") !== "1366,768,1")
      throw new Error(`Unexpected browser viewport before zoom: ${before.join("x")}`);
    const zoom = await worker.evaluate(async () => {
      const chrome = (globalThis as any).chrome;
      const tabs = await chrome.tabs.query({ url: "http://127.0.0.1:13001/*" });
      if (tabs.length !== 1 || tabs[0].id === undefined)
        throw new Error(`Expected one local app tab, found ${tabs.length}`);
      await chrome.tabs.setZoom(tabs[0].id, 2);
      return chrome.tabs.getZoom(tabs[0].id);
    });
    if (zoom !== 2) throw new Error(`Expected 200% tab zoom, got ${zoom}`);
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}
