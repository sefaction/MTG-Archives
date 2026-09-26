import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });

function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}

test("phone touch can reach Inventory filters and Settings without page overflow", async ({
  browser,
  baseURL,
}) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Local snapshot only");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(90_000);
  const username = `ui-touch-${randomUUID()}`;
  const password = randomUUID();
  let ownerId: string | undefined;
  let fixture: { sourceId: string; destinationId: string } | undefined;
  try {
    ownerId = database<string>(
      `const owner=await p.player.create({data:{name:${JSON.stringify(username)},displayName:'Touch reviewer'}});await p.user.create({data:{username:${JSON.stringify(username)},displayName:'Touch reviewer',playerId:owner.id,passwordHash:await require('bcryptjs').hash(${JSON.stringify(password)},10)}});return owner.id;`,
    );
    fixture = database<{ sourceId: string; destinationId: string }>(`
      return p.$transaction(async tx=>{
        const source=await tx.inventoryLocation.create({data:{name:'Touch source',normalizedName:'touch source',ownerPlayerId:${JSON.stringify(ownerId)},type:'Box',visibility:'PRIVATE'}});
        const destination=await tx.inventoryLocation.create({data:{name:'Touch destination',normalizedName:'touch destination',ownerPlayerId:${JSON.stringify(ownerId)},type:'Box',visibility:'PRIVATE'}});
        const card=await tx.card.findFirstOrThrow({where:{name:'Forest'}});
        await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:${JSON.stringify(ownerId)},originalOpenerId:${JSON.stringify(ownerId)},locationId:source.id,quantity:4,sourceType:'MANUAL',condition:'NM',notes:${JSON.stringify(username)}}});
        return {sourceId:source.id,destinationId:destination.id};
      });
    `);
    for (const width of [390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
      });
      try {
        const page = await context.newPage();
        await page.goto(`${baseURL}/login`);
        await page.getByLabel(/username or email/i).fill(username);
        await page.getByLabel(/^password$/i).fill(password);
        await page.getByRole("button", { name: /^log in$/i }).tap();
        await page.waitForURL(/\/dashboard/);
        expect(
          await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
        ).toBe(true);

        const menu = page.locator(".archive-navigation > summary");
        await menu.tap();
        await page
          .getByRole("navigation", { name: "Archive navigation" })
          .getByRole("link", { name: "Inventory", exact: true })
          .tap();
        await expect(page).toHaveURL(/\/inventory/);
        const filters = page.getByRole("button", { name: /filters/i }).first();
        await filters.tap();
        const panel = page.locator(".inventory-filter-panel");
        await expect(panel).toBeVisible();
        expect(await panel.evaluate((node) => node.matches(":modal"))).toBe(
          true,
        );
        await panel.getByRole("tab", { name: "Query", exact: true }).tap();
        await panel
          .getByLabel("Query arguments", { exact: true })
          .fill("type:creature");
        await panel.getByRole("button", { name: "Close filters" }).tap();
        await expect(panel).not.toBeVisible();
        await filters.tap();
        await expect(
          panel.getByLabel("Query arguments", { exact: true }),
        ).toHaveValue("type:creature");
        await panel.getByRole("button", { name: "Close filters" }).tap();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);

        await menu.tap();
        await page
          .getByRole("navigation", { name: "Archive navigation" })
          .getByRole("link", { name: "Settings", exact: true })
          .tap();
        await expect(page).toHaveURL(/\/settings$/);
        await expect(
          page.getByRole("navigation", { name: "Account and settings" }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);

        // A touch user chooses fewer copies on the row before opening Move.
        await page.goto(`${baseURL}/inventory?locationId=${fixture.sourceId}&displayMode=exact`);
        const rowSelection = page.getByRole("checkbox", { name: /Select Forest/ });
        await expect(rowSelection).toHaveCount(1);
        await rowSelection.tap();
        const copies = page.getByRole("spinbutton", { name: /Copies selected from Forest/ });
        const chosen = width === 390 ? 2 : 1;
        await expect(copies).toHaveValue(width === 390 ? "4" : "2");
        await copies.tap();
        await copies.fill(width === 390 ? "0" : "3");
        await expect(copies).toHaveAttribute("aria-invalid", "true");
        await expect(copies.locator("..").getByRole("alert"))
          .toContainText(`Choose 1–${width === 390 ? 4 : 2} copies.`);
        await expect(copies).toHaveAttribute("aria-describedby", /selected-copy-error-/);
        if (width === 320) {
          await page.getByRole("button", { name: "Binder View", exact: true }).tap();
          await expect(copies).toHaveAttribute("aria-invalid", "true");
          await expect(copies.locator("..").getByRole("alert"))
            .toContainText("Choose 1–2 copies.");
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
          .toBe(true);
        const openMove = page.getByRole("button", { name: "Move cards…", exact: true });
        await openMove.tap();
        const move = page.getByRole("dialog", { name: "Move inventory" });
        await expect(move.getByRole("alert"))
          .toContainText("Close Move and correct the selected copy amount.");
        await move.getByRole("button", { name: "Cancel", exact: true }).tap();
        await copies.fill(String(chosen));
        await expect(copies).toHaveAttribute("aria-invalid", "false");
        await expect(page.locator(".inventory-selection-context")
          .filter({ hasText: "chosen for Move" }))
          .toContainText(`${chosen} ${chosen === 1 ? "copy" : "copies"} chosen for Move`);
        await openMove.tap();
        await expect(move).toContainText("Move uses the amounts selected in Inventory.");
        await expect(move).toContainText(`${chosen} physical ${chosen === 1 ? "copy" : "copies"}`);
        const picker = move.getByTestId("storage-destination");
        await picker.getByRole("combobox", { name: "Search destinations" })
          .fill("Touch destination");
        await picker.getByRole("option").filter({ hasText: "Touch destination" }).tap();
        const confirm = move.getByRole("button", { name: `Move ${chosen} ${chosen === 1 ? "card" : "cards"}`, exact: true });
        await expect(confirm).toBeEnabled();
        await confirm.scrollIntoViewIfNeeded();
        const bounds = await confirm.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await confirm.tap();
        await expect(page.getByText(new RegExp(`Moved ${chosen} ${chosen === 1 ? "card" : "cards"} across`)))
          .toBeVisible();
      } finally {
        await context.close();
      }
    }
  } finally {
    if (ownerId) {
      database(
        `await p.inventoryAuditLog.deleteMany({where:{changedByUser:{username:${JSON.stringify(username)}}}});await p.inventoryItem.deleteMany({where:{currentOwnerId:${JSON.stringify(ownerId)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:${JSON.stringify(ownerId)}}});await p.user.deleteMany({where:{playerId:${JSON.stringify(ownerId)}}});await p.player.delete({where:{id:${JSON.stringify(ownerId)}}});return true;`,
      );
    }
  }
});
