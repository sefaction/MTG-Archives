import { expect, test, request, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { APP_THEMES } from "../../lib/themes";
import { cleanupReviewFixture, reviewDatabase, reviewFingerprint, reviewSourceState, setupReviewFixture } from "./review-acceptance-fixture";

test.skip(process.env.MTG_REVIEW_ACCEPTANCE_TEST !== "1", "Explicit owned presentation fixture; no native/hardware claim");
test.use({ trace: "retain-on-failure", screenshot: "only-on-failure", video: "off" });

async function renderedContrast(locator: Locator) {
  return locator.evaluate(element => {
    const rgba = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) throw Error("Unsupported computed color: " + value);
      return [channels[0], channels[1], channels[2]].map(v => value.startsWith("color(srgb") ? v * 255 : v).concat(channels[3] ?? 1);
    };
    const over = (top: number[], bottom: number[]) => top.slice(0, 3).map((v, i) => v * top[3] + bottom[i] * (1 - top[3]));
    const chain: Element[] = []; for (let node: Element | null = element; node; node = node.parentElement) chain.push(node);
    let background = [255, 255, 255];
    for (const node of chain.reverse()) background = over(rgba(getComputedStyle(node).backgroundColor), background);
    const foreground = over(rgba(getComputedStyle(element).color), background);
    const luminance = (rgb: number[]) => rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; })
      .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  });
}

