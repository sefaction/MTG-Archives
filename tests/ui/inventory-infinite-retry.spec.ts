import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });

function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}

test("Inventory keeps loaded results and selection when infinite loading fails and retries", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires disposable local snapshot");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(90_000);
  const tag = `ui-infinite-retry-${randomUUID()}`;
  const password = randomUUID();
  try {
    database(`return p.$transaction(async tx=>{
      const tag=${JSON.stringify(tag)}, passwordHash=await require('bcryptjs').hash(${JSON.stringify(password)},10);
      const owner=await tx.player.create({data:{name:tag,displayName:tag}});
      await tx.user.create({data:{username:tag,displayName:tag,passwordHash,playerId:owner.id}});
      const cards=await tx.card.findMany({where:{},orderBy:{id:'asc'},take:12,select:{id:true}});
      if(cards.length!==12)throw Error('Needs 12 cached cards');
      for(const card of cards)await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:owner.id,quantity:1,sourceType:'MANUAL',condition:'NM',language:'EN',notes:tag}});
      return true;
    });`);

    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    let requests = 0;
    await page.route("**/api/inventory/list?**", async (route) => {
      requests += 1;
      if (requests === 1) await route.fulfill({ status: 503, body: "Temporary test failure" });
      else await route.continue();
    });

    await page.goto("/inventory?displayMode=exact&pageSize=10&browse=infinite");
    const results = page.locator(".inventory-results");
    await expect(results.getByRole("row")).toHaveCount(11);
    await results.getByRole("checkbox", { name: /^Select / }).first().check();
    await expect(page.locator(".inventory-selection-context").filter({ hasText: "1 entry selected" })).toBeVisible();
    await expect(page.getByText(/Failed to load more results: Request failed \(503\)/)).toBeVisible();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(results.getByRole("row")).toHaveCount(13);
    await expect(page.getByText(/End of results/)).toBeVisible();
    await expect(page.locator(".inventory-selection-context").filter({ hasText: "1 entry selected" })).toBeVisible();
    expect(requests).toBe(2);
  } finally {
    database(`const users=await p.user.findMany({where:{username:${JSON.stringify(tag)}},select:{id:true,playerId:true}});const ids=users.map(u=>u.id),owners=users.map(u=>u.playerId).filter(Boolean);await p.$transaction(async tx=>{await tx.inventoryItem.deleteMany({where:{currentOwnerId:{in:owners}}});await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});await tx.user.deleteMany({where:{id:{in:ids}}});await tx.player.deleteMany({where:{id:{in:owners}}});});return true;`);
  }
});
