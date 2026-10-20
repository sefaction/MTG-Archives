import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Standalone compiled real-component fixture: no HTTP, accounts or shared app.
test.use({ trace: "off", screenshot: "off", video: "off" });
for (const width of [1366, 390, 320]) test(`scan capacity filter preserves intent at ${width}px`, async ({ page }) => {
  test.skip(!process.env.MTG_PICKER_FIXTURE_JS || !process.env.MTG_PICKER_FIXTURE_CSS, "Requires compiled standalone fixture; see docs/SCAN_DESTINATION_FILTER.md");
  await page.setViewportSize({ width, height: 844 });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: readFileSync(process.env.MTG_PICKER_FIXTURE_CSS!, "utf8") });
  await page.addScriptTag({ content: readFileSync(process.env.MTG_PICKER_FIXTURE_JS!, "utf8") });
  const picker = page.getByTestId("storage-destination");
  const filter = picker.getByRole("checkbox", { name: "Only destinations with free space" });
  await expect(filter).not.toBeChecked();
  await expect(picker.getByRole("option")).toHaveCount(5);
  await filter.focus(); await page.keyboard.press("Space");
  await expect(picker.getByRole("option")).toHaveCount(2);
  await picker.getByRole("combobox").focus(); await page.keyboard.press("Enter");
  await expect(filter).toBeChecked(); // Choosing a location keeps this scan filter on.
  await expect(picker.getByRole("button", { name: /^Free\s/ })).toHaveCount(1);
  await expect(picker.getByRole("button", { name: /^Full\s/ })).toHaveCount(0);
  await expect(picker.getByRole("button", { name: /^Unknown\s/ })).toHaveCount(0);
  await expect(picker.getByRole("button", { name: "+ Custom section", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/scan-filter-on-${width}.png` });
  await picker.getByRole("button", { name: /^Free\s/ }).click();
  await expect(page.getByLabel("Selection", { exact: true })).toHaveText("partial/Free");
  const changes = await page.getByLabel("Selection changes", { exact: true }).textContent();
  await page.getByRole("button", { name: "Capacity becomes full" }).click();
  await expect(picker).toContainText("It does not match the free-space filter. Your selection is kept");
  await expect(picker.getByRole("button", { name: /^Free\s/ })).toHaveCount(0);
  await expect(picker.locator('input[name="destinationLocationSection"]')).toHaveValue("Free");
  await picker.getByRole("button", { name: "Change", exact: true }).click();
  await expect(picker.getByRole("option")).toHaveCount(0);
  await expect(picker).toContainText("No configured destinations with free space found");
  await picker.getByRole("combobox").focus(); await page.keyboard.press("Escape");
  await filter.uncheck();
  await expect(picker.getByRole("button", { name: /^Full\s/ })).toHaveCount(1);
  await expect(picker.getByRole("button", { name: /^Unknown\s/ })).toHaveCount(1);
  await expect(page.getByLabel("Selection changes", { exact: true })).toHaveText(changes!);
  await picker.getByRole("button", { name: "Change", exact: true }).click();
  await expect(picker.getByRole("option")).toHaveCount(5);
  await expect(page.getByLabel("Selection", { exact: true })).toHaveText("partial/Free");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/scan-filter-${width}.png` });
  await page.getByRole("button", { name: "Ordinary picker" }).click();
  await expect(filter).toHaveCount(0);
  await expect(picker.getByRole("checkbox", { name: "Only sections with room" })).not.toBeChecked();
});
