import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function database<T>(body: string): T {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{" + body + "})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.code||'Owned deck fixture failed');process.exitCode=1}).finally(()=>p.$disconnect());",
    encoding: "utf8", timeout: 30000, windowsHide: true,
  }));
}

test("pasted physical copies preserve reviewed attributes and intentional append quantities", async ({page, baseURL}, testInfo) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local Docker fixture");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(120000);
  const owner = "ui-deck-paste-" + randomUUID(), password = randomUUID();
  const journal = testInfo.outputPath("owned-fixture.json");
  mkdirSync(path.dirname(journal), {recursive: true});
  writeFileSync(journal, JSON.stringify({owner}));
  try {
    const fixture = database<{control: string; physical: string; cardId: string; text: string}>(
      "const n=" + JSON.stringify(owner) + ";" +
      "await p.player.create({data:{id:n,name:n,displayName:n}});" +
      "await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:await require('bcryptjs').hash(" + JSON.stringify(password) + ",10)}});" +
      "const card=await p.card.findFirstOrThrow({where:{name:'Lightning Bolt',lang:'en',digital:false},orderBy:{id:'asc'}});" +
      "const make=name=>p.deck.create({data:{ownerUserId:n,name,format:'MODERN',visibility:'PRIVATE'}});const a=await make('Paste list control'),b=await make('Paste physical control');" +
      "return {control:a.id,physical:b.id,cardId:card.id,text:card.name+' ('+card.setCode+') '+card.collectorNumber};",
    );
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(owner);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", {name: /^log in$/i}).click();
    await page.waitForURL(/dashboard/);
    for (const [iteration, physical] of [false, true, true].entries()) {
      const deckId = physical ? fixture.physical : fixture.control;
      await page.setViewportSize({width: iteration === 2 ? 390 : 1440, height: 960});
      await page.goto("/decks/" + deckId + "/import");
      await page.getByLabel("Decklist text", {exact: true}).fill("2 " + fixture.text);
      await page.getByRole("button", {name: "Parse and review"}).click();
      const copies = page.getByLabel("Create and commit inventory");
      await expect(copies).toBeEnabled({timeout: 30000});
      if (physical) {
        await copies.check();
        const row = page.getByRole("row").filter({has: copies});
        await row.getByLabel("Quantity", {exact: true}).last().fill("1");
        await row.getByRole("combobox", {name: /^Condition/}).selectOption("LP");
        await row.getByLabel("Language", {exact: true}).fill("FR");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const form = page.locator("form").filter({has: page.locator('input[name="linesJson"]')});
      await form.getByRole("button").click();
      await page.waitForURL("**/decks/" + deckId);
      const result = database<{list: number; stock: number; audits: number; rows: {cardId: string; quantity: number; condition: string; language: string; foilStatus: string; location: {kind: string; deckId: string | null} | null}[]}>(
        "const n=" + JSON.stringify(owner) + ",deckId=" + JSON.stringify(deckId) + ";return {list:(await p.deckCard.aggregate({where:{deckId},_sum:{quantity:true}}))._sum.quantity||0,stock:(await p.inventoryItem.aggregate({where:{currentOwnerId:n},_sum:{quantity:true}}))._sum.quantity||0,audits:await p.inventoryAuditLog.count({where:{changedByUserId:n}}),rows:await p.inventoryItem.findMany({where:{currentOwnerId:n},select:{cardId:true,quantity:true,condition:true,language:true,foilStatus:true,location:{select:{kind:true,deckId:true}}}})};",
      );
      expect(result.list).toBe(iteration === 2 ? 4 : 2);
      expect(result.stock).toBe(iteration);
      expect(result.audits).toBe(iteration * 2);
      for (const row of result.rows) {
        expect(row.cardId).toBe(fixture.cardId);
        expect(row.condition).toBe("LP");
        expect(row.language).toBe("FR");
        expect(row.foilStatus).toBe("NONFOIL");
        expect(row.location).toEqual({kind: "DECK", deckId: fixture.physical});
      }
    }
  } finally {
    database("const n=" + JSON.stringify(owner) + ";if(!/^ui-deck-paste-[a-f0-9-]{36}$/.test(n))throw Error('Invalid fixture owner');await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.deck.deleteMany({where:{ownerUserId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});return {clean:true};");
  }
});
