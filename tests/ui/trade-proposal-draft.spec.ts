import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { loadIsolatedQualificationTarget } from "./isolated-qualification-target";

let target: ReturnType<typeof loadIsolatedQualificationTarget>;
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

test("proposal validation retains multiline notes until a successful retry", async ({ browser, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires disposable snapshot opt-in");
  target = loadIsolatedQualificationTarget();
  expect(baseURL).toBe(target?.baseURL ?? "http://127.0.0.1:13001");
  expect(database<number>("return p.tradeAnnouncementWebhookEndpoint.count({where:{enabled:true}});")).toBe(0);
  const tag = `ui-proposal-draft-${randomUUID()}`, password = randomUUID();
  const contexts = await Promise.all([1366, 320].map(width => browser.newContext({ baseURL, viewport: { width, height: 844 } })));
  let failure: unknown;
  const results: { width: number; retained: boolean; expectedLength: number; actualLength: number }[] = [];
  try {
    const f = database<{ people: { id: string; playerId: string; username: string }[]; items: { id: string }[] }>(`
      const tag=${q(tag)},hash=await require('bcryptjs').hash(${q(password)},10);
      return p.$transaction(async tx=>{
        const people=[];
        for(const suffix of ['Proposer','Recipient']) {
          const player=await tx.player.create({data:{name:tag+'-'+suffix,displayName:tag+'-'+suffix}});
          const user=await tx.user.create({data:{username:tag+'-'+suffix,displayName:suffix,passwordHash:hash,playerId:player.id,inventoryDefaultVisibility:'PUBLIC'}});
          people.push({id:user.id,playerId:player.id,username:user.username});
        }
        const items=[];
        for(const width of [1366,320]) {
          const card=await tx.card.create({data:{scryfallId:tag+'-'+width,name:'Draft note fixture '+width+' '+tag,typeLine:'Artifact',setCode:'tst',collectorNumber:String(width),rarity:'common'}});
          items.push(await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:people[0].playerId,originalOpenerId:people[0].playerId,quantity:1,condition:'NM',foilStatus:'NONFOIL',language:'EN',sourceType:'MANUAL',notes:'Owned draft fixture'}}));
        }
        return {people,items};
      });
    `);
    const counts = () => database<number[]>(`return Promise.all([
      p.trade.count({where:{createdByUserId:${q(f.people[0].id)}}}),p.tradeEvent.count({where:{actorUserId:${q(f.people[0].id)}}}),
      p.notification.count({where:{recipientUserId:${q(f.people[1].id)}}}),p.inventoryAuditLog.count({where:{changedByUserId:${q(f.people[0].id)}}})]);`);
    for (const [index, width] of [1366, 320].entries()) {
      const page = await contexts[index].newPage(); page.setDefaultTimeout(10000);
      await login(page, f.people[0].username, password);
      await page.goto(`/trades?receiverId=${f.people[1].playerId}&offeredInventoryItemId=${f.items[index].id}`);
      const submit = page.getByRole("button", { name: "Submit Proposal", exact: true });
      await expect(submit).toBeEnabled();
      await page.getByText("Add message or notes", { exact: true }).click();
      const notes = `Please keep the condition note: "surface scratches".\nSecond line for ${width}px.`;
      const field = page.getByLabel("Message / notes"); await field.fill(notes);
      // A second real desk reserves the copy after this form was prepared.
      // This is sequential validation, independent of proposal race repairs.
      const peer = await contexts[index].newPage();
      await peer.goto(`/trades?receiverId=${f.people[1].playerId}&offeredInventoryItemId=${f.items[index].id}`);
      await peer.getByText("Add message or notes", { exact: true }).click();
      const reservationNote = `${tag}-availability-${width}`;
      await peer.getByLabel("Message / notes").fill(reservationNote);
      await peer.getByRole("button", { name: "Submit Proposal", exact: true }).click();
      await expect(peer.getByText("Trade proposal sent.", { exact: true })).toBeVisible();
      const reservation = database<string>(`return (await p.trade.findFirstOrThrow({where:{createdByUserId:${q(f.people[0].id)},message:${q(reservationNote)}}})).id;`);
      await peer.close();
      const before = counts(), stock = database(`return p.inventoryItem.findUniqueOrThrow({where:{id:${q(f.items[index].id)}}});`);
      await submit.click();
      await expect(page.getByRole("alert").filter({ hasText: /already reserved or unavailable/ })).toBeVisible();
      await expect(submit).toBeEnabled();
      const retained = await field.inputValue();
      results.push({ width, retained: retained === notes, expectedLength: notes.length, actualLength: retained.length });
      console.log(JSON.stringify(results[results.length - 1]));
      expect(counts()).toEqual(before);
      expect(database(`return p.inventoryItem.findUniqueOrThrow({where:{id:${q(f.items[index].id)}}});`)).toEqual(stock);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`draft-error-${width}.png`), fullPage: true });
      // Continue the old-code measurement at both widths even if it lost text.
      // The final assertion still fails until retention itself is corrected.
      if (retained !== notes) await field.fill(notes);
      database(`await p.trade.update({where:{id:${q(reservation)}},data:{status:'CANCELLED',cancelledAt:new Date()}});return true;`);
      await submit.click();
      await expect(page.getByText("Trade proposal sent.", { exact: true })).toBeVisible();
      await expect(field).toHaveValue("");
      const stored = database<string>(`return (await p.trade.findFirstOrThrow({where:{createdByUserId:${q(f.people[0].id)},status:'PROPOSED',lines:{some:{inventoryItemId:${q(f.items[index].id)}}}}})).message;`);
      expect(stored.replace(/\r\n/g, "\n")).toBe(notes);
      expect(counts()).toEqual([before[0] + 1, before[1] + 1, before[2] + 1, before[3]]);
    }
    expect(results.every(result => result.retained), "validation must retain the exact multiline draft at both widths").toBe(true);
  } catch (error) { failure = error; } finally {
    const failures: unknown[] = failure ? [failure] : [];
    const closed = await Promise.allSettled(contexts.map(context => context.close()));
    for (const result of closed) if (result.status === "rejected") failures.push(result.reason);
    try {
      database(`const tag=${q(tag)},users=await p.user.findMany({where:{username:{startsWith:tag}}}),ids=users.map(u=>u.id),owners=users.map(u=>u.playerId);
        const trades=await p.trade.findMany({where:{createdByUserId:{in:ids}},select:{id:true}}),tradeIds=trades.map(t=>t.id);
        await p.notificationDeliveryJob.deleteMany({where:{sourceId:{in:tradeIds}}});await p.notification.deleteMany({where:{recipientUserId:{in:ids}}});
        await p.inventoryAuditLog.deleteMany({where:{changedByUserId:{in:ids}}});await p.tradeEvent.deleteMany({where:{tradeId:{in:tradeIds}}});await p.trade.deleteMany({where:{id:{in:tradeIds}}});
        await p.inventoryItem.deleteMany({where:{currentOwnerId:{in:owners}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});
        await p.user.deleteMany({where:{id:{in:ids}}});await p.player.deleteMany({where:{id:{in:owners}}});await p.card.deleteMany({where:{scryfallId:{startsWith:tag}}});return true;`);
      expect(database<number>(`return p.user.count({where:{username:{startsWith:${q(tag)}}}});`)).toBe(0);
      expect(database<number>(`return p.card.count({where:{scryfallId:{startsWith:${q(tag)}}}});`)).toBe(0);
    } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Draft browser fixture and cleanup failed", { cause: failures[0] });
  }
});
