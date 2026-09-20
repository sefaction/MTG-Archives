import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 60_000,
    }),
  );
}

type Person = {
  id: string;
  playerId: string;
  username: string;
  displayName: string;
  destinationId: string;
};
type Fixture = {
  people: Person[];
  cards: { id: string; name: string }[];
  items: { id: string; quantity: number }[];
  residentId: string;
};
const quote = JSON.stringify;

async function login(page: Page, person: Person, password: string) {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(person.username);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/);
}

async function openTrade(page: Page, id: string) {
  await page.goto("/trades?view=active");
  // The waiting-for-partner group is collapsed even on the Active view.
  const groups = page
    .locator("details")
    .filter({
      has: page.locator(`input[name="tradeId"][value="${id}"]`),
    })
    .filter({ has: page.locator(":scope > summary h2") });
  for (const group of await groups.all()) {
    if (!(await group.evaluate((node) => (node as HTMLDetailsElement).open)))
      await group.locator(":scope > summary").click();
  }
  const detail = page
    .locator("details")
    .filter({ has: page.locator(`input[name="tradeId"][value="${id}"]`) })
    .filter({ has: page.locator(":scope > summary h3") })
    .last();
  await expect(detail).toHaveCount(1);
  if (!(await detail.evaluate((node) => (node as HTMLDetailsElement).open)))
    await detail.locator(":scope > summary").click();
  return detail;
}

function state(id: string) {
  return database<{
    status: string;
    proposerCommittedAt: string | null;
    receiverCommittedAt: string | null;
  }>(`return p.trade.findUniqueOrThrow({where:{id:${quote(id)}}});`);
}

