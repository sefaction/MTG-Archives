import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const quote = JSON.stringify;
function database<T>(body: string): T {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8",
    timeout: 60_000,
  }));
}

test("Locations rejects an unconfirmed contents delete and preserves child cards after confirmation", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires disposable local data");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(90_000);
  const tag = `ui-location-delete-${randomUUID()}`;
  const password = randomUUID();
  try {
    const fixture = database<{ parentId: string; childId: string }>(`return p.$transaction(async tx=>{
      const tag=${quote(tag)}, passwordHash=await require('bcryptjs').hash(${quote(password)},10);
      const owner=await tx.player.create({data:{name:tag,displayName:'Contents delete reviewer'}});
      await tx.user.create({data:{username:tag,displayName:'Contents delete reviewer',passwordHash,playerId:owner.id}});
      const parent=await tx.inventoryLocation.create({data:{name:tag+' shelf',normalizedName:(tag+' shelf').toLowerCase(),ownerPlayerId:owner.id,type:'Box'}});
      const child=await tx.inventoryLocation.create({data:{name:tag+' child',normalizedName:(tag+' child').toLowerCase(),ownerPlayerId:owner.id,parentLocationId:parent.id,type:'Box'}});
      const card=await tx.card.findFirstOrThrow({where:{name:'Forest'}});
      for(const [locationId,quantity,condition] of [[parent.id,3,'NM'],[parent.id,2,'LP'],[child.id,4,'MP']])
        await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:owner.id,locationId,quantity,condition,sourceType:'MANUAL',notes:tag}});
      return {parentId:parent.id,childId:child.id};
    });`);

    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto(`/locations?selected=${fixture.parentId}`);
    const detail = page.getByRole("article", { name: "Selected location" });
    await expect(detail).toContainText("5 copies here");
    await expect(detail).toContainText("9 copies with sub-locations");
    await detail.getByRole("link", { name: "Manage", exact: true }).click();
    await detail.getByText("Danger zone", { exact: true }).click();
    const confirmation = detail.getByPlaceholder(`Type DELETE or ${tag} shelf`);
    const deleteButton = detail.getByRole("button", { name: "Delete contents", exact: true });
    await confirmation.fill("NO");
    await deleteButton.click();
    await expect(detail.getByRole("alert")).toContainText("Type DELETE or the location name");
    expect(database<number>(`return p.inventoryItem.count({where:{locationId:${quote(fixture.parentId)}}});`)).toBe(2);

    await confirmation.fill("DELETE");
    await deleteButton.click();
    await expect(detail.getByRole("status").filter({ hasText: "Deleted 5 cards across 2 inventory entries" })).toBeVisible();
    await expect(detail).toContainText("0 copies here");
    await expect(detail).toContainText("4 copies with sub-locations");
    const state = database<{ parentItems: number; childCopies: number; parentExists: boolean; audits: number }>(`
      const parentItems=await p.inventoryItem.count({where:{locationId:${quote(fixture.parentId)}}});
      const childCopies=(await p.inventoryItem.aggregate({where:{locationId:${quote(fixture.childId)}},_sum:{quantity:true}}))._sum.quantity ?? 0;
      const parentExists=Boolean(await p.inventoryLocation.findUnique({where:{id:${quote(fixture.parentId)}}}));
      const user=await p.user.findUniqueOrThrow({where:{username:${quote(tag)}}});
      const audits=await p.inventoryAuditLog.count({where:{changedByUserId:user.id,changeType:'location_contents_deleted'}});
      return {parentItems,childCopies,parentExists,audits};
    `);
    expect(state).toEqual({ parentItems: 0, childCopies: 4, parentExists: true, audits: 2 });
  } finally {
    database(`const owner=await p.player.findUnique({where:{name:${quote(tag)}}});if(owner){
      const user=await p.user.findUnique({where:{username:${quote(tag)}}});
      if(user) await p.inventoryAuditLog.deleteMany({where:{changedByUserId:user.id}});
      await p.inventoryItem.deleteMany({where:{currentOwnerId:owner.id}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:owner.id,parentLocationId:{not:null}}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:owner.id}});
      await p.user.deleteMany({where:{username:${quote(tag)}}});
      await p.player.delete({where:{id:owner.id}});
    }return true;`);
  }
});
