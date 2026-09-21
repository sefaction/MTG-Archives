import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

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
  try {
    database(`return p.$transaction(async tx=>{
      const tag=${quote(tag)},passwordHash=await require('bcryptjs').hash(${quote(password)},10);
      const owner=await tx.player.create({data:{name:tag,displayName:'Workspace reviewer'}});
      await tx.user.create({data:{username:tag,displayName:'Workspace reviewer',passwordHash,playerId:owner.id}});
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
    await filters.click();
    const panel = page.getByRole("dialog", { name: "Filter inventory" });
    await expect(panel).toBeVisible();
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
    await panel.locator('input[name="language"]').fill("EN");
    await panel.getByRole("button", { name: "Close filters" }).click();
    await expect(filters).toBeFocused();
    await expect(
      page
        .locator(".inventory-selection-context")
        .filter({ hasText: "25 physical copies" }),
    ).toBeVisible();
    // Search applies the same draft form, including criteria edited before closing.
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/cardName=Forest/);
    await expect(page).toHaveURL(/language=EN/);
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
    await filters.click();
    await panel.getByLabel("Query arguments", { exact: true }).fill("(");
    await panel.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/scryfallQuery=%28/);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("alert").first()).toBeVisible();
    expect(await panel.evaluate((node) => node.matches(":modal"))).toBe(true);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
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
