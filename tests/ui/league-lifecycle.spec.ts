import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeEach(({ baseURL }) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires local snapshot opt-in",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
});

const quote = JSON.stringify;
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Synthetic League fixture operation failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 60_000,
    }),
  );
}
async function login(page: Page, user: { username: string }, password: string) {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(user.username);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/);
}

type Member = {
  id: string;
  ownerId: string;
  username: string;
  displayName: string;
  locationId: string;
};
type Fixture = {
  users: Member[];
  privateLocationId: string;
  unlinkedLocationId: string;
};
type League = {
  id: string;
  rounds: { id: string; monthNumber: number }[];
  members: { id: string; userId: string }[];
};

test("League season, linked printings, member decks and recorded matches retain immutable snapshots", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const tag = `ui-league-${randomUUID()}`,
    password = randomUUID();
  const contexts = await Promise.all(
    [0, 1, 2, 3].map(() =>
      browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } }),
    ),
  );
  try {
    const f = database<Fixture>(`
      return p.$transaction(async tx=>{
        const tag=${quote(tag)}, passwordHash=await require('bcryptjs').hash(${quote(password)},10);
        const users=[];
        const forest=await tx.card.findFirstOrThrow({where:{name:'Forest'},orderBy:{id:'asc'}});
        const commander=await tx.card.findFirstOrThrow({where:{name:{startsWith:'Esika, God of the Tree'}},orderBy:{id:'asc'}});
        for(const suffix of ['Alice','Bob','Observer']) {
          const username=tag+'-'+suffix, displayName=suffix+' '+tag.slice(-8);
          const owner=await tx.player.create({data:{name:username,displayName}});
          const user=await tx.user.create({data:{username,displayName,passwordHash,playerId:owner.id}});
          const location=await tx.inventoryLocation.create({data:{ownerPlayerId:owner.id,name:'League cards',normalizedName:'league cards',visibility:'PUBLIC'}});
          users.push({id:user.id,ownerId:owner.id,username,displayName,locationId:location.id});
          if(suffix!=='Observer')for(const [card,quantity] of [[forest,99],[commander,1]])await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:owner.id,locationId:location.id,quantity,sourceType:'MANUAL',condition:'NM'}});
        }
        const privateLocation=await tx.inventoryLocation.create({data:{ownerPlayerId:users[0].ownerId,name:'Private excluded',normalizedName:'private excluded',visibility:'PRIVATE'}});
        const unlinked=await tx.inventoryLocation.create({data:{ownerPlayerId:users[0].ownerId,name:'Public unlinked',normalizedName:'public unlinked',visibility:'PUBLIC'}});
        for(const [name,locationId] of [['Sol Ring',privateLocation.id],['Arcane Signet',unlinked.id]]) {
          const card=await tx.card.findFirstOrThrow({where:{name},orderBy:{id:'asc'}});
          await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:users[0].ownerId,originalOpenerId:users[0].ownerId,locationId,quantity:1,sourceType:'MANUAL',condition:'NM'}});
        }
        return {users,privateLocationId:privateLocation.id,unlinkedLocationId:unlinked.id};
      });
    `);
    const [alice, bob, outsider, anonymous] = await Promise.all(
      contexts.map((c) => c.newPage()),
    );
    await login(alice, f.users[0], password);
    await login(bob, f.users[1], password);
    await login(outsider, f.users[2], password);

    await alice.goto("/league");
    const create = alice.locator("form").filter({
      has: alice.getByRole("button", {
        name: "Create Commander league",
        exact: true,
      }),
    });
    await create.getByLabel("League name", { exact: true }).fill(tag);
    await create.getByLabel("Year", { exact: true }).fill("2026");
    await create
      .locator(`input[name="locationId"][value="${f.users[0].locationId}"]`)
      .check();
    await expect(
      create.locator(`input[value="${f.privateLocationId}"]`),
    ).toHaveCount(0);
    await create
      .getByRole("button", { name: "Create Commander league", exact: true })
      .click();
    await alice.waitForURL(/\/league\/[^/?]+$/);
    const leagueId = new URL(alice.url()).pathname.split("/").at(-1)!;
    const leaguePath = `/league/${leagueId}`;
    const memberForm = alice
      .locator("form")
      .filter({ has: alice.locator('select[name="userId"]') });
    await memberForm
      .locator('select[name="userId"]')
      .selectOption(f.users[1].id);
    await memberForm.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      alice.locator('select[name="locationId"] option', {
        hasText: f.users[1].displayName,
      }),
    ).toHaveCount(1);
    const locationForm = alice
      .locator("form")
      .filter({ has: alice.locator('select[name="locationId"]') });
    await locationForm
      .locator('select[name="locationId"]')
      .selectOption(f.users[1].locationId);
    await locationForm
      .getByRole("button", { name: "Add", exact: true })
      .click();
    await expect(
      alice.getByText("League inventory", { exact: true }).locator(".."),
    ).toContainText("200");
    const league = database<League>(
      `return p.commanderLeague.findUniqueOrThrow({where:{id:${quote(leagueId)}},include:{rounds:true,members:true}});`,
    );
    expect(
      league.rounds.map((r) => r.monthNumber).sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(league.members).toHaveLength(2);
    const round = league.rounds.find((r) => r.monthNumber === 1)!;

    await bob.goto(leaguePath);
    await expect(
      bob.getByRole("heading", { name: "Record a completed game" }),
    ).toHaveCount(0);
    await expect(bob.locator('select[name="userId"]')).toHaveCount(0);
    expect((await outsider.goto(leaguePath))?.status()).toBe(404);
    expect(
      (
        await contexts[2].request.get(
          `/api/league/card-search?leagueId=${leagueId}&q=Forest`,
        )
      ).status(),
    ).toBe(403);
    for (const name of ["Forest", "Sol Ring", "Arcane Signet"]) {
      const search = await contexts[1].request.get(
        `/api/league/card-search?leagueId=${leagueId}&q=${encodeURIComponent(name)}`,
      );
      expect(search.status()).toBe(200);
      const result = await search.json();
      expect(result.results.length > 0).toBe(name === "Forest");
    }

    const deckIds: string[] = [];
    for (const [index, page] of [alice, bob].entries()) {
      await page.goto(`${leaguePath}/decks`);
      const form = page.locator("form").filter({
        has: page.getByRole("button", {
          name: "Create league deck",
          exact: true,
        }),
      });
      if (index === 1)
        await expect(
          form.locator('select[name="memberId"] option'),
        ).toHaveCount(1);
      await form.getByLabel("Submission month").selectOption(round.id);
      await form
        .getByLabel("Deck name", { exact: true })
        .fill(`${f.users[index].displayName} January`);
      await form
        .getByRole("button", { name: "Create league deck", exact: true })
        .click();
      await page.waitForURL((url) => /^\/decks\/[^/]+$/.test(url.pathname));
      const deckId = new URL(page.url()).pathname.split("/").at(-1)!;
      deckIds.push(deckId);
      await expect(
        page.getByText("Public Commander League deck", { exact: true }),
      ).toBeVisible();
      await page.goto(`/decks/${deckId}/import`);
      await page
        .getByLabel("Decklist text", { exact: true })
        .fill("99 Forest\n1 Esika, God of the Tree");
      await page.getByLabel("Bulk resolve").selectOption("owned-only");
      await page.getByRole("button", { name: "Parse and review" }).click();
      const commit = page.getByRole("button", {
        name: "Import 100 deck-list copies",
        exact: true,
      });
      await expect(commit).toBeEnabled({ timeout: 30_000 });
      await page
        .getByLabel("Assign a commander", { exact: true })
        .selectOption({ label: "Esika, God of the Tree" });
      await commit.click();
      await page.waitForURL(`**/decks/${deckId}`);
    }
    expect((await anonymous.goto(`/decks/${deckIds[0]}`))?.status()).toBe(200);
    expect(
      (await anonymous.goto(`/decks/${deckIds[0]}/import`))?.status(),
    ).toBe(404);
    expect(
      (
        await contexts[1].request.post(`/api/decks/${deckIds[0]}/bulk-remove`, {
          data: { rowIds: [] },
        })
      ).status(),
    ).toBe(403);

    await alice.goto(leaguePath);
    const game = alice.locator("form").filter({
      has: alice.getByRole("button", {
        name: "Record game and freeze decks",
        exact: true,
      }),
    });
    for (const malformedCount of ["not-a-number", "2.5"]) {
      await game.getByLabel("Monthly round").selectOption(round.id);
      await game.getByLabel("Played on").fill("2026-01-15");
      await game
        .locator('input[name="participantCount"]')
        .evaluate((node: HTMLInputElement, value) => {
          node.value = value;
        }, malformedCount);
      await Promise.all([
        alice.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === leaguePath,
        ),
        game
          .getByRole("button", {
            name: "Record game and freeze decks",
            exact: true,
          })
          .click(),
      ]);
      expect(
        database<number>(
          `return p.commanderLeagueGame.count({where:{leagueId:${quote(leagueId)}}});`,
        ),
      ).toBe(0);
      await expect(
        alice.getByText("A Commander game needs between 2 and 8 players.", {
          exact: true,
        }),
      ).toBeVisible();
      await alice.goto(leaguePath);
    }
    await game.getByLabel("Monthly round").selectOption(round.id);
    await game.getByLabel("Played on").fill("2026-01-15");
    // Duplicate participants must be rejected without creating any game.
    const aliceMember = league.members.find((m) => m.userId === f.users[0].id)!;
    const bobMember = league.members.find((m) => m.userId === f.users[1].id)!;
    await game
      .locator('select[name="memberId_1"]')
      .selectOption(aliceMember.id);
    await game
      .getByRole("button", {
        name: "Record game and freeze decks",
        exact: true,
      })
      .click();
    await expect(
      alice.getByText("Each game participant must be unique.", { exact: true }),
    ).toBeVisible();
    expect(
      database<number>(
        `return p.commanderLeagueGame.count({where:{leagueId:${quote(leagueId)}}});`,
      ),
    ).toBe(0);
    await game.getByLabel("Monthly round").selectOption(round.id);
    await game.getByLabel("Played on").fill("2026-01-15");
    await game
      .locator('select[name="memberId_0"]')
      .selectOption(aliceMember.id);
    await game.locator('select[name="memberId_1"]').selectOption(bobMember.id);
    await game.getByRole("button", { name: "Reset elimination order" }).click();
    await game
      .getByRole("button", {
        name: "Record game and freeze decks",
        exact: true,
      })
      .click();
    await expect
      .poll(() =>
        database<number>(
          `return p.commanderLeagueGame.count({where:{leagueId:${quote(leagueId)}}});`,
        ),
      )
      .toBe(1);
    await expect(
      alice.getByText("Each game participant must be unique.", { exact: true }),
    ).toHaveCount(0);
    await alice.reload();
    await game.getByLabel("Monthly round").selectOption(round.id);
    await game.getByLabel("Played on").fill("2026-01-16");
    await game.getByRole("button", { name: "Mark game drawn" }).click();
    await game
      .getByRole("button", {
        name: "Record game and freeze decks",
        exact: true,
      })
      .click();
    await expect
      .poll(() =>
        database<number>(
          `return p.commanderLeagueGame.count({where:{leagueId:${quote(leagueId)}}});`,
        ),
      )
      .toBe(2);
    await alice.reload();
    const standings = alice.locator("table").first();
    await expect(
      standings
        .getByRole("row")
        .filter({ hasText: f.users[0].displayName })
        .getByRole("cell")
        .last(),
    ).toHaveText("4");
    await expect(
      standings
        .getByRole("row")
        .filter({ hasText: f.users[1].displayName })
        .getByRole("cell")
        .last(),
    ).toHaveText("1");

    const snapshot = () =>
      database<{
        submissions: {
          deckName: string;
          cards: { quantity: number; isCommander: boolean }[];
        }[];
        copies: number;
        commitments: number;
      }>(`
      return {submissions:await p.commanderLeagueDeckSubmission.findMany({where:{participant:{game:{leagueId:${quote(leagueId)}}}},include:{cards:true},orderBy:{id:'asc'}}),
      copies:(await p.inventoryItem.aggregate({where:{currentOwnerId:{in:${quote(f.users.map((u) => u.ownerId))}}},_sum:{quantity:true}}))._sum.quantity,
      commitments:await p.inventoryItem.count({where:{currentOwnerId:{in:${quote(f.users.map((u) => u.ownerId))}},location:{kind:'DECK'}}})};
    `);
    const before = snapshot();
    expect(before.submissions).toHaveLength(4);
    expect(before.copies).toBe(202);
    expect(before.commitments).toBe(0);
    for (const submission of before.submissions) {
      expect(submission.cards.reduce((sum, c) => sum + c.quantity, 0)).toBe(
        100,
      );
      expect(submission.cards.filter((c) => c.isCommander)).toHaveLength(1);
    }
    for (const [index, page] of [alice, bob].entries()) {
      await page.goto(`/decks/${deckIds[index]}`);
      await expect(
        page.getByText(
          "Locked permanently because this list was submitted for a recorded match.",
          { exact: true },
        ),
      ).toBeVisible();
      expect(
        (await page.goto(`/decks/${deckIds[index]}/import`))?.status(),
      ).toBe(404);
      const rows = database<string[]>(
        `return (await p.deckCard.findMany({where:{deckId:${quote(deckIds[index])}},select:{id:true}})).map(r=>r.id);`,
      );
      expect(
        (
          await contexts[index].request.post(
            `/api/decks/${deckIds[index]}/bulk-remove`,
            { data: { rowIds: rows } },
          )
        ).status(),
      ).toBe(409);
    }
    expect(snapshot()).toEqual(before);
    await bob.goto(`${leaguePath}/stats`);
    await expect(bob.getByRole("heading", { level: 1 })).toContainText(
      /stats|statistics|analytics/i,
    );
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close()));
    database(`
      const users=await p.user.findMany({where:{username:{startsWith:${quote(tag + "-")}}},select:{id:true,playerId:true}});
      const ids=users.map(u=>u.id),owners=users.map(u=>u.playerId).filter(Boolean);
      await p.$transaction(async tx=>{
        const leagues=await tx.commanderLeague.findMany({where:{createdByUserId:{in:ids}},select:{id:true}});const leagueIds=leagues.map(l=>l.id);
        await tx.commanderLeagueGame.deleteMany({where:{leagueId:{in:leagueIds}}});
        await tx.commanderLeagueDeck.deleteMany({where:{leagueId:{in:leagueIds}}});
        await tx.commanderLeague.deleteMany({where:{id:{in:leagueIds}}});
        await tx.deck.deleteMany({where:{ownerUserId:{in:ids}}});
        await tx.inventoryAuditLog.deleteMany({where:{changedByUserId:{in:ids}}});
        await tx.inventoryItem.deleteMany({where:{currentOwnerId:{in:owners}}});
        await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});
        await tx.user.deleteMany({where:{id:{in:ids}}});await tx.player.deleteMany({where:{id:{in:owners}}});
      });return true;
    `);
  }
});