for (const width of [1366, 390, 320]) test(`300-card review, six themes and competing editor at ${width}px`, async ({ page, baseURL }) => {
  test.setTimeout(180_000); page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
  const tag = `ui-review-acceptance-${randomUUID()}`, before = reviewFingerprint();
  writeFileSync(test.info().outputPath("fixture-before.json"), JSON.stringify({ tag, before }));
  let primaryError: unknown, peer: Awaited<ReturnType<typeof request.newContext>> | undefined;
  try {
    const fixture = await setupReviewFixture(page, baseURL!, tag, 300);
    const originals = reviewSourceState(fixture.batch);
    writeFileSync(test.info().outputPath("originals-before.json"), JSON.stringify(originals));
    await page.goto(`/imports/scan?batch=${fixture.batch}`);
    const first = page.getByTestId("capture-card-1"), uncertain = page.getByTestId("capture-card-2"), last = page.getByTestId("capture-card-300");
    const summary = page.getByTestId("scan-review-summary"), filter = page.getByRole("combobox", { name: "Show cards", exact: true });
    await expect(summary).toContainText("2 pending review or reconciliation");
    await expect(summary).toContainText("298 ready to preview");
    await expect(uncertain).toContainText("Confirm the physical count in reconciliation.");
    await expect(uncertain.getByRole("checkbox", { name: "Select card 2 for Inventory", exact: true })).toBeDisabled();
    await filter.selectOption("ready"); await expect(page.locator('[data-testid^="capture-card-"]')).toHaveCount(12);
    await expect(last).toHaveCount(0); await first.scrollIntoViewIfNeeded();
    await first.getByRole("button", { name: "Next awaiting review", exact: true }).click();
    await expect(filter).toHaveValue("all"); await expect(last).toBeFocused();
    await expect.poll(() => last.evaluate(el => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; })).toBe(true);
    writeFileSync(test.info().outputPath("navigation.json"), JSON.stringify(await last.evaluate(el => ({ text: el.textContent, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, viewport: innerHeight }))));
    // An unreviewed card first asks for its printing; its independent overflow
    // remains authoritative in progress even before that review is saved.
    const currentProgress = await (await page.request.get(`/api/acquisition/${fixture.batch}`)).json();
    expect(currentProgress.slots[299].physicalReadiness.reasons).toContain("OVERFLOW");
    await filter.selectOption("ready"); await first.scrollIntoViewIfNeeded();
    // Returning from the end can expose the load-more sentinel during scroll
    // clamping. Automatic next-page loading is allowed; rendering all is not.
    await expect(last).toHaveCount(0);
    expect(await page.locator('[data-testid^="capture-card-"]').count()).toBeLessThan(298);
    await first.getByRole("button", { name: "Correct", exact: true }).press("Enter");
    await first.getByRole("combobox", { name: "Card condition", exact: true }).selectOption("LP");
    const states: unknown[] = [];
    for (const theme of APP_THEMES) {
      await page.locator("html").evaluate((el, id) => el.setAttribute("data-theme", id), theme.id);
      for (const mode of ["Simple", "Advanced"]) {
        await page.getByRole("button", { name: mode, exact: true }).click();
        await first.scrollIntoViewIfNeeded();
        const condition = first.getByRole("combobox", { name: "Card condition", exact: true });
        await expect(condition).toHaveValue("LP"); await expect(first).toContainText("Unsaved correction");
        const save = first.getByRole("button", { name: "Save card review", exact: true });
        await expect(save).toBeEnabled();
        const textContrast = await renderedContrast(condition), actionContrast = await renderedContrast(save);
        expect(textContrast, `${theme.id}/${mode}/${width} condition text`).toBeGreaterThanOrEqual(4.5);
        expect(actionContrast, `${theme.id}/${mode}/${width} save action`).toBeGreaterThanOrEqual(4.5);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        states.push({ theme: theme.id, mode, width, textContrast, actionContrast });
        await page.screenshot({ path: test.info().outputPath(`${theme.id}-${mode}.png`) });
      }
    }
    writeFileSync(test.info().outputPath("theme-states.json"), JSON.stringify(states));
    await filter.selectOption("awaiting"); await expect(first).toBeVisible();
    await expect(first.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("LP");
    await page.reload(); await first.scrollIntoViewIfNeeded();
    await expect(first.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("LP");
    expect(reviewSourceState(fixture.batch)).toEqual(originals);
    peer = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL!, cookie: `mtg_inventory_session=${fixture.peerToken}` } });
    const current = await (await peer.get(`${fixture.endpoint}?photoId=${fixture.photo}`)).json();
    const changed = await peer.post(fixture.endpoint, { data: { action: "accept", photoId: fixture.photo, revision: current.revision,
      decision: { cardId: fixture.printing.id, finish: "NONFOIL", condition: "MP", language: "en" }, evidenceTokens: { current: current.evidenceToken } } });
    expect(changed.ok(), await changed.text()).toBe(true);
    const server = reviewSourceState(fixture.batch);
    const saved = server.candidates.find(value => value.acquisitionOrder === 0)!;
    expect(saved.review).toMatchObject({ condition: "MP", actorId: tag + "-peer" });
    const response = page.waitForResponse(r => r.url().endsWith(fixture.endpoint) && r.request().method() === "POST");
    await first.getByRole("button", { name: "Save card review", exact: true }).click();
    expect((await response).status()).toBe(409);
    await expect(first.getByRole("alert")).toContainText("changed");
    await expect(first.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("LP");
    expect(reviewSourceState(fixture.batch)).toEqual(server);
    await first.getByRole("button", { name: "Cancel changes", exact: true }).click();
    await expect(first.getByRole("combobox", { name: "Card condition", exact: true })).toHaveValue("MP");
    expect(reviewSourceState(fixture.batch)).toEqual(server);
    expect(server.photos).toEqual(originals.photos);
    expect(server.candidates.filter(value => value.acquisitionOrder !== 0)).toEqual(originals.candidates.filter(value => value.acquisitionOrder !== 0));
    expect(saved.revision).toBe(originals.candidates[0].revision + 1);
    expect(reviewDatabase(`return {stock:await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}),commits:await p.acquisitionCommit.count({where:{run:{sessionId:${JSON.stringify(fixture.batch)}}}}),audits:await p.inventoryAuditLog.count({where:{changedByUser:{playerId:${JSON.stringify(tag)}},changeType:'acquisition_committed'}})};`)).toEqual({ stock: 0, commits: 0, audits: 0 });
    writeFileSync(test.info().outputPath("originals-after.json"), JSON.stringify(server));
  } catch (error) { primaryError = error; throw error; }
  finally {
    const errors: unknown[] = [];
    try { await peer?.dispose(); } catch (error) { errors.push(error); }
    try { await page.unrouteAll({ behavior: "wait" }); await page.goto("about:blank"); } catch (error) { errors.push(error); }
    try { await page.context().clearCookies(); } catch (error) { errors.push(error); }
    try { cleanupReviewFixture(tag, tag + "-card"); } catch (error) { errors.push(error); }
    try { const after = reviewFingerprint(); writeFileSync(test.info().outputPath("fixture-after.json"), JSON.stringify({ tag, after })); expect(after).toEqual(before); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(primaryError ? [primaryError, ...errors] : errors, "Review acceptance and independent cleanup failures");
  }
});
