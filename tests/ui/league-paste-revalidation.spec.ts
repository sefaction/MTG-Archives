import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
const dir =
  process.env.MTG_LEAGUE_APPLY_EVIDENCE || ".local-data/league-apply-diagnosis";
function database(body: string) {
  const web = process.env.MTG_LEAGUE_APPLY_WEB!,
    owner = process.env.MTG_LEAGUE_APPLY_RUN!;
  if (!/^mtg-league-ui-[a-f0-9]{8}-web$/.test(web))
    throw Error("Wrong isolated web");
  const r = JSON.parse(
    execFileSync("docker", ["inspect", web], {
      encoding: "utf8",
      windowsHide: true,
    }),
  )[0];
  expect(r.Config.Labels["issue-worker-run"]).toBe(owner);
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        web,
        "node",
        "--import",
        "/app/node_modules/tsx/dist/loader.mjs",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
        input:
          "const assert=require('assert/strict'),{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{assert(process.env.DATABASE_URL.endsWith('/league_apply_ui'));" +
          body +
          "})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());",
      },
    ),
  );
}
test("League paste retains review on pool rejection and retries without inventory changes", async ({
  page,
}) => {
  test.skip(
    process.env.MTG_LEAGUE_APPLY_TEST !== "1",
    "Explicit owned disposable League fixture only",
  );
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const tag = "league-diag-" + randomUUID(),
    password = randomUUID(),
    f = database(
      `assert.equal(await p.user.count(),0);const id=${JSON.stringify(tag)},passwordHash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id,name:id,displayName:id}});await p.user.create({data:{id,username:id,displayName:id,playerId:id,passwordHash}});const location=await p.inventoryLocation.create({data:{ownerPlayerId:id,name:'Public League pool',normalizedName:'public league pool',visibility:'PUBLIC'}}),league=await p.commanderLeague.create({data:{name:id,slug:id,year:2026,createdByUserId:id}}),member=await p.commanderLeagueMember.create({data:{leagueId:league.id,userId:id,role:'ADMIN'}}),round=await p.commanderLeagueRound.create({data:{leagueId:league.id,monthNumber:1,name:'January',startDate:new Date('2026-01-01'),endDate:new Date('2026-02-01')}}),deck=await p.deck.create({data:{ownerUserId:id,name:'League final apply diagnostic',format:'COMMANDER',visibility:'PUBLIC'}});await p.commanderLeagueDeck.create({data:{archiveDeckId:deck.id,leagueId:league.id,memberId:member.id,roundId:round.id,name:deck.name}});await p.commanderLeagueLocation.create({data:{leagueId:league.id,locationId:location.id}});const cards=Array.from({length:100},(_,i)=>({id:'fixture-card-'+String(i).padStart(3,'0'),scryfallId:require('crypto').randomUUID(),name:'League Fixture '+String(i).padStart(3,'0'),setCode:'tst',collectorNumber:String(i+1),lang:'en',digital:false,finishes:['nonfoil'],typeLine:i===0?'Legendary Creature — Wizard':'Artifact',rarity:'common'}));await p.card.createMany({data:cards});await p.inventoryItem.createMany({data:cards.map(card=>({cardId:card.id,currentOwnerId:id,originalOpenerId:id,locationId:location.id,quantity:1,sourceType:'MANUAL',condition:'NM'}))});console.log(JSON.stringify({deckId:deck.id,leagueId:league.id,locationId:location.id,cards:cards.map(c=>({id:c.id,name:c.name}))}));`,
    );
  const snapshot = () =>
      database(
        `console.log(JSON.stringify({deck:await p.deckCard.findMany({where:{deckId:${JSON.stringify(f.deckId)}},orderBy:{cardId:'asc'}}),inventory:await p.inventoryItem.findMany({orderBy:{cardId:'asc'}}),audits:await p.inventoryAuditLog.count(),pool:await p.commanderLeagueLocation.findMany(),games:await p.commanderLeagueGame.count(),submissions:await p.commanderLeagueDeckSubmission.count()}));`,
      ),
    before = snapshot(),
    responses: any[] = [],
    errors: string[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "POST" && /\/decks\//.test(r.url()))
      responses.push({ path: new URL(r.url()).pathname, status: r.status() });
  });
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 180)));
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(tag);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/);
  async function prepare() {
    await page.goto("/decks/" + f.deckId + "/import");
    await page
      .getByLabel("Decklist text", { exact: true })
      .fill(f.cards.map((c: any) => "1 " + c.name).join("\n"));
    await page.getByLabel("Bulk resolve").selectOption("owned-only");
    await page
      .getByRole("button", { name: "Parse and review", exact: true })
      .click();
    const button = page.getByRole("button", {
      name: "Import 100 deck-list copies",
      exact: true,
    });
    await expect(button).toBeEnabled({ timeout: 30000 });
    await page
      .getByLabel("Assign a commander", { exact: true })
      .selectOption({ label: f.cards[0].name });
    return button;
  }
  let button = await prepare();
  const began = Date.now();
  await button.click();
  await page.waitForURL("/decks/" + f.deckId, { timeout: 30000 });
  const positive = snapshot();
  expect(positive.deck).toHaveLength(100);
  expect(positive.deck.reduce((n: number, c: any) => n + c.quantity, 0)).toBe(
    100,
  );
  expect(positive.deck.filter((c: any) => c.isCommander)).toHaveLength(1);
  expect(positive.inventory).toEqual(before.inventory);
  expect(positive.audits).toBe(before.audits);
  expect(positive.pool).toEqual(before.pool);
  expect(positive.games).toBe(0);
  expect(positive.submissions).toBe(0);
  fs.writeFileSync(
    dir + "/positive.json",
    JSON.stringify(
      {
        status: "PASS",
        distinctLines: 100,
        totalCopies: 100,
        elapsedMs: Date.now() - began,
        inventoryUnchanged: true,
        poolUnchanged: true,
        auditsUnchanged: true,
        noPhysicalCommitmentControl: true,
        scope:
          "Synthetic full diverse League list; not reported Unraid list/revision",
      },
      null,
      2,
    ),
  );
  button = await prepare();
  await page.locator("select[name=mode]").selectOption("replace");
  database(
    `await p.commanderLeagueLocation.delete({where:{leagueId_locationId:{leagueId:${JSON.stringify(f.leagueId)},locationId:${JSON.stringify(f.locationId)}}}});console.log(JSON.stringify({ownedPoolLinkRemoved:true}));`,
  );
  page.on("dialog", (d) => d.accept());
  await button.click();
  const feedback = page
    .getByRole("alert")
    .filter({ hasText: "The list was not imported." });
  await expect(feedback).toBeVisible();
  await expect(feedback).toContainText("not in this League's linked inventory");
  expect(page.url()).toContain("/decks/" + f.deckId + "/import");
  await expect(page.getByLabel("Decklist text", { exact: true })).toHaveValue(
    f.cards.map((c: any) => "1 " + c.name).join("\n"),
  );
  await expect(button).toBeEnabled();
  const rejected = snapshot();
  expect(rejected.deck).toEqual(positive.deck);
  expect(rejected.inventory).toEqual(before.inventory);
  expect(rejected.audits).toBe(before.audits);
  expect(rejected.pool).toHaveLength(0);
  expect(errors).toEqual([]);
  expect(
    responses.filter((r) => r.path.endsWith("/import") && r.status >= 500),
  ).toEqual([]);
  for (const width of [1366, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await feedback.scrollIntoViewIfNeeded();
    await expect(feedback).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: dir + "/league-feedback-" + width + ".png" });
  }
  database(
    `await p.commanderLeagueLocation.create({data:{leagueId:${JSON.stringify(f.leagueId)},locationId:${JSON.stringify(f.locationId)}}});console.log(JSON.stringify({ownedPoolRestored:true}));`,
  );
  await button.click();
  await page.waitForURL("/decks/" + f.deckId, { timeout: 30000 });
  const after = snapshot();
  expect(
    after.deck.map((c: any) => ({
      cardId: c.cardId,
      quantity: c.quantity,
      isCommander: c.isCommander,
      section: c.section,
    })),
  ).toEqual(
    positive.deck.map((c: any) => ({
      cardId: c.cardId,
      quantity: c.quantity,
      isCommander: c.isCommander,
      section: c.section,
    })),
  );
  expect(after.inventory).toEqual(before.inventory);
  expect(after.audits).toBe(before.audits);
  expect(
    after.pool.map((p: any) => ({
      leagueId: p.leagueId,
      locationId: p.locationId,
    })),
  ).toEqual(
    before.pool.map((p: any) => ({
      leagueId: p.leagueId,
      locationId: p.locationId,
    })),
  );
  expect(after.games).toBe(0);
  expect(after.submissions).toBe(0);
  fs.writeFileSync(
    dir + "/fixed-pool.json",
    JSON.stringify(
      {
        status: "PASS",
        validDistinctLines: 100,
        staleReplaceRejectedInForm: true,
        reviewPreserved: true,
        no500: true,
        retryReplacesExactly100Copies: true,
        oneCommander: true,
        inventoryAndAuditUnchanged: true,
        onlyIntendedPoolMutation: true,
        desktopAndPhone: [1366, 320],
        actualUnraidCauseUnknown: true,
      },
      null,
      2,
    ),
  );
});
