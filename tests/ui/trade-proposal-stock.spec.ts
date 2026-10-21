import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page, type Route } from "@playwright/test";
import { loadIsolatedQualificationTarget, type IsolatedQualificationTarget } from "./isolated-qualification-target";

let target: IsolatedQualificationTarget | undefined;
function database<T>(body: string): T {
  return JSON.parse(execFileSync("docker", ["exec", "-i", target?.web.id ?? "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 60000,
  }));
}
const q = JSON.stringify;
async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test("two real sessions propose the last copy and only the committed proposal notifies its recipient", async ({ browser, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires disposable local snapshot opt-in");
  target = loadIsolatedQualificationTarget();
  expect(baseURL).toBe(target?.baseURL ?? "http://127.0.0.1:13001");
  expect(database<number>("return p.tradeAnnouncementWebhookEndpoint.count({where:{enabled:true}});")).toBe(0);
  const tag = `ui-proposal-stock-${randomUUID()}`, password = randomUUID();
  const contexts = await Promise.all([1366, 320, 1366].map(width => browser.newContext({ baseURL, viewport: { width, height: 844 } })));
  let release!: () => void, timer: ReturnType<typeof setTimeout> | undefined;
  const submissionGate = new Promise<void>(resolve => { release = resolve; });
  const arrivals = new Set<number>();
  let gateTimedOut = false;
  let failure: unknown;
  try {
    const f = database<{ people: { id: string; playerId: string; username: string }[]; item: { id: string }; cardId: string }>(`
      const tag=${q(tag)},hash=await require('bcryptjs').hash(${q(password)},10);
      return p.$transaction(async tx=>{
        const people=[];
        for(const suffix of ['Proposer','Recipient']) {
          const player=await tx.player.create({data:{name:tag+'-'+suffix,displayName:tag+'-'+suffix}});
          const user=await tx.user.create({data:{username:tag+'-'+suffix,displayName:suffix,passwordHash:hash,playerId:player.id,inventoryDefaultVisibility:'PUBLIC'}});
          people.push({id:user.id,playerId:player.id,username:user.username});
        }
        const card=await tx.card.create({data:{scryfallId:tag,name:'Last physical copy '+tag,typeLine:'Artifact',setCode:'tst',collectorNumber:'1',rarity:'common'}});
        const item=await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:people[0].playerId,originalOpenerId:people[0].playerId,quantity:1,condition:'NM',foilStatus:'NONFOIL',language:'EN',sourceType:'MANUAL',notes:'Owned concurrent proposal fixture'}});
        return {people,item,cardId:card.id};
      });
    `);
    const before = database(`return p.inventoryItem.findUniqueOrThrow({where:{id:${q(f.item.id)}}});`);
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of pages) page.setDefaultTimeout(10000);
    await login(pages[0], f.people[0].username, password);
    await login(pages[1], f.people[0].username, password);
    await login(pages[2], f.people[1].username, password);
    for (const [index, page] of pages.slice(0, 2).entries()) {
      await page.goto(`/trades?receiverId=${f.people[1].playerId}&offeredInventoryItemId=${f.item.id}`);
      await expect(page.getByRole("button", { name: "Submit Proposal", exact: true })).toBeEnabled();
      await page.getByText("Add message or notes", { exact: true }).click();
      await page.getByLabel("Message / notes").fill(`${tag}-${index}`);
      await page.route("**/trades*", async (route: Route) => {
        const request = route.request();
        if (request.method() === "POST" && request.headers()["next-action"] && !arrivals.has(index)) {
          arrivals.add(index);
          if (arrivals.size === 1) timer = setTimeout(() => { gateTimedOut = true; release(); }, 5000);
          if (arrivals.size === 2) { clearTimeout(timer); release(); }
          await submissionGate;
        }
        await route.continue();
      });
    }
    // Both unchanged browser requests reach the network before either is sent.
    // Backend overlap is separately established by the actual PostgreSQL gate.
    await Promise.all(pages.slice(0, 2).map(page => page.getByRole("button", { name: "Submit Proposal", exact: true }).click()));
    await expect.poll(() => arrivals.size, { timeout: 5000 }).toBe(2);
    expect(gateTimedOut).toBe(false);
    await expect.poll(async () => {
      const states = await Promise.all(pages.slice(0, 2).map(async page => ({
        success: await page.getByText("Trade proposal sent.", { exact: true }).isVisible(),
        error: await page.getByRole("alert").filter({ hasText: /already reserved or unavailable/ }).isVisible(),
      })));
      return { success: states.filter(state => state.success).length, error: states.filter(state => state.error).length };
    }).toEqual({ success: 1, error: 1 });
    for (const [index, page] of pages.slice(0, 2).entries()) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(index === 0 ? "proposal-desktop.png" : "proposal-phone.png"), fullPage: true });
    }
    const saved = database<{ trades: { id: string; lines: { inventoryItemId: string; quantity: number }[] }[]; notices: number; events: number; audits: number }>(`
      const trades=await p.trade.findMany({where:{createdByUserId:${q(f.people[0].id)}},include:{lines:true}});
      return {trades,notices:await p.notification.count({where:{recipientUserId:${q(f.people[1].id)},type:'trade.proposed'}}),events:await p.tradeEvent.count({where:{tradeId:{in:trades.map(t=>t.id)},eventType:'proposed'}}),audits:await p.inventoryAuditLog.count({where:{inventoryItemId:${q(f.item.id)}}})};
    `);
    expect(saved.trades).toHaveLength(1);
    expect(saved.trades[0].lines).toHaveLength(1);
    expect(saved.trades[0].lines[0]).toMatchObject({ inventoryItemId: f.item.id, quantity: 1 });
    expect(saved.notices).toBe(1); expect(saved.events).toBe(1); expect(saved.audits).toBe(0);
    expect(database(`return p.inventoryItem.findUniqueOrThrow({where:{id:${q(f.item.id)}}});`)).toEqual(before);
    await pages[2].goto("/notifications");
    await expect(pages[2].getByText("Proposer sent you a trade proposal", { exact: true })).toHaveCount(1);
    await pages[2].screenshot({ path: test.info().outputPath("recipient-notification.png"), fullPage: true });
  } catch (error) { failure = error; } finally {
    const failures: unknown[] = failure ? [failure] : [];
    clearTimeout(timer); release();
    const closed = await Promise.allSettled(contexts.map(context => context.close()));
    for (const result of closed) if (result.status === "rejected") failures.push(result.reason);
    try { database(`const users=await p.user.findMany({where:{username:{startsWith:${q(tag)}}}}),ids=users.map(u=>u.id),owners=users.map(u=>u.playerId);
      const trades=await p.trade.findMany({where:{createdByUserId:{in:ids}},select:{id:true}}),tradeIds=trades.map(t=>t.id);
      await p.notificationDeliveryJob.deleteMany({where:{sourceId:{in:tradeIds}}});
      await p.notification.deleteMany({where:{recipientUserId:{in:ids}}});
      await p.inventoryAuditLog.deleteMany({where:{changedByUserId:{in:ids}}});
      await p.tradeEvent.deleteMany({where:{tradeId:{in:tradeIds}}});await p.trade.deleteMany({where:{id:{in:tradeIds}}});
      await p.inventoryItem.deleteMany({where:{currentOwnerId:{in:owners}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});
      await p.user.deleteMany({where:{id:{in:ids}}});await p.player.deleteMany({where:{id:{in:owners}}});
      await p.card.deleteMany({where:{scryfallId:tag}});return true;`);
    expect(database<number>(`return p.user.count({where:{username:{startsWith:${q(tag)}}}});`)).toBe(0);
    expect(database<number>(`return p.card.count({where:{scryfallId:${q(tag)}}});`)).toBe(0);
    } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Proposal browser fixture and cleanup failed", { cause: failures[0] });
  }
});
