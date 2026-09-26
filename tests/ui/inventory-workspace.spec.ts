import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { openLocalPageAt200Percent } from "./local-browser-zoom";

test.use({ trace: "off", screenshot: "off", video: "off" });
const quote = JSON.stringify;
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Workspace fixture operation failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}

test("real Inventory workspace composes search, preserves context and reflows with accessible phone filters", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(120_000);
  const tag = `ui-workspace-${randomUUID()}`,
    password = randomUUID();
  const expectSingleColorRows = async () => {
    await page.getByRole("tab", { name: "Card", exact: true }).click();
    for (const group of await page
      .locator(".inventory-filter-panel .inventory-color-options")
      .all()) {
      const boxes = await group.locator("label").evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            right: rect.right,
            width: rect.width,
            height: rect.height,
          };
        }),
      );
      expect(boxes).toHaveLength(6);
      for (const box of boxes) {
        expect(box.y).toBe(boxes[0].y);
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
      }
      const groupBox = (await group.boundingBox())!;
      expect(boxes[5].right).toBeLessThanOrEqual(
        groupBox.x + groupBox.width + 1,
      );
    }
    const colorless = page.getByRole("checkbox", {
      name: "Card color Colorless",
      exact: true,
    });
    await colorless.locator("..").scrollIntoViewIfNeeded();
    await colorless.focus();
    await page.keyboard.press("Space");
    await expect(colorless).toBeChecked();
    await page.screenshot({
      path: `test-results/filter-color-row-${page.viewportSize()!.width}.png`,
      animations: "disabled",
    });
    await page.keyboard.press("Space");
    await expect(colorless).not.toBeChecked();
  };
  try {
    database(`return p.$transaction(async tx=>{
      const tag=${quote(tag)},passwordHash=await require('bcryptjs').hash(${quote(password)},10);
      const owner=await tx.player.create({data:{name:tag,displayName:'Workspace reviewer'}});
      await tx.user.create({data:{username:tag,displayName:'Workspace reviewer',passwordHash,playerId:owner.id}});
      await tx.inventoryLocation.create({data:{name:tag+' destination',normalizedName:(tag+' destination').toLowerCase(),ownerPlayerId:owner.id,type:'Box'}});
      for(const [name,quantity] of [['Forest',8],['Island',17]]) {
        const card=await tx.card.findFirstOrThrow({where:{name},orderBy:{id:'asc'}});
        await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:owner.id,quantity,sourceType:'MANUAL',condition:'NM',language:'EN',notes:tag}});
      }
      return true;
    });`);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/inventory?displayMode=exact&pageSize=10");
    const navigation = page.getByRole("navigation", {
      name: "Archive navigation",
    });
    await expect(
      navigation.getByRole("link", { name: "Inventory", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const table = page.locator(".inventory-results table");
    await expect(table).toBeVisible();
    database(`await p.user.update({where:{username:${quote(tag)}},data:{navigationLayout:'topbar'}});return true;`);
    await page.setViewportSize({ width: 960, height: 455 });
    await page.reload();
    await expect(page.locator(".archive-navigation > summary")).toBeVisible();
    await expect(table).toBeVisible();
    expect((await table.boundingBox())!.y).toBeLessThan(455);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    database(`await p.user.update({where:{username:${quote(tag)}},data:{navigationLayout:'sidebar'}});return true;`);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.reload();
    await expect(table).toBeVisible();
    await page.locator(".inventory-view-options > summary").click();
    await expect(
      page.getByLabel("Inventory page size", { exact: true }),
    ).toHaveValue("10");
    await expect(
      page.getByLabel("Inventory display", { exact: true }),
    ).toHaveValue("exact");
    await expect(
      page.getByLabel("Inventory browsing mode", { exact: true }),
    ).toHaveValue("paginated");
    await page.locator(".inventory-view-options > summary").click();
    await page
      .getByRole("button", { name: "Binder View", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Binder View", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Table View", exact: true }).click();
    const startY = (await table.boundingBox())!.y;
    expect(startY).toBeLessThan(650);
    await page
      .getByRole("button", { name: "Select all matching filters" })
      .click();
    await expect(
      page
        .locator(".inventory-selection-context")
        .filter({ hasText: "25 physical copies" }),
    ).toBeVisible();
    const selectedY = (await table.boundingBox())!.y;
    const filters = page.getByRole("button", {
      name: /advanced inventory search/i,
    });
    const closedFilterBox = (await filters.boundingBox())!;
    expect(closedFilterBox.x).toBe(
      (await page.locator(".inventory-workspace").boundingBox())!.x,
    );
    await filters.click();
    const panel = page.getByRole("dialog", { name: "Filter inventory" });
    await expect(panel).toBeVisible();
    await expectSingleColorRows();
    expect((await filters.boundingBox())!.x).toBe(closedFilterBox.x);
    expect((await filters.boundingBox())!.y).toBe(closedFilterBox.y);
    const applyBox = (await panel
      .getByRole("button", { name: "Apply filters" })
      .boundingBox())!;
    expect(applyBox.y + applyBox.height).toBeLessThanOrEqual(768);
    expect((await table.boundingBox())!.y - selectedY).toBeLessThan(120);
    expect((await table.boundingBox())!.x).toBeGreaterThan(
      (await panel.boundingBox())!.x + 300,
    );
    await expect(page.getByText("Optional filters hidden")).toHaveCount(0);
    await expect(page.locator('input[name="cardName"]:visible')).toHaveCount(1);
    await page
      .getByRole("combobox", { name: "Quick card name search" })
      .fill("Forest");
    const cardTab = panel.getByRole("tab", { name: "Card", exact: true });
    const collectionTab = panel.getByRole("tab", {
      name: "Collection",
      exact: true,
    });
    const queryTab = panel.getByRole("tab", { name: "Query", exact: true });
    await cardTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(collectionTab).toBeFocused();
    await expect(collectionTab).toHaveAttribute("aria-selected", "true");
    await expect(
      panel.getByRole("tabpanel", { name: "Card", exact: true }),
    ).not.toBeVisible();
    await panel.locator('input[name="language"]').fill("EN");
    const minimumPrice = panel.getByLabel("Minimum price in USD");
    await minimumPrice.fill("0.001");
    await cardTab.click();
    await panel.getByRole("button", { name: "Apply filters" }).click();
    await expect(collectionTab).toHaveAttribute("aria-selected", "true");
    await expect(minimumPrice).toBeFocused();
    await minimumPrice.fill("");
    await queryTab.click();
    await panel.getByLabel("Query arguments", { exact: true }).fill("t:land");
    await collectionTab.click();
    await expect(panel.locator('input[name="language"]')).toHaveValue("EN");
    await page.screenshot({
      path: "test-results/filter-collection-tab.png",
      animations: "disabled",
    });
    await panel.getByRole("button", { name: "Close filters" }).click();
    await expect(filters).toBeFocused();
    expect((await filters.boundingBox())!.x).toBe(closedFilterBox.x);
    await expect(
      page
        .locator(".inventory-selection-context")
        .filter({ hasText: "25 physical copies" }),
    ).toBeVisible();
    // Search applies the same draft form, including criteria edited before closing.
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/cardName=Forest/);
    await expect(page).toHaveURL(/language=EN/);
    await expect(page).toHaveURL(/scryfallQuery=t%3Aland/);
    await expect(page).toHaveURL(/pageSize=10/);
    await expect(
      table.getByText("Forest", { exact: true }).first(),
    ).toBeVisible();
    await expect(table.getByText("Island", { exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(page).not.toHaveURL(/cardName=/);
    await expect(
      page.getByRole("combobox", { name: "Quick card name search" }),
    ).toHaveValue("");
    await expect(
      table.getByText("Island", { exact: true }).first(),
    ).toBeVisible();
    await page.goForward();
    await expect(
      page.getByRole("combobox", { name: "Quick card name search" }),
    ).toHaveValue("Forest");
    await expect(table.getByText("Island", { exact: true })).toHaveCount(0);
    await filters.click();
    await page
      .getByRole("combobox", { name: "Quick card name search" })
      .fill("Island");
    await expect(panel.locator('input[name="cardName"]')).toHaveValue("Island");
    await expect(panel.locator('input[name="language"]')).toHaveValue("EN");
    await panel.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/cardName=Island/);
    await expect(
      table.getByText("Island", { exact: true }).first(),
    ).toBeVisible();
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    for (const theme of [
      "golgari",
      "azorius",
      "izzet",
      "rakdos",
      "lotus",
      "selesnya",
    ]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/workspace-theme-${theme}.png`,
        animations: "disabled",
      });
    }
    await page.screenshot({ path: "test-results/workspace-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((node) => node.matches(":modal"))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await expect(filters).toBeFocused();
    await page.locator(".archive-navigation > summary").click();
    await expect(
      navigation.getByRole("link", { name: "Locations", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".archive-navigation > summary")).toBeFocused();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await filters.click();
      await expectSingleColorRows();
      await queryTab.click();
      await panel
        .getByLabel("Query arguments", { exact: true })
        .fill("type:creature");
      await panel.getByRole("button", { name: "Close filters" }).click();
      await filters.click();
      await expect(
        panel.getByLabel("Query arguments", { exact: true }),
      ).toHaveValue("type:creature");
      await page.screenshot({
        path: `test-results/workspace-phone-${width}.png`,
      });
      await page.keyboard.press("Escape");
    }
    // Emulate the viewport and pixel density of a 1366x768 window at 200%.
    // Browser-chrome zoom itself still needs a manual acceptance check.
    await page.setViewportSize({ width: 683, height: 384 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 683, height: 384, deviceScaleFactor: 2, mobile: false,
      screenWidth: 1366, screenHeight: 768,
    });
    expect(await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]))
      .toEqual([683, 384, 2]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await expect(table).toBeVisible();
    await filters.click();
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((node) => node.matches(":modal"))).toBe(true);
    for (const name of ["Close filters", "Apply filters"]) {
      const control = panel.getByRole("button", { name });
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(384);
    }
    await page.screenshot({
      path: "test-results/workspace-enlarged-emulated.png",
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(filters).toBeFocused();
    await expect(table).toBeVisible();
    await filters.click();
    await queryTab.click();
    await panel.getByLabel("Query arguments", { exact: true }).fill("(");
    await cardTab.click();
    await panel.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/scryfallQuery=%28/);
    await expect(panel).toBeVisible();
    await expect(queryTab).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByRole("alert").first()).toBeVisible();
    expect(await panel.evaluate((node) => node.matches(":modal"))).toBe(true);
    await page.keyboard.press("Escape");
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await page.setViewportSize({ width: 1440, height: 900 });
    // Exercise Chrome's actual tab zoom in a separate, disposable browser profile.
    const { context: zoomContext, page: zoomPage } = await openLocalPageAt200Percent(
      baseURL, tag, password, "/inventory?displayMode=exact&pageSize=10",
    );
    try {
      await expect(zoomPage.locator(".inventory-results table")).toBeVisible();
      await expect.poll(() => zoomPage.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]))
        .toEqual([683, 384, 2]);
      expect(await zoomPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      const zoomFilters = zoomPage.getByRole("button", { name: /advanced inventory search/i });
      await expect(zoomPage.locator(".inventory-results table")).toBeVisible();
      await zoomFilters.click();
      const zoomPanel = zoomPage.getByRole("dialog", { name: "Filter inventory" });
      await expect(zoomPanel).toBeVisible();
      expect(await zoomPanel.evaluate((node) => node.matches(":modal"))).toBe(true);
      for (const name of ["Close filters", "Apply filters"]) {
        const button = zoomPanel.getByRole("button", { name });
        const box = (await button.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(384);
      }
      await zoomPage.screenshot({
        path: "test-results/workspace-enlarged-browser-zoom.png",
        animations: "disabled",
      });
      await zoomPage.keyboard.press("Escape");
      await expect(zoomFilters).toBeFocused();
      await zoomFilters.click();
      await zoomPanel.getByRole("tab", { name: "Query", exact: true }).click();
      await zoomPanel.getByLabel("Query arguments", { exact: true }).fill("(");
      await zoomPanel.getByRole("button", { name: "Apply filters" }).click();
      await expect(zoomPage).toHaveURL(/scryfallQuery=%28/);
      await expect(zoomPanel.getByRole("alert").first()).toBeVisible();
      await zoomPage.goto(`${baseURL}/inventory?displayMode=exact&pageSize=10`);
      const zoomRows = zoomPage.locator('tbody input[type="checkbox"]');
      await expect(zoomRows).toHaveCount(2);
      await zoomRows.nth(0).check();
      await zoomRows.nth(1).check();
      const firstCopyAmount = zoomPage.locator('tbody input[type="number"][max="8"]');
      const secondCopyAmount = zoomPage.locator('tbody input[type="number"][max="17"]');
      await expect(firstCopyAmount).toHaveValue("8");
      await expect(secondCopyAmount).toHaveValue("17");
      await firstCopyAmount.focus();
      await firstCopyAmount.press("ArrowDown");
      await expect(firstCopyAmount).toHaveValue("7");
      await expect(secondCopyAmount).toHaveValue("17");
      await firstCopyAmount.press("ArrowUp");
      await expect(firstCopyAmount).toHaveValue("8");
      await firstCopyAmount.scrollIntoViewIfNeeded();
      const copyBox = (await firstCopyAmount.boundingBox())!;
      expect(copyBox.x).toBeGreaterThanOrEqual(0);
      expect(copyBox.y).toBeGreaterThanOrEqual(0);
      expect(copyBox.x + copyBox.width).toBeLessThanOrEqual(683);
      expect(copyBox.y + copyBox.height).toBeLessThanOrEqual(384);
      await firstCopyAmount.fill("5");
      await secondCopyAmount.fill("12");
      await expect(zoomPage.locator(".inventory-selection-context")
        .filter({ hasText: "2 entries selected · 17 copies chosen for Move" }))
        .toBeVisible();
      await zoomPage.evaluate(() => window.scrollTo(0, 0));
      await zoomPage.getByRole("button", { name: "Move cards…", exact: true }).click();
      const zoomMove = zoomPage.getByRole("dialog", { name: "Move inventory" });
      await expect(zoomMove).toBeVisible();
      expect(await zoomMove.evaluate((node) => node.matches(":modal"))).toBe(true);
      const destinationSearch = zoomMove.getByRole("combobox", { name: "Search destinations" });
      await destinationSearch.fill(`${tag} destination`);
      await destinationSearch.press("ArrowDown");
      await destinationSearch.press("Enter");
      const confirmMove = zoomMove.getByRole("button", { name: "Move 17 cards", exact: true });
      await expect(confirmMove).toBeEnabled();
      const moveBox = (await zoomMove.boundingBox())!;
      expect(moveBox.y).toBeGreaterThanOrEqual(0);
      expect(moveBox.y + moveBox.height).toBeLessThanOrEqual(384);
      expect(await zoomPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      await zoomPage.screenshot({
        path: "test-results/workspace-move-browser-zoom.png",
        animations: "disabled",
      });
      await confirmMove.click();
      await expect(zoomMove).not.toBeVisible();
      await expect(zoomPage.getByText(/Moved 17 cards across 2 entries/)).toBeVisible();
      database(`
        const owner=await p.user.findUniqueOrThrow({where:{username:${quote(tag)}}});
        const original=await p.card.findFirstOrThrow({where:{name:'Forest'},orderBy:{id:'asc'}});
        const other=await p.card.findFirstOrThrow({where:{name:'Forest',id:{not:original.id}},orderBy:{id:'asc'}});
        await p.inventoryItem.create({data:{cardId:other.id,currentOwnerId:owner.playerId,originalOpenerId:owner.playerId,quantity:2,sourceType:'MANUAL',condition:'NM',language:'EN',notes:${quote(tag)}}});
        return true;
      `);
      await zoomPage.goto("/inventory?displayMode=exact&pageSize=10&cardName=Forest");
      const forestBoxes = zoomPage.getByRole("checkbox", { name: /^Select Forest, / });
      await expect(forestBoxes).toHaveCount(2);
      const tableNames = await forestBoxes.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label")),
      );
      expect(new Set(tableNames).size).toBe(2);
      await forestBoxes.first().check();
      await expect(zoomPage.locator(".inventory-selection-context")
        .filter({ hasText: "1 entry selected" })).toBeVisible();
      await forestBoxes.nth(1).check();
      const copyNames = await zoomPage.getByRole("spinbutton", {
        name: /^Copies selected from Forest, /,
      }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
      expect(copyNames).toHaveLength(2);
      expect(new Set(copyNames).size).toBe(2);
      await zoomPage.getByRole("button", { name: "Binder View", exact: true }).click();
      const cardBoxes = zoomPage.getByRole("checkbox", { name: /^Select Forest, / });
      await expect(cardBoxes).toHaveCount(2);
      const cardNames = await cardBoxes.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label")),
      );
      expect(new Set(cardNames).size).toBe(2);
      await expect(zoomPage.getByRole("spinbutton", {
        name: /^Copies selected from Forest, /,
      })).toHaveCount(2);
    } finally {
      await zoomContext.close();
    }
    await page.goto("/change-password");
    await expect(navigation).toBeVisible();
    expect(
      (await page.locator(".account-form").boundingBox())!.width,
    ).toBeLessThanOrEqual(512);
  } finally {
    database(
      `const users=await p.user.findMany({where:{username:${quote(tag)}},select:{id:true,playerId:true}});const ids=users.map(u=>u.id),owners=users.map(u=>u.playerId).filter(Boolean);await p.$transaction(async tx=>{await tx.inventoryItem.deleteMany({where:{currentOwnerId:{in:owners}}});await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});await tx.user.deleteMany({where:{id:{in:ids}}});await tx.player.deleteMany({where:{id:{in:owners}}});});return true;`,
    );
  }
});
