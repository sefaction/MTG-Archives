// Standalone prototype checks. No login, application API or snapshot writes.
import { chromium, expect } from "@playwright/test";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";

const root = process.cwd();
const output = resolve(root, "test-results/design-review");
await mkdir(output, { recursive: true });
async function pages(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? pages(resolve(dir, e.name))
          : e.name === "page.tsx"
            ? [resolve(dir, e.name)]
            : [],
      ),
    )
  ).flat();
}
const routes = (await pages(resolve(root, "app"))).map(
  (p) =>
    "/" + relative(resolve(root, "app"), p).split(sep).slice(0, -1).join("/"),
);
const ledger = await readFile(
  resolve(root, "docs/design/ui-consolidation/CAPABILITIES.md"),
  "utf8",
);
for (const route of routes)
  if (!ledger.includes("`" + route + "`"))
    throw new Error("Unmapped page: " + route);
const browser = await chromium.launch({ headless: true });
const errors = [];
const measurements = [];
let checks = 0;
try {
  for (const layout of ["rail", "top"]) {
    const page = await browser.newPage({
      viewport: { width: 1366, height: 768 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:13002");
    await page.locator("#layout").selectOption(layout);
    await expect(page.locator("#result-count")).toHaveText(
      "15 entries · 370 physical copies",
    );
    checks++;
    await page.getByLabel("Select Sol Ring", { exact: true }).check();
    await page.getByLabel("Select Arcane Signet", { exact: true }).check();
    await expect(page.locator("#selection-count")).toHaveText(
      "2 entries · 17 copies selected",
    );
    checks++;
    await page
      .getByRole("button", { name: "Move copies", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Fill remaining space", exact: true })
      .click();
    await expect(page.locator("#move-projection")).toContainText(
      "68 → 85 / 85",
    );
    checks++;
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator("#move-open")).toBeFocused();
    checks++;
    await expect(page.locator("#selection-count")).toHaveText(
      "2 entries · 17 copies selected",
    );
    checks++;
    await page.locator("#move-open").click();
    await page.locator("#move-section").selectOption("3");
    await expect(page.locator("#move-projection")).toContainText(
      "25 over capacity",
    );
    checks++;
    await page.locator("#move-section").selectOption("1");
    await page
      .getByRole("button", { name: "Simulate move", exact: true })
      .click();
    await expect(page.locator("#status")).toContainText(
      "17 copies to Vault A / Sect 1",
    );
    checks++;
    await expect(page.locator("#result-count")).toContainText(
      "370 physical copies",
    );
    checks++;
    await page.locator('[data-screen="locations"]').click();
    await expect(
      page.locator("#location-sections .vault-section").nth(1),
    ).toContainText("85 / 85");
    checks++;
    await page.locator("#location-sections .vault-section").nth(1).click();
    await expect(page.locator("#result-count")).toHaveText(
      "3 entries · 85 physical copies",
    );
    checks++;
    await page.goBack();
    await expect(page.locator("#locations-screen")).toBeVisible();
    checks++;
    await page.locator("#reset").click();
    await page.locator("#card-search").fill("Counterspell");
    await page.locator("#search-form button").click();
    await page.locator("#filter-toggle").click();
    await page.locator("#finish-filter").selectOption("Nonfoil");
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(page.locator("#result-count")).toHaveText(
      "1 entries · 4 physical copies",
    );
    checks++;
    await page
      .getByRole("button", { name: "Details for Counterspell", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", {
        name: "Details for Counterspell",
        exact: true,
      }),
    ).toBeFocused();
    checks++;
    await page
      .getByRole("button", { name: "Remove name filter", exact: true })
      .click();
    await expect(page.locator("#result-count")).toContainText(
      "362 physical copies",
    );
    checks++;
    await page.getByLabel("Select Sol Ring", { exact: true }).check();
    await page.locator("#card-search").fill("no-such-card");
    await page.locator("#search-form button").click();
    await expect(page.locator("#empty-results")).toBeVisible();
    await expect(page.locator("#selection-scope")).toContainText(
      "1 selected entries outside current filters",
    );
    checks += 2;
    await page.locator("#reset").click();
    await page.locator("#select-all").click();
    await expect(page.locator("#selection-count")).toContainText("370 copies");
    checks++;
    await page.locator("#clear-selection").click();
    await page.locator("#card-rows tr").nth(0).locator("td").nth(2).click();
    await page
      .locator("#card-rows tr")
      .nth(2)
      .locator("td")
      .nth(2)
      .click({ modifiers: ["Shift"] });
    await expect(page.locator("#selection-count")).toContainText(
      "3 entries · 21 copies",
    );
    checks++;
    await page.locator("#reset").click();
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const screen of ["inventory", "locations"]) {
        if (viewport.width <= 700) {
          await page.locator("#mobile-menu").click();
        }
        await page.locator(`[data-screen="${screen}"]`).click();
        for (const theme of [
          "izzet",
          "golgari",
          "azorius",
          "selesnya",
          "rakdos",
          "lotus",
        ]) {
          await page.locator("#theme").selectOption(theme);
          const size = await page.evaluate(() => ({
            width: innerWidth,
            overflow: document.documentElement.scrollWidth > innerWidth,
          }));
          if (size.width !== viewport.width || size.overflow) {
            console.log(
              await page.evaluate(() =>
                [...document.querySelectorAll("body *")]
                  .map((e) => ({
                    tag: e.tagName,
                    id: e.id,
                    class: e.className,
                    x: e.getBoundingClientRect().x,
                    right: e.getBoundingClientRect().right,
                  }))
                  .filter((e) => e.right > innerWidth + 1 || e.x < 0)
                  .slice(0, 20),
              ),
            );
            throw new Error(
              `Viewport/overflow: ${layout}/${screen}/${theme}/${viewport.width}`,
            );
          }
          checks++;
        }
        await page.locator("#theme").selectOption("izzet");
        const content = await page
          .locator(
            screen === "inventory" ? "#inventory-table" : "#location-sections",
          )
          .boundingBox();
        if (viewport.width > 700 && content.y >= viewport.height - 80)
          throw new Error("Content not visible in first viewport");
        measurements.push({
          layout,
          screen,
          ...viewport,
          contentY: Math.round(content.y),
        });
        await page.screenshot({
          path: resolve(output, `${layout}-${screen}-${viewport.width}.png`),
          fullPage: true,
        });
        if (screen === "inventory") {
          await page.locator("#filter-toggle").click();
          const expanded = await page.locator("#inventory-table").boundingBox();
          if (viewport.width > 700 && expanded.y !== content.y)
            throw new Error("Desktop filters displaced results vertically");
          if (
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            )
          )
            throw new Error("Expanded filters overflow");
          checks += 2;
          await page.screenshot({
            path: resolve(output, `${layout}-filters-${viewport.width}.png`),
            fullPage: true,
          });
          await page.locator("#close-filters").click();
          await expect(page.locator("#filter-toggle")).toBeFocused();
          checks++;
        }
      }
    }
    await page.setViewportSize({ width: 320, height: 844 });
    await page.locator("#reset").click();
    await page.getByLabel("Select Sol Ring", { exact: true }).check();
    await page.locator("#move-open").click();
    const box = await page.locator("#move-dialog").boundingBox();
    if (box.x < 0 || box.x + box.width > 320)
      throw new Error("Move dialog overflows phone");
    checks++;
    await page.screenshot({
      path: resolve(output, `${layout}-move-320.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(page.locator("#move-open")).toBeFocused();
    checks++;
    await page.close();
  }
  const response = await fetch("http://127.0.0.1:13002");
  if (
    !response.ok ||
    !response.headers
      .get("content-security-policy")
      ?.includes("connect-src 'none'")
  )
    throw new Error("Preview CSP missing");
  checks++;
  for (const path of ["/README.md", "/server.mjs", "/api/inventory/list"]) {
    if ((await fetch("http://127.0.0.1:13002" + path)).status !== 404)
      throw new Error("Unexpected served path " + path);
    checks++;
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const result = { routesMapped: routes.length, checks, errors, measurements };
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