test("two people negotiate, confirm and conserve exact inventory; cancel and decline release reservations", async ({
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot opt-in",
  );
  test.setTimeout(180_000);
  test.info().annotations.push({
    type: "scope",
    description: "Local synthetic accounts only; no real outbound endpoints",
  });
  expect(baseURL).toBe("http://127.0.0.1:13001");
  // Completed trades can notify global endpoints. Never run this fixture with any enabled.
  expect(
    database<number>(
      "return p.tradeAnnouncementWebhookEndpoint.count({where:{enabled:true}});",
    ),
    "Disable real trade announcement endpoints in the local review snapshot first",
  ).toBe(0);
  const tag = `ui-trade-${randomUUID()}`;
  const password = randomUUID();
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ baseURL })),
  );
  let fixture: Fixture | undefined;
  try {
    fixture = database<Fixture>(`
      const tag=${quote(tag)}, hash=await require('bcryptjs').hash(${quote(password)},10);
      return p.$transaction(async tx=>{
        const people=[];
        for(const suffix of ['Alice','Bob','Observer']) {
          const player=await tx.player.create({data:{name:tag+'-'+suffix,displayName:tag+'-'+suffix}});
          const user=await tx.user.create({data:{username:tag+'-'+suffix,displayName:suffix,passwordHash:hash,playerId:player.id,inventoryDefaultVisibility:'PUBLIC'}});
          const location=await tx.inventoryLocation.create({data:{ownerPlayerId:player.id,name:'Incoming',normalizedName:'incoming'}});
          people.push({id:user.id,playerId:player.id,username:user.username,displayName:player.displayName,destinationId:location.id});
        }
        const cards=[];
        for(const suffix of ['Amber','Birch','Cedar']) cards.push(await tx.card.create({data:{scryfallId:tag+'-'+suffix,name:tag+' '+suffix,typeLine:'Artifact',setCode:'tst',collectorNumber:suffix,rarity:'common'}}));
        const items=[];
        for(let i=0;i<3;i++) {
          const owner=people[i===1?1:0];
          items.push(await tx.inventoryItem.create({data:{cardId:cards[i].id,currentOwnerId:owner.playerId,originalOpenerId:owner.playerId,quantity:i===2?1:4,condition:'NM',foil:i===0,foilStatus:i===0?'FOIL':'NONFOIL',language:i===0?'JA':'EN',notes:'Incoming provenance '+i}}));
        }
        const resident=await tx.inventoryItem.create({data:{cardId:cards[0].id,currentOwnerId:people[1].playerId,originalOpenerId:people[1].playerId,quantity:7,condition:'NM',foil:true,foilStatus:'FOIL',language:'JA',locationId:people[1].destinationId,notes:'Existing copies must stay separate'}});
        await tx.tradeWishlistItem.create({data:{ownerUserId:people[0].id,targetOwnerPlayerId:people[1].playerId,cardId:cards[1].id,quantity:3}});
        await tx.tradeWishlistItem.create({data:{ownerUserId:people[1].id,targetOwnerPlayerId:people[0].playerId,cardId:cards[0].id,quantity:2}});
        return {people,cards,items,residentId:resident.id};
      });
    `);
    const f = fixture;
    const [alice, bob, observer] = await Promise.all(
      contexts.map((c) => c.newPage()),
    );
    for (const page of [alice, bob, observer]) page.setDefaultTimeout(10_000);
    await login(alice, f.people[0], password);
    await login(bob, f.people[1], password);
    await login(observer, f.people[2], password);
    const total = () =>
      database<number>(
        `return (await p.inventoryItem.aggregate({where:{cardId:{in:${quote(f.cards.map((c) => c.id))}}},_sum:{quantity:true}}))._sum.quantity;`,
      );
    expect(total()).toBe(16);

    async function propose(message: string) {
      await alice.goto(
        `/trades?receiverId=${f.people[1].playerId}&offeredInventoryItemId=${f.items[0].id}&requestedInventoryItemId=${f.items[1].id}`,
      );
      await alice.getByText("Add message or notes", { exact: true }).click();
      await alice.getByLabel("Message / notes").fill(message);
      await alice
        .getByRole("button", { name: "Submit Proposal", exact: true })
        .click();
      await expect(
        alice.getByText("Trade proposal sent.", { exact: true }),
      ).toBeVisible();
      return database<string>(
        `return (await p.trade.findFirstOrThrow({where:{createdByUserId:${quote(f.people[0].id)},message:${quote(message)}}})).id;`,
      );
    }
    async function available(page: Page, owner: number, item: number) {
      const response = await page.request.get(
        `/api/trades/inventory-search?ownerId=${f.people[owner].playerId}&q=${encodeURIComponent(tag)}`,
      );
      expect(response.ok()).toBe(true);
      const result = await response.json();
      return result.items.find(
        (row: { id: string }) => row.id === f.items[item].id,
      )?.available;
    }
    const cancelled = await propose("Cancel fixture");
    expect(await available(alice, 0, 0)).toBe(3);
    await alice.getByLabel("Qty", { exact: true }).nth(0).fill("4");
    await alice
      .getByRole("button", { name: "Submit Proposal", exact: true })
      .click();
    await expect(alice.getByRole("alert")).toHaveText(
      /already reserved or unavailable/,
    );
    expect(
      database<number>(
        `return p.trade.count({where:{createdByUserId:${quote(f.people[0].id)}}});`,
      ),
    ).toBe(1);
    await (
      await openTrade(alice, cancelled)
    )
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect.poll(() => state(cancelled).status).toBe("CANCELLED");
    expect(await available(alice, 0, 0)).toBe(4);

    const declined = await propose("Decline fixture");
    const declinePanel = await openTrade(bob, declined);
    await expect(
      declinePanel.getByRole("button", { name: "Cancel", exact: true }),
    ).toHaveCount(0);
    await declinePanel
      .locator("summary")
      .filter({ hasText: /^Decline$/ })
      .click();
    await declinePanel
      .getByLabel("Decline note (optional)")
      .fill("Different cards, please.");
    await declinePanel
      .getByRole("button", { name: "Decline trade", exact: true })
      .click();
    await expect.poll(() => state(declined).status).toBe("DECLINED");
    expect(await available(bob, 0, 0)).toBe(4);

    const original = await propose("Counter fixture");
    const originalPanel = await openTrade(bob, original);
    await originalPanel
      .getByRole("link", { name: "Counter From This" })
      .click();
    await expect(bob.locator('input[name="counterTradeId"]')).toHaveValue(
      original,
    );
    // Real user controls, not direct action calls or handcrafted draft payloads.
    await bob.getByLabel("Qty", { exact: true }).nth(0).fill("2");
    await bob.getByLabel("Qty", { exact: true }).nth(1).fill("2");
    const search = bob
      .locator("details")
      .filter({
        has: bob.getByRole("heading", {
          name: `Search ${f.people[0].displayName}'s inventory`,
          exact: true,
        }),
      })
      .last();
    await search.locator(":scope > summary").click();
    await search
      .getByLabel("Search cards", { exact: true })
      .fill(f.cards[2].name);
    await search.getByRole("button", { name: new RegExp("Cedar") }).click();
    await bob
      .getByRole("button", { name: "Submit Proposal", exact: true })
      .click();
    await expect(
      bob.getByText("Trade proposal sent.", { exact: true }),
    ).toBeVisible();
    expect(state(original).status).toBe("DECLINED");
    const counter = database<string>(
      `return (await p.trade.findFirstOrThrow({where:{createdByUserId:${quote(f.people[1].id)},status:'PROPOSED'}})).id;`,
    );
    expect(await available(alice, 0, 0)).toBe(2);
    expect(await available(alice, 0, 2)).toBe(0);
    await observer.goto("/trades?view=active");
    await expect(
      observer.locator(`input[name="tradeId"][value="${counter}"]`),
    ).toHaveCount(0);
    await expect(
      (await openTrade(bob, counter)).getByRole("button", {
        name: "Accept",
        exact: true,
      }),
    ).toHaveCount(0);
    await (
      await openTrade(alice, counter)
    )
      .getByRole("button", { name: "Accept", exact: true })
      .click();
    await expect
      .poll(() => state(counter).status)
      .toBe("ACCEPTED_PENDING_EXCHANGE");
    expect(total()).toBe(16);
    const aliceConfirm = await openTrade(alice, counter);
    await aliceConfirm
      .getByRole("combobox")
      .selectOption(f.people[0].destinationId);
    await aliceConfirm
      .getByRole("button", { name: "Confirm Physical Trade" })
      .click();
    await expect.poll(() => state(counter).status).toBe("PARTIALLY_COMMITTED");
    expect(total()).toBe(16);
    expect(
      database<number>(
        `return p.inventoryItem.count({where:{cardId:${quote(f.cards[1].id)},currentOwnerId:${quote(f.people[0].playerId)}}});`,
      ),
    ).toBe(0);
    const bobConfirm = await openTrade(bob, counter);
    await bobConfirm
      .getByRole("combobox")
      .selectOption(f.people[1].destinationId);
    await bobConfirm
      .getByRole("button", { name: "Confirm Physical Trade" })
      .click();
    await expect.poll(() => state(counter).status).toBe("COMPLETED");
    expect(total()).toBe(16);
    const rows = database<any[]>(
      `return p.inventoryItem.findMany({where:{cardId:{in:${quote(f.cards.map((c) => c.id))}}}});`,
    );
    for (const [index, copies] of [11, 4, 1].entries()) {
      expect(
        rows
          .filter((r) => r.cardId === f.cards[index].id)
          .reduce((sum, r) => sum + r.quantity, 0),
      ).toBe(copies);
    }
    expect(rows.find((r) => r.id === f.items[0].id)?.quantity).toBe(2);
    expect(rows.find((r) => r.id === f.items[1].id)?.quantity).toBe(2);
    expect(rows.find((r) => r.id === f.items[2].id)).toBeUndefined();
    const wishes = database<any[]>(
      `return p.tradeWishlistItem.findMany({where:{ownerUserId:{in:${quote(f.people.map((p) => p.id))}}}});`,
    );
    expect(wishes.find((w) => w.ownerUserId === f.people[0].id)).toMatchObject({
      status: "OPEN",
      quantity: 1,
    });
    expect(wishes.find((w) => w.ownerUserId === f.people[1].id)?.status).toBe(
      "FULFILLED",
    );
    // Regression #249: preserve per-stack notes, opener and finish/language.
    expect(rows.find((r) => r.id === f.residentId)).toMatchObject({
      quantity: 7,
      notes: "Existing copies must stay separate",
      sourceType: "PULL",
    });
    expect(
      rows.find(
        (r) =>
          r.currentOwnerId === f.people[1].playerId &&
          r.notes === "Incoming provenance 0",
      ),
    ).toMatchObject({
      quantity: 2,
      originalOpenerId: f.people[0].playerId,
      foil: true,
      foilStatus: "FOIL",
      language: "JA",
      sourceType: "TRADE",
      locationId: f.people[1].destinationId,
    });
    expect(
      rows.find(
        (r) =>
          r.currentOwnerId === f.people[1].playerId &&
          r.cardId === f.cards[2].id,
      ),
    ).toMatchObject({
      originalOpenerId: f.people[0].playerId,
      quantity: 1,
      notes: "Incoming provenance 2",
    });
    expect(
      database<number>(
        `return p.tradeEvent.count({where:{tradeId:${quote(counter)},eventType:'completed'}});`,
      ),
    ).toBe(1);
    await alice.goto("/trades?view=history");
    await expect(alice.getByText("completed", { exact: true })).toBeVisible();
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close()));
    // Resolve exact fixture identities by a unique UUID tag, even if setup failed.
    database(`const users=await p.user.findMany({where:{username:{startsWith:${quote(tag)}}}});const ids=users.map(u=>u.id),owners=users.map(u=>u.playerId);await p.$transaction(async tx=>{
      const trades=await tx.trade.findMany({where:{createdByUserId:{in:ids}},select:{id:true}});const tradeIds=trades.map(t=>t.id);
      await tx.notificationDeliveryJob.deleteMany({where:{sourceType:'trade.completed',sourceId:{in:tradeIds}}});
      await tx.inventoryAuditLog.deleteMany({where:{OR:[{changedByUserId:{in:ids}},{tradeId:{in:tradeIds}}]}});
      await tx.tradeEvent.deleteMany({where:{tradeId:{in:tradeIds}}});await tx.trade.deleteMany({where:{id:{in:tradeIds}}});
      await tx.tradeWishlistItem.deleteMany({where:{ownerUserId:{in:ids}}});
      await tx.inventoryItem.deleteMany({where:{currentOwnerId:{in:owners}}});
      await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});
      await tx.user.deleteMany({where:{id:{in:ids}}});await tx.player.deleteMany({where:{id:{in:owners}}});
      await tx.card.deleteMany({where:{scryfallId:{startsWith:${quote(tag)}}}});
    });return true;`);
  }
});
