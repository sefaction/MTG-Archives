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
  try {
    ownerId = database<string>(
      `const owner=await p.player.create({data:{name:${JSON.stringify(username)},displayName:'Touch reviewer'}});await p.user.create({data:{username:${JSON.stringify(username)},displayName:'Touch reviewer',playerId:owner.id,passwordHash:await require('bcryptjs').hash(${JSON.stringify(password)},10)}});return owner.id;`,
    );
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
      } finally {
        await context.close();
      }
    }
  } finally {
    if (ownerId) {
      database(
        `await p.inventoryLocation.deleteMany({where:{ownerPlayerId:${JSON.stringify(ownerId)}}});await p.user.deleteMany({where:{playerId:${JSON.stringify(ownerId)}}});await p.player.delete({where:{id:${JSON.stringify(ownerId)}}});return true;`,
      );
    }
  }
});
