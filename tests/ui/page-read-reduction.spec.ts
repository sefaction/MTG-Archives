import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.skip(
  process.env.MTG_LOCAL_PILOT_TEST !== "1",
  "Owned local review runtime only",
);
test.use({ actionTimeout: 15000 });
const target = process.env.MTG_UI_WEB_CONTAINER || "mtg-archives-web-1";
const q = JSON.stringify,
  tag = `reads-${randomUUID()}`;
function db<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", target, "node"], {
      input: `require('tsx/cjs');const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30000,
    }),
  );
}
type Fixture = {
  users: { id: string; playerId: string; name: string; token: string }[];
  counter: string;
  tradeIds: string[];
  stock: string;
  unrelated: string;
};
let f: Fixture;
test.beforeAll(() => {
  f =
    db(`const users=[];for(const suffix of ['A','B','C']){const player=await p.player.create({data:{name:${q(tag)}+suffix,displayName:${q(tag)}+suffix}});const user=await p.user.create({data:{username:${q(tag)}+suffix,displayName:${q(tag)}+suffix,playerId:player.id,passwordHash:'test-only',role:suffix==='C'?'ADMIN':'PLAYER'}});users.push({id:user.id,playerId:player.id,name:user.displayName,token:await require('/app/lib/auth-sessions.ts').createStoredSession(p,user)});}
 const card=await p.card.create({data:{name:${q(tag)}+' card',scryfallId:require('crypto').randomUUID(),setCode:'tst',collectorNumber:'1',rarity:'common',typeLine:'Artifact'}});
 const stock=await p.inventoryItem.create({data:{currentOwnerId:users[0].playerId,originalOpenerId:users[0].playerId,cardId:card.id,quantity:7,condition:'NM',sourceType:'MANUAL'}});
 const partnerStock=await p.inventoryItem.create({data:{currentOwnerId:users[1].playerId,originalOpenerId:users[1].playerId,cardId:card.id,quantity:5,condition:'NM',sourceType:'MANUAL'}});
 const tradeIds=[];for(let i=0;i<120;i++){const trade=await p.trade.create({data:{id:${q(tag)}+'-'+String(i).padStart(3,'0'),proposerPlayerId:users[0].playerId,receiverPlayerId:users[1].playerId,status:['COMPLETED','DECLINED','CANCELLED','CANCELED'][i%4],message:${q(tag)}+' history '+i,proposedAt:new Date('2026-01-01T12:00:00Z'),offeredSnapshotJson:{cardName:'Historic fixture'},requestedSnapshotJson:{cardName:'Historic fixture'}}});tradeIds.push(trade.id);}
 const counter=await p.trade.create({data:{proposerPlayerId:users[1].playerId,receiverPlayerId:users[0].playerId,status:'PROPOSED',lines:{create:[{side:'PROPOSER',inventoryItemId:partnerStock.id,quantity:2,snapshotJson:{cardName:card.name}},{side:'RECEIVER',inventoryItemId:stock.id,quantity:1,snapshotJson:{cardName:card.name}}]}}});
 const unrelated=await p.trade.create({data:{proposerPlayerId:users[1].playerId,receiverPlayerId:users[2].playerId,status:'COMPLETED',message:${q(tag)}+' unrelated',offeredSnapshotJson:{cardName:'Private unrelated fixture'},requestedSnapshotJson:{cardName:'Private unrelated fixture'}}});
 await p.notification.createMany({data:users.flatMap((u,i)=>Array.from({length:i+1},()=>({recipientUserId:u.id,type:'fixture',category:'system',title:'Read fixture'})))});
 return {users,counter:counter.id,tradeIds,stock:stock.id,unrelated:unrelated.id};`);
});
test.afterAll(() => {
  if (!f) return;
  db(
    `const ids=${q(f.users.map((u) => u.playerId))},users=${q(f.users.map((u) => u.id))};await p.trade.deleteMany({where:{OR:[{proposerPlayerId:{in:ids}},{receiverPlayerId:{in:ids}}]}});await p.inventoryItem.deleteMany({where:{currentOwnerId:{in:ids}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids}}});await p.notification.deleteMany({where:{recipientUserId:{in:users}}});await p.authSession.deleteMany({where:{userId:{in:users}}});await p.user.deleteMany({where:{id:{in:users}}});await p.player.deleteMany({where:{id:{in:ids}}});await p.card.deleteMany({where:{name:${q(tag)}+' card'}});return true;`,
  );
});

for (const width of [1366, 390, 320])
  test(`history pages and filters preserve authorized results at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120000);
    expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
    await page.context().addCookies([
      {
        name: "mtg_inventory_session",
        value: f.users[0].token,
        url: baseURL!,
      },
    ]);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/trades?view=history&historyQ=${encodeURIComponent(tag)}`);
    const paging = page.getByRole("navigation", {
      name: "Trade history pagination",
    });
    await expect(paging).toContainText("1–25 of 120");
    await expect(page.locator("details[data-trade-id]")).toHaveCount(25);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (width === 1366) {
      const seen = new Set<string>();
      for (let n = 1; n <= 5; n++) {
        for (const id of await page
          .locator("details[data-trade-id]")
          .evaluateAll((nodes) =>
            nodes.map((x) => x.getAttribute("data-trade-id")!),
          )) {
          expect(seen.has(id)).toBe(false);
          seen.add(id);
        }
        if (n < 5) {
          await paging.getByRole("link", { name: "Next", exact: true }).click();
          await expect(paging).toContainText(`Page ${n + 1} of 5`);
        }
      }
      expect([...seen].sort()).toEqual([...f.tradeIds].sort());
    }
    await page
      .getByRole("combobox", { name: "History status", exact: true })
      .selectOption("COMPLETED");
    await page
      .getByRole("button", { name: "Filter history", exact: true })
      .click();
    await expect(paging).toContainText("1–25 of 30");
    await expect(page).not.toHaveURL(/[?&]page=/);
    const search = page.getByRole("searchbox", {
      name: "Search trade history",
      exact: true,
    });
    await search.fill("not-present");
    await search.press("Enter");
    await expect(paging).toContainText("0–0 of 0");
    await expect(
      page.getByText(
        "No matching trade history. Clear the filters to show more.",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Clear filters", exact: true })
      .click();
    await expect(paging).toContainText("1–25 of 120");
    await page.screenshot({
      path: test.info().outputPath("trade-history.png"),
      fullPage: true,
    });
    if (width === 1366) {
      await page.goto("/trades?view=history&historyQ=first&historyQ=second");
      await expect(paging).toContainText("1–25 of 120");
    }
    await page.goto(
      `/trades?receiverId=${f.users[1].playerId}&counterTradeId=${f.counter}`,
    );
    await expect(page.locator('input[name="counterTradeId"]')).toHaveValue(
      f.counter,
    );
    const offered = JSON.parse(
      await page.locator('input[name="offeredLinesJson"]').inputValue(),
    );
    const requested = JSON.parse(
      await page.locator('input[name="requestedLinesJson"]').inputValue(),
    );
    expect(offered).toEqual([{ inventoryItemId: f.stock, quantity: 1 }]);
    expect(requested[0].quantity).toBe(2);
    expect(
      db<number>(
        `return await p.inventoryItem.findUniqueOrThrow({where:{id:${q(f.stock)}}}).then(x=>x.quantity);`,
      ),
    ).toBe(7);
    await page.goto(`/inventory?cardName=${encodeURIComponent(tag)}`);
    await expect(page.locator(".inventory-result-summary")).toContainText("7");
    const api = await page.request.get(
      `/api/inventory/list?cardName=${encodeURIComponent(tag)}`,
    );
    expect(api.ok()).toBe(true);
    const payload = await api.json();
    expect(payload.totalMatchingCount).toBe(1);
    expect(payload.rows[0].quantity).toBe(7);
  });
test("render snapshots remain isolated by user and expire after revocation", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(60000);
  const contexts = [];
  try {
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      await context.addCookies([
        {
          name: "mtg_inventory_session",
          value: f.users[i].token,
          url: baseURL!,
        },
      ]);
      if (i === 2)
        await context.addCookies([
          { name: "mtg_admin_mode", value: "1", url: baseURL! },
        ]);
    }
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    await Promise.all(pages.map((p) => p.goto("/decks")));
    for (let i = 0; i < 3; i++) {
      await expect(
        pages[i].getByLabel(f.users[i].name + " account options", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(pages[i]).toHaveTitle(
        new RegExp("^\\(" + String(i + 1) + "\\)"),
      );
    }
    await pages[2].goto(
      `/trades?view=history&historyQ=${encodeURIComponent(tag)}`,
    );
    await expect(
      pages[2].getByRole("navigation", { name: "Trade history pagination" }),
    ).toContainText("1–25 of 121");
    await expect(
      pages[2].locator(`[data-trade-id="${f.unrelated}"]`),
    ).toHaveCount(1);
    db(
      `await p.authSession.deleteMany({where:{userId:${q(f.users[0].id)}}});return true;`,
    );
    await pages[0].goto("/decks");
    await expect(pages[0]).toHaveURL(/\/login/);
    await expect(pages[0]).not.toHaveTitle(/^\(1\)/);
    await pages[0].goto("/public/decks");
    await expect(
      pages[0].getByLabel(f.users[0].name + " account options", {
        exact: true,
      }),
    ).toHaveCount(0);
    await pages[1].reload();
    await expect(
      pages[1].getByLabel(f.users[1].name + " account options", {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
