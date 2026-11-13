import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.skip(
  process.env.MTG_LOCAL_PILOT_TEST !== "1",
  "Owned local review runtime only",
);
test.use({ actionTimeout: 15000 });
const target = process.env.MTG_UI_WEB_CONTAINER || "mtg-archives-web-1";
const q = JSON.stringify;
function db<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", target, "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 60000,
    }),
  );
}
type Fixture = {
  deck: string;
  publicDeck: string;
  league: string;
  frozen: string;
  member: string;
  destination: string;
};
function seed(tag: string, password: string): Fixture {
  return db(`const player=await p.player.create({data:{name:${q(tag)},displayName:${q(tag)}}});
    const user=await p.user.create({data:{username:${q(tag)},displayName:${q(tag)},playerId:player.id,passwordHash:await require('bcryptjs').hash(${q(password)},10)}});
    const cards=[];for(const [name,typeLine] of [['Needle Artifact','Artifact'],['Other Creature','Creature — Human'],['Sideboard Spell','Sorcery']])cards.push(await p.card.create({data:{name:${q(tag)}+' '+name,scryfallId:require('node:crypto').randomUUID(),typeLine,setCode:'tst',collectorNumber:String(cards.length),rarity:'common'}}));
    const entries=cards.map((card,i)=>({cardId:card.id,cardName:card.name,scryfallId:card.scryfallId,section:i===2?'SIDEBOARD':'MAINBOARD',quantity:i===0?2:1}));
    const deck=await p.deck.create({data:{ownerUserId:user.id,name:${q(tag)}+' private',visibility:'PRIVATE',cards:{create:entries}}});
    const publicDeck=await p.deck.create({data:{ownerUserId:user.id,name:${q(tag)}+' public',visibility:'PUBLIC',cards:{create:entries}}});
    await p.deck.createMany({data:Array.from({length:33},(_,i)=>({ownerUserId:user.id,name:${q(tag)}+' Shelf '+String(i).padStart(3,'0'),visibility:'PUBLIC'}))});
    await p.inventoryLocation.createMany({data:Array.from({length:1001},(_,i)=>({ownerPlayerId:player.id,name:'Store '+String(i).padStart(4,'0'),normalizedName:'store '+String(i).padStart(4,'0')}))});
    const destination=await p.inventoryLocation.findFirstOrThrow({where:{ownerPlayerId:player.id,name:'Store 1000'}});
    const location=await p.inventoryLocation.create({data:{ownerPlayerId:player.id,name:'Deck stock',normalizedName:'deck stock',kind:'DECK',deckId:deck.id,systemManaged:true}});
    await p.inventoryItem.create({data:{currentOwnerId:player.id,originalOpenerId:player.id,cardId:cards[0].id,locationId:location.id,quantity:1,condition:'NM',sourceType:'MANUAL'}});
    const league=await p.commanderLeague.create({data:{name:${q(tag)},slug:${q(tag)},year:2026,createdByUserId:user.id}});
    const members=[];for(let i=0;i<3;i++){let u=user;if(i){const pl=await p.player.create({data:{name:${q(tag)}+'-'+i,displayName:${q(tag)}+'-'+i}});u=await p.user.create({data:{username:${q(tag)}+'-'+i,displayName:${q(tag)}+'-'+i,playerId:pl.id,passwordHash:'unused'}});}members.push(await p.commanderLeagueMember.create({data:{leagueId:league.id,userId:u.id,role:i===0?'ADMIN':'PLAYER'}}));}
    const rounds=[];let frozen;for(let month=1;month<=12;month++){const round=await p.commanderLeagueRound.create({data:{leagueId:league.id,monthNumber:month,name:'Month '+month,startDate:new Date(2026,month-1,1),endDate:new Date(2026,month,0)}});rounds.push(round);
      for(const member of members){const archive=await p.deck.create({data:{ownerUserId:member.userId,name:${q(tag)}+' League '+month+' '+member.id,visibility:'PRIVATE',format:'COMMANDER',cards:{create:entries}}});const ld=await p.commanderLeagueDeck.create({data:{leagueId:league.id,memberId:member.id,roundId:round.id,archiveDeckId:archive.id,name:archive.name}});if(month===1&&member.id===members[0].id)frozen=ld;}}
    const game=await p.commanderLeagueGame.create({data:{leagueId:league.id,roundId:rounds[0].id,playedAt:new Date('2026-01-15T12:00:00Z'),createdByUserId:user.id}});
    for(let i=0;i<2;i++){const participant=await p.commanderLeagueGameParticipant.create({data:{gameId:game.id,memberId:members[i].id,result:i?'LOSS':'WIN',pointsAwarded:i?0:3}});await p.commanderLeagueDeckSubmission.create({data:{participantId:participant.id,sourceLeagueDeckId:i?null:frozen.id,deckName:'Snapshot',cards:{create:Array.from({length:50},(_,n)=>({cardName:'Ranked '+String(n).padStart(3,'0'),oracleId:'ranked-'+n,quantity:1,section:'MAINBOARD',isCommander:n===0}))}}});}
    return {deck:deck.id,publicDeck:publicDeck.id,league:league.id,frozen:frozen.archiveDeckId,member:members[0].id,destination:destination.id};`);
}
function cleanup(tag: string) {
  db(
    `const users=await p.user.findMany({where:{username:{startsWith:${q(tag)}}},select:{id:true,playerId:true}});const ids=users.map(u=>u.id);await p.commanderLeagueGame.deleteMany({where:{league:{createdByUserId:{in:ids}}}});await p.commanderLeagueDeck.deleteMany({where:{league:{createdByUserId:{in:ids}}}});await p.commanderLeague.deleteMany({where:{createdByUserId:{in:ids}}});for(const u of users){await p.inventoryItem.deleteMany({where:{currentOwnerId:u.playerId}});await p.deck.deleteMany({where:{ownerUserId:u.id}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:u.playerId}});await p.authSession.deleteMany({where:{userId:u.id}});await p.user.delete({where:{id:u.id}});await p.player.delete({where:{id:u.playerId}});}await p.card.deleteMany({where:{name:{startsWith:${q(tag)}}}});return true;`,
  );
}
async function login(page: Page, tag: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(tag);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/dashboard/);
}
for (const width of [1366, 390, 320]) {
  test(`shared browsing, destinations and retained context at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(240000);
    expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
    await page.setViewportSize({ width, height: 844 });
    const tag = `browse-${randomUUID()}`;
    const password = randomUUID();
    try {
      const f = seed(tag, password);
      await login(page, tag, password);
      await page.goto(`/decks/${f.deck}`);
      const filters = page.getByRole("form", { name: "Filter deck cards" });
      const search = filters.getByRole("searchbox", {
        name: "Search deck cards",
      });
      await expect(filters).toContainText("Showing 3 of 3 deck entries");
      await page
        .getByRole("checkbox", {
          name: `Select ${tag} Needle Artifact`,
          exact: true,
        })
        .check();
      await search.pressSequentially("Other Creature", { delay: 40 });
      await expect(search).toHaveValue("Other Creature");
      await expect(filters).toContainText("Showing 1 of 3 deck entries");
      await expect(filters).toContainText(
        "1 selected entries are outside these filters",
      );
      await search.press("Enter");
      await expect(search).toHaveValue("Other Creature");
      await page.reload();
      await expect(search).toHaveValue("Other Creature");
      const tools = page.getByRole("navigation", { name: "Deck tools" });
      await expect(
        tools.getByRole("link", { name: "Analysis", exact: true }),
      ).toHaveAttribute("href", new RegExp("cardQ=Other(?:\\+|%20)Creature"));
      await tools.getByRole("link", { name: "Analysis", exact: true }).click();
      await tools.getByRole("link", { name: "Builder", exact: true }).click();
      await expect(search).toHaveValue("Other Creature");
      await page
        .getByRole("button", { name: "Clear card filters", exact: true })
        .click();
      await filters
        .getByRole("combobox", { name: "Filter section", exact: true })
        .selectOption("SIDEBOARD");
      await expect(filters).toContainText("Showing 1 of 3 deck entries");
      await page
        .getByRole("button", { name: "Clear card filters", exact: true })
        .click();
      await filters
        .getByRole("combobox", { name: "Filter card type", exact: true })
        .selectOption("Artifact");
      await expect(filters).toContainText("2 matching copies");
      await expect(
        page.getByText("4 cards · 3 missing · 1 physically committed", {
          exact: true,
        }),
      ).toBeVisible();
      const exported = await page.request.get(
        `/api/decks/${f.deck}/export?cardType=Artifact`,
      );
      expect(exported.ok()).toBe(true);
      const fullDecklist = await exported.text();
      for (const name of [
        "Needle Artifact",
        "Other Creature",
        "Sideboard Spell",
      ])
        expect(fullDecklist).toContain(`${tag} ${name}`);
      await page
        .getByRole("button", {
          name: `Open details for ${tag} Needle Artifact`,
          exact: true,
        })
        .click();
      const drawer = page.getByRole("dialog", {
        name: `${tag} Needle Artifact`,
        exact: true,
      });
      await expect(
        drawer.getByRole("button", { name: "Close", exact: true }),
      ).toBeFocused();
      const notes = drawer.getByLabel("Notes", { exact: true });
      await notes.fill("Unsaved draft");
      page.once("dialog", (d) => d.dismiss());
      await page.keyboard.press("Escape");
      await expect(notes).toHaveValue("Unsaved draft");
      page.once("dialog", (d) => d.dismiss());
      await drawer.getByRole("tab", { name: "Commit", exact: true }).click();
      await expect(notes).toBeVisible();
      page.once("dialog", (d) => d.accept());
      await drawer.getByRole("tab", { name: "Commit", exact: true }).click();
      const destination = drawer.getByLabel("Destination", { exact: true });
      const locationSearch = drawer.getByRole("searchbox", {
        name: "Search destination options",
        exact: true,
      });
      await expect(destination.locator("option")).toHaveCount(31);
      await locationSearch.fill("Store 1000");
      await locationSearch.press("Enter");
      await expect(destination).toBeFocused();
      await destination.selectOption(f.destination);
      await destination.press("Enter");
      await locationSearch.fill("Store 0000");
      await expect(destination).toHaveValue(f.destination);
      await expect(destination.locator("option")).toHaveCount(3);
      expect(
        db<number>(
          `return await p.inventoryItem.count({where:{location:{deckId:${q(f.deck)}}}});`,
        ),
      ).toBe(1);
      await drawer.screenshot({
        path: test.info().outputPath("searchable-destination.png"),
      });
      page.once("dialog", (d) => d.accept());
      await page.keyboard.press("Escape");
      // Native search consumes Escape to clear its query before dismissing the drawer.
      await expect(locationSearch).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(drawer).not.toBeVisible();
      await page.goto("/decks");
      const librarySearch = page.getByRole("searchbox", {
        name: "Search decks",
        exact: true,
      });
      await librarySearch.pressSequentially(`${tag} Shelf`, { delay: 15 });
      await expect(librarySearch).toHaveValue(`${tag} Shelf`);
      const paging = page.getByRole("navigation", {
        name: "Deck library pagination",
      });
      await paging
        .getByRole("combobox", { name: "Rows per page", exact: true })
        .selectOption("10");
      await expect(paging).toContainText("1–10 of 33");
      await paging.getByRole("button", { name: "Next", exact: true }).click();
      await expect(paging).toContainText("11–20 of 33");
      const libraryURL = page.url();
      await page.reload();
      await expect(paging).toContainText("11–20 of 33");
      const deckLink = page
        .getByRole("region", { name: "Deck library results" })
        .getByRole("link")
        .filter({ hasText: `${tag} Shelf` })
        .first();
      const openedDeckName = (await deckLink.textContent())!.trim();
      await deckLink.click();
      await expect(page).toHaveURL(/\/decks\/[^/?]+$/);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: openedDeckName,
          exact: true,
        }),
      ).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(libraryURL);
      await expect(paging).toContainText("11–20 of 33");
      await page.screenshot({
        path: test.info().outputPath("library-page.png"),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.context().clearCookies();
      await page.goto(
        `/decks/${f.publicDeck}?cardQ=Needle&cardStatus=committed`,
      );
      await expect(filters).toContainText("Showing 1 of 3 deck entries");
      await expect(filters.getByLabel("Filter inventory status")).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("checkbox", { name: /Select .*Needle Artifact/ }),
      ).toHaveCount(0);
      await expect(page.getByText("Store 1000", { exact: true })).toHaveCount(
        0,
      );
    } finally {
      cleanup(tag);
    }
  });
}
test("League library and complete rankings can be narrowed without altering snapshots", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(240000);
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  const tag = `browse-${randomUUID()}`;
  const password = randomUUID();
  try {
    const f = seed(tag, password);
    await login(page, tag, password);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/league/${f.league}/decks`);
    const paging = page.getByRole("navigation", {
      name: "League decks pagination",
    });
    await expect(paging).toContainText("1–25 of 36");
    await page.goto(`/league/${f.league}/decks?q=first&q=second`);
    await expect(paging).toContainText("1–25 of 36");
    await paging.getByRole("link", { name: "Next", exact: true }).click();
    await expect(paging).toContainText("26–36 of 36");
    await page
      .getByRole("combobox", { name: "Deck status", exact: true })
      .selectOption("frozen");
    await page
      .getByRole("button", { name: "Filter decks", exact: true })
      .click();
    await expect(paging).toContainText("1–1 of 1");
    await page.goto(`/decks/${f.frozen}`);
    await expect(
      page.getByRole("form", { name: "Filter deck cards" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open details", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("checkbox", { name: /Select .*Needle/ }),
    ).toHaveCount(0);
    const poolFilter = page.getByRole("combobox", {
      name: "Filter League pool status",
      exact: true,
    });
    await poolFilter.selectOption("pool-outside");
    await expect(
      page.getByRole("form", { name: "Filter deck cards" }),
    ).toContainText("Showing 3 of 3 deck entries");
    await page.goto(`/league/${f.league}/stats?view=usage`);
    const usage = page.getByRole("region", { name: "Card usage", exact: true });
    await usage.getByRole("searchbox").fill("Ranked 049");
    await expect(usage).toContainText("Ranked 049");
    await expect(usage).toContainText("1–1 of 1");
    await usage.screenshot({
      path: test.info().outputPath("league-rank-search.png"),
    });
    expect(
      db<number>(
        `return await p.commanderLeagueDeckSnapshotCard.count({where:{submission:{participant:{game:{leagueId:${q(f.league)}}}}}});`,
      ),
    ).toBe(100);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    cleanup(tag);
  }
});
