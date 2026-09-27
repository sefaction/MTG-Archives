import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });

function database<T>(body: string): T {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30_000,
  }));
}

test("Inventory distinguishes zero matches from an empty collection and preserves view settings on clear", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires disposable local snapshot");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(90_000);
  const tag = `ui-empty-results-${randomUUID()}`;
  const password = randomUUID();
  try {
    database(`return p.$transaction(async tx=>{
      const tag=${JSON.stringify(tag)},passwordHash=await require('bcryptjs').hash(${JSON.stringify(password)},10);
      const owner=await tx.player.create({data:{name:tag,displayName:tag}});
      await tx.user.create({data:{username:tag,displayName:tag,passwordHash,playerId:owner.id}});
      const card=await tx.card.findFirstOrThrow({where:{name:'Forest'},orderBy:{id:'asc'}});
      await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:owner.id,quantity:2,sourceType:'MANUAL',condition:'NM',language:'EN',notes:tag}});
      return true;
    });`);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto("/inventory?displayMode=exact&pageSize=10&browse=paginated&sort=cardName&sortDir=desc&cardName=NoSuchCardForEmptyReview");
    const results = page.locator(".inventory-results");
    await expect(results.getByRole("heading", { name: "No cards match these filters" })).toBeVisible();
    await expect(results.getByRole("status")).toContainText("Revise a filter above");
    const clear = results.getByRole("link", { name: "Clear filters" });
    await expect(clear).toHaveAttribute("href", /displayMode=exact.*pageSize=10.*browse=paginated.*sort=cardName.*sortDir=desc/);
    await clear.click();
    await expect(page).not.toHaveURL(/cardName=/);
    await expect(page).toHaveURL(/displayMode=exact.*pageSize=10.*browse=paginated.*sort=cardName.*sortDir=desc/);
    await expect(results.getByText("Forest", { exact: true }).first()).toBeVisible();
    await expect(results.getByRole("heading", { name: "No cards match these filters" })).toHaveCount(0);

    database(`const owner=await p.user.findUniqueOrThrow({where:{username:${JSON.stringify(tag)}}});await p.inventoryItem.deleteMany({where:{currentOwnerId:owner.playerId}});return true;`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(results.getByRole("heading", { name: "No cards in this collection yet" })).toBeVisible();
    await expect(results.getByRole("link", { name: "Go to Imports" })).toHaveAttribute("href", "/imports");
    await expect(results.getByRole("link", { name: "Clear filters" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally {
    database(`const users=await p.user.findMany({where:{username:${JSON.stringify(tag)}},select:{id:true,playerId:true}});const ids=users.map(u=>u.id),owners=users.map(u=>u.playerId).filter(Boolean);await p.$transaction(async tx=>{await tx.inventoryItem.deleteMany({where:{currentOwnerId:{in:owners}}});await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});await tx.user.deleteMany({where:{id:{in:ids}}});await tx.player.deleteMany({where:{id:{in:owners}}});});return true;`);
  }
});
