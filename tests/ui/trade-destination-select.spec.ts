import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

// Actual server-rendered selector in an isolated form. No app, account,
// inventory, Docker service or shared database is accessed.
for (const width of [1366, 320]) {
  for (const count of [0, 1, 2]) {
    test(`physical destination requires deliberate selection at ${width}px with ${count} locations`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const locations = Array.from({ length: count }, (_, index) => ({ id: `location-${index}`, path: `Storage ${index}` }));
      // Render outside Playwright's JSX mounting transform, using the actual
      // React server renderer and production component.
      const selector = execFileSync(process.execPath, ["--import", "tsx", "tests/ui/trade-destination-markup.ts", String(count)], { encoding: "utf8" });
      await page.setContent(`<form>${selector}<button>Confirm Physical Trade</button></form>`);
      await page.evaluate(() => {
        document.querySelector("form")!.addEventListener("submit", (event) => {
          event.preventDefault();
          document.body.dataset.submitted = String(new FormData(event.target as HTMLFormElement).get("destinationLocationId"));
        });
      });
      const select = page.getByRole("combobox", { name: /Move 1 incoming card line to/ });
      await expect(select).toHaveValue("");
      await expect(select.locator("option:checked")).toHaveText("Choose a destination location");
      await expect(select.locator('option[value=""]')).toHaveAttribute("disabled", "");
      await page.getByRole("button", { name: "Confirm Physical Trade" }).click();
      expect(await select.evaluate((node: HTMLSelectElement) => node.validity.valueMissing)).toBe(true);
      await expect(page.locator("body")).not.toHaveAttribute("data-submitted");
      if (count) {
        const chosen = locations[count - 1].id;
        await select.selectOption(chosen);
        await page.getByRole("button", { name: "Confirm Physical Trade" }).click();
        await expect(page.locator("body")).toHaveAttribute("data-submitted", chosen);
        // A tampered/stale option value cannot fall back to the first location.
        await select.selectOption([]);
        await page.evaluate(() => { delete document.body.dataset.submitted; });
        await page.getByRole("button", { name: "Confirm Physical Trade" }).click();
        await expect(page.locator("body")).not.toHaveAttribute("data-submitted");
      }
    });
  }
}
