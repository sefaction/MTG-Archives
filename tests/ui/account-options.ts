import type { Locator, Page } from "@playwright/test";

export async function openAccountOptions(scope: Page | Locator) {
  const menu = scope.locator(".archive-account");
  if ((await menu.count()) && (await menu.getAttribute("open")) === null) {
    await menu.locator("summary").click();
  }
}
