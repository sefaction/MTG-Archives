import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseDecklistText } from "../../lib/deck-import";

test.skip(
  process.env.MTG_LOCAL_PILOT_TEST !== "1",
  "Requires disposable local Docker snapshot",
);

function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 60_000,
    }),
  );
}

test("pasted decklists resolve owned faces, assign a commander, review and import without inventory changes", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  expect(baseURL).toBe("http://127.0.0.1:13001");
  const tag = `ui-paste-${randomUUID()}`;
  const password = randomUUID();
  // The user's full example stays local/ignored; CI uses a compact 99+1 sample.
  const source = process.env.MTG_PASTED_DECK_FIXTURE
    ? readFileSync(process.env.MTG_PASTED_DECK_FIXTURE, "utf8")
    : "99 Forest\n\n1 Esika, God of the Tree";
  const parsed = parseDecklistText(source);
  expect(
    parsed.lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0),
  ).toBe(100);
  let releaseResolution = () => {};
  try {
    const fixture = database<{ deckId: string; ownerId: string }>(`
      const name=${JSON.stringify(tag)};
      const owner=await p.player.create({data:{name,displayName:name}});
      const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);
      const user=await p.user.create({data:{username:name,displayName:name,playerId:owner.id,passwordHash:hash}});
      const deck=await p.deck.create({data:{ownerUserId:user.id,name:'Paste import regression',format:'COMMANDER',visibility:'PRIVATE'}});
      const location=await p.inventoryLocation.create({data:{ownerPlayerId:owner.id,name:'Paste fixture',normalizedName:'paste fixture'}});
      for(const line of ${JSON.stringify(parsed.lines.map((line) => ({ name: line.parsedName, quantity: line.quantity })))}) {
        const card=await p.card.findFirstOrThrow({where:{OR:[{name:{equals:line.name,mode:'insensitive'}},{name:{startsWith:line.name+' // ',mode:'insensitive'}}]},orderBy:{id:'asc'}});
        await p.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:owner.id,locationId:location.id,quantity:line.quantity,sourceType:'MANUAL',condition:'NM'}});
      }
      return {deckId:deck.id,ownerId:owner.id};
    `);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    await page.goto(`/decks/${fixture.deckId}/import`);
    const text = page.getByLabel("Decklist text", { exact: true });
    await text.fill("https://moxfield.com/decks/example");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "contents, not a website URL" }),
    ).toHaveText(/contents, not a website URL/);
    await expect(
      page.getByRole("button", { name: "Parse and review" }),
    ).toBeDisabled();
    await text.fill(source);
    await page.getByLabel("Bulk resolve").selectOption("owned-only");
    let signalStarted = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseResolution = resolve;
    });
    await page.route("**/api/decks/import/resolve", async (route) => {
      if (route.request().postDataJSON().mode === "resolve-lines") {
        signalStarted();
        await gate;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Parse and review" }).click();
    await started;
    await expect(text).toBeDisabled();
    await expect(
      page.getByLabel("Assign a commander", { exact: true }),
    ).toBeDisabled();
    releaseResolution();
    const commit = page.getByRole("button", {
      name: "Import 100 deck-list copies",
      exact: true,
    });
    await expect(commit).toBeEnabled({ timeout: 30_000 });
    await expect(
      page.getByText("No commander assigned.", { exact: false }),
    ).toBeVisible();
    await page
      .getByLabel("Assign a commander", { exact: true })
      .selectOption({ label: "Esika, God of the Tree" });
    await expect(
      page.getByLabel("Section for Esika, God of the Tree", { exact: true }),
    ).toHaveValue("COMMANDER");
    await expect(
      page.getByText("Esika, God of the Tree // The Prismatic Bridge", {
        exact: true,
      }),
    ).toBeVisible();

    await text.fill(`${source}\n`);
    await expect(
      page.getByRole("alert").filter({ hasText: "text changed" }),
    ).toHaveText(/text changed/);
    await expect(commit).toBeDisabled();
    await page.getByRole("button", { name: "Parse and review" }).click();
    await expect(commit).toBeEnabled({ timeout: 30_000 });
    await page
      .getByLabel("Assign a commander", { exact: true })
      .selectOption({ label: "Esika, God of the Tree" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("heading", { name: "Paste decklist" })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/paste-import-phone.png" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "test-results/paste-import-desktop.png" });
    await commit.click();
    await page.waitForURL(`**/decks/${fixture.deckId}`);
    const result = database<{
      sections: { section: string; _sum: { quantity: number } }[];
      commander: string;
      copies: number;
    }>(`
      const deckId=${JSON.stringify(fixture.deckId)};
      return {sections:await p.deckCard.groupBy({by:['section'],where:{deckId},_sum:{quantity:true}}),
        commander:(await p.deckCard.findFirstOrThrow({where:{deckId,section:'COMMANDER'}})).cardName,
        copies:(await p.inventoryItem.aggregate({where:{currentOwnerId:${JSON.stringify(fixture.ownerId)}},_sum:{quantity:true}}))._sum.quantity};
    `);
    expect(
      result.sections.find((row) => row.section === "MAINBOARD")?._sum.quantity,
    ).toBe(99);
    expect(
      result.sections.find((row) => row.section === "COMMANDER")?._sum.quantity,
    ).toBe(1);
    expect(result.commander).toBe(
      "Esika, God of the Tree // The Prismatic Bridge",
    );
    expect(result.copies).toBe(100);
    await page.context().clearCookies();
    const response = await page.goto(`/decks/${fixture.deckId}/import`);
    expect(response?.status()).toBe(404);
  } finally {
    releaseResolution();
    database(`const owners=await p.player.findMany({where:{name:${JSON.stringify(tag)}}});const ids=owners.map(x=>x.id);
      await p.inventoryAuditLog.deleteMany({where:{changedByUser:{username:${JSON.stringify(tag)}}}});
      await p.inventoryItem.deleteMany({where:{currentOwnerId:{in:ids}}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids}}});
      await p.user.deleteMany({where:{username:${JSON.stringify(tag)}}});
      await p.player.deleteMany({where:{id:{in:ids}}});return {removedFixtures:ids.length};`);
  }
});
