import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
const quote = JSON.stringify;
function database<T>(body: string): T {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30_000,
  }));
}

test("phone touch adds a deck card at 390px and 320px without changing Inventory", async ({ browser, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Local snapshot only");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(120_000);
  const tag = `ui-deck-touch-${randomUUID()}`;
  const password = randomUUID();
  let fixture: { ownerId: string; deckId: string } | undefined;
  try {
    fixture = database<{ ownerId: string; deckId: string }>(`
      return p.$transaction(async tx=>{
        const owner=await tx.player.create({data:{name:${quote(tag)},displayName:${quote(tag)}}});
        const user=await tx.user.create({data:{username:${quote(tag)},displayName:${quote(tag)},playerId:owner.id,passwordHash:await require('bcryptjs').hash(${quote(password)},10)}});
        const card=await tx.card.findFirstOrThrow({where:{name:'Forest'},orderBy:{id:'asc'}});
        const deck=await tx.deck.create({data:{ownerUserId:user.id,name:'Touch editing fixture',format:'COMMANDER',visibility:'PRIVATE',cards:{create:{cardId:card.id,cardName:card.name,quantity:99,section:'MAINBOARD'}}}});
        return {ownerId:owner.id,deckId:deck.id};
      });
    `);
    const deckId = fixture.deckId;
    const ownerId = fixture.ownerId;
    for (const [index, width] of [390, 320].entries()) {
      const context = await browser.newContext({
        viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
        deviceScaleFactor: 1,
      });
      try {
        const page = await context.newPage();
        await page.goto(`${baseURL}/login`);
        await page.getByLabel(/username or email/i).fill(tag);
        await page.getByLabel(/^password$/i).fill(password);
        await page.getByRole("button", { name: /^log in$/i }).tap();
        await page.waitForURL(/\/dashboard/);
        await page.goto(`${baseURL}/decks/${deckId}`);
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
        await page.getByRole("button", { name: "Add card", exact: true }).tap();
        const dialog = page.getByRole("dialog", { name: "Add card", exact: true });
        await expect(dialog).toBeVisible();
        const bounds = await dialog.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await dialog.getByLabel("Search for a card or printing").fill("Llanowar Elves");
        await dialog.locator(".max-h-80 button")
          .filter({ has: page.getByText("Llanowar Elves", { exact: true }) })
          .first().tap();
        await dialog.getByLabel("Quantity", { exact: true }).fill("1");
        await dialog.getByRole("button", { name: "Add selected printing" }).tap();
        await expect.poll(() => database<number>(`
          return (await p.deckCard.aggregate({where:{deckId:${quote(deckId)}},_sum:{quantity:true}}))._sum.quantity;
        `)).toBe(100 + index);
        await dialog.getByRole("button", { name: "Close", exact: true }).tap();
        await expect(dialog).not.toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      } finally {
        await context.close();
      }
    }
    expect(database<number>(`return p.inventoryItem.count({where:{currentOwnerId:${quote(ownerId)}}});`))
      .toBe(0);
  } finally {
    if (fixture) database(`await p.inventoryLocation.deleteMany({where:{ownerPlayerId:${quote(fixture.ownerId)}}});await p.user.deleteMany({where:{playerId:${quote(fixture.ownerId)}}});await p.player.delete({where:{id:${quote(fixture.ownerId)}}});return true;`);
  }
});
