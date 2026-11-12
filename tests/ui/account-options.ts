import { expect, type Locator, type Page } from "@playwright/test";

export async function openAccountOptions(scope: Page | Locator) {
  const menu = scope.locator(".archive-account");
  await expect(menu).toBeVisible();
  // A server action can replace the header after disabling its submit button.
  // Open the settled disclosure, rather than the header being replaced.
  await expect(menu.locator('button[aria-disabled="true"]')).toHaveCount(0);
  if ((await menu.getAttribute("open")) === null) {
    await menu.locator("summary").click();
  }
  await expect(menu).toHaveAttribute("open", "");
}
