import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

test.use({ trace: "off", screenshot: "off", video: "off" });
const quote = JSON.stringify;

function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}

test("all-matching Inventory export includes filtered entries beyond the visible page", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires disposable local snapshot");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(120_000);
  const tag = `ui-allmatching-export-${randomUUID()}`;
  const password = randomUUID();
  let exportFileProtected = false;
  try {
    database(`return p.$transaction(async tx=>{
      const tag=${quote(tag)},hash=await require('bcryptjs').hash(${quote(password)},10);
      const owner=await tx.player.create({data:{name:tag,displayName:'Export reviewer'}});
      await tx.user.create({data:{username:tag,displayName:'Export reviewer',passwordHash:hash,playerId:owner.id}});
      const location=await tx.inventoryLocation.create({data:{name:'Export box',normalizedName:'export box',ownerPlayerId:owner.id,type:'Box'}});
      const forests=await tx.card.findMany({where:{name:'Forest'},orderBy:{id:'asc'},take:12});
      if(forests.length!==12)throw Error('Fixture needs twelve cached Forest printings');
      const island=await tx.card.findFirstOrThrow({where:{name:'Island'},orderBy:{id:'asc'}});
      for(let n=1;n<=12;n++) await tx.inventoryItem.create({data:{cardId:forests[n-1].id,currentOwnerId:owner.id,originalOpenerId:owner.id,locationId:location.id,locationSection:'Pocket '+n,quantity:1,sourceType:'MANUAL',condition:'NM',language:'EN',notes:tag+'-Pocket-'+n}});
      await tx.inventoryItem.create({data:{cardId:island.id,currentOwnerId:owner.id,originalOpenerId:owner.id,locationId:location.id,quantity:1,sourceType:'MANUAL',condition:'NM',language:'EN',notes:tag+'-excluded'}});
      return true;
    });`);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/inventory?displayMode=exact&pageSize=10&cardName=Forest");
    await expect(page.locator(".inventory-results tbody tr")).toHaveCount(10);
    await expect(page.getByRole("button", { name: "Next page", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Select all matching filters" }).click();
    await expect(page.locator(".inventory-selection-context").filter({ hasText: "All 12 matching entries" })).toContainText("12 physical copies");
    await page.locator("summary").filter({ hasText: "More actions" }).click();
    const exportForm = page.locator('form[action="/api/inventory/export"]').filter({
      has: page.getByRole("button", { name: "MTG Archives CSV" }),
    });
    await expect(exportForm.locator('input[name="selectionMode"]')).toHaveValue("all");
    await expect(exportForm.locator('input[name="filterQuery"]')).toHaveValue(/cardName=Forest/);
    database(`const fs=require('node:fs/promises'),path=require('node:path');const dir=process.env.EXPORTS_DATA_PATH;
      if(!dir)return true;const target=path.resolve(dir,'mtg-inventory-filtered-'+new Date().toISOString().slice(0,10)+'.csv');
      if(path.dirname(target)!==path.resolve(dir))throw Error('Unexpected export target');
      const backup=path.resolve(dir,${quote(`.${tag}.backup`)});
      try{await fs.copyFile(target,backup)}catch(e){if(e.code!=='ENOENT')throw e}
      return true;`);
    exportFileProtected = true;
    const downloadPromise = page.waitForEvent("download");
    await exportForm.getByRole("button", { name: "MTG Archives CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^mtg-inventory-filtered-\d{4}-\d{2}-\d{2}\.csv$/);
    const file = await download.path();
    expect(file).toBeTruthy();
    const csv = await readFile(file!, "utf8");
    expect(csv).toContain("Quantity,Name,Set Code");
    expect(csv).not.toContain(`${tag}-excluded`);
    for (let n = 1; n <= 12; n++) expect(csv).toContain(`${tag}-Pocket-${n}`);
    expect((csv.match(new RegExp(`${tag}-Pocket-\\d+`, "g")) || []).length).toBe(12);
  } finally {
    if (exportFileProtected) database(`const fs=require('node:fs/promises'),path=require('node:path');const dir=process.env.EXPORTS_DATA_PATH;
      if(!dir)return true;const target=path.resolve(dir,'mtg-inventory-filtered-'+new Date().toISOString().slice(0,10)+'.csv');
      if(path.dirname(target)!==path.resolve(dir))throw Error('Unexpected export target');
      const backup=path.resolve(dir,${quote(`.${tag}.backup`)});
      try{await fs.access(backup);await fs.copyFile(backup,target);await fs.rm(backup)}catch(e){if(e.code!=='ENOENT')throw e;await fs.rm(target,{force:true})}
      return true;`);
    database(`const owner=await p.player.findUnique({where:{name:${quote(tag)}}});if(owner){
      await p.inventoryAuditLog.deleteMany({where:{inventoryItem:{currentOwnerId:owner.id}}});
      await p.inventoryItem.deleteMany({where:{currentOwnerId:owner.id}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:owner.id}});
      await p.user.deleteMany({where:{playerId:owner.id}});
      await p.player.delete({where:{id:owner.id}})}return true;`);
  }
});
