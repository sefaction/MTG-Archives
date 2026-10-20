import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { loadIsolatedQualificationTarget, verifyIsolatedQualificationTarget,
  type IsolatedQualificationTarget } from "./isolated-qualification-target";

function database<T>(target: IsolatedQualificationTarget, body: string): T {
  verifyIsolatedQualificationTarget(target);
  return JSON.parse(execFileSync("docker", ["exec", "-i", target.web.id, "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 60000, windowsHide: true,
  }));
}

for (const width of [1366, 390, 320]) test(`actual app scan capacity choices at ${width}px`, async ({ page, baseURL }) => {
  test.skip(!process.env.MTG_ISOLATED_FIXTURE_MANIFEST, "Requires exact-owned isolated app/database manifest");
  const target = loadIsolatedQualificationTarget()!;
  expect(baseURL).toBe(target.baseURL);
  test.setTimeout(120000);
  await page.setViewportSize({ width, height: 900 });
  const tag = "ui-scan-filter-" + randomUUID(), password = randomUUID();
  const q = JSON.stringify;
  let primaryError: unknown;
  try {
    database(target, `const n=${q(tag)};
      await p.player.create({data:{id:n,name:n,displayName:n}});
      await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:await require('bcryptjs').hash(${q(password)},10)}});
      const card=await p.card.create({data:{id:n,scryfallId:n,name:n,setCode:'tst',collectorNumber:'1',typeLine:'Creature',rarity:'common'}});
      const specs=[['partial',10,[{name:'Free',capacity:8},{name:'Full',capacity:1},{name:'Unknown',capacity:null}]],
        ['full',3,[{name:'Empty child',capacity:10}]],['over',1,[]],['unknown',null,[]],
        ['vault',null,[{name:'Vault free',capacity:85},{name:'Vault full',capacity:85}]]];
      for(const [name,capacity,sections] of specs) await p.inventoryLocation.create({data:{id:n+'-'+name,name:n+' '+name,normalizedName:n+' '+name,ownerPlayerId:n,storageLayout:{capacity,sections}}});
      const stock=[['partial','Free',6],['partial','Full',1],['partial',null,1],['full',null,3],['over',null,2],['vault','Vault free',84],['vault','Vault full',85]];
      for(const [name,locationSection,quantity] of stock) await p.inventoryItem.create({data:{cardId:card.id,currentOwnerId:n,locationId:n+'-'+name,locationSection,quantity,condition:'NM',sourceType:'MANUAL'}});
      await p.acquisitionSession.create({data:{createdByUserId:n,ownerPlayerId:n,locationId:n+'-partial',section:'Free',requestKey:n,requestPayload:'fixture',placement:{},policy:{},scannerReserved:1}});
      return true;`);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/imports/scan?input=scanner");
    const setup = page.getByRole("region", { name: "New scan batch", exact: true });
    const picker = setup.getByTestId("storage-destination");
    const filter = picker.getByRole("checkbox", { name: "Only destinations with free space" });
    await expect(filter).not.toBeChecked();
    await expect(picker.getByRole("option")).toHaveCount(5);
    await filter.focus(); await page.keyboard.press("Space");
    await expect(picker.getByRole("option")).toHaveCount(2);
    await expect(picker.getByRole("option", { name: new RegExp(tag + " partial") })).toHaveCount(1);
    await expect(picker.getByRole("option", { name: new RegExp(tag + " vault") })).toHaveCount(1);
    await picker.getByRole("combobox").fill(tag + " partial");
    await page.keyboard.press("Enter");
    await picker.getByRole("button", { name: /^Free\s/ }).click();
    await expect(picker.getByRole("button", { name: /^Full\s/ })).toHaveCount(0);
    await expect(picker.getByRole("button", { name: /^Unknown\s/ })).toHaveCount(0);
    await setup.getByRole("checkbox", { name: "Scan from a connected scanner" }).uncheck();
    await setup.getByRole("checkbox", { name: "Set a batch limit (optional)" }).check();
    await setup.getByLabel("Cards in this batch", { exact: true }).fill("10");
    await expect(picker.getByRole("button", { name: /^Free\s/ })).toHaveCount(1);
    await expect(setup.getByRole("button", { name: "Start batch", exact: true })).toBeDisabled();
    const capacity = await page.request.get(`/api/scanners/capacity?location=${encodeURIComponent(tag + "-partial")}&section=Free`);
    expect(capacity.ok()).toBe(true);
    expect(await capacity.json()).toMatchObject({ remaining: 1, pendingSection: 1, pendingTotal: 1 });
    const before = database(target, `return {sessions:await p.acquisitionSession.count({where:{ownerPlayerId:${q(tag)}}}),quantity:(await p.inventoryItem.aggregate({where:{currentOwnerId:${q(tag)}},_sum:{quantity:true}}))._sum.quantity};`);
    await filter.uncheck();
    await expect(picker.getByRole("button", { name: /^Full\s/ })).toHaveCount(1);
    await expect(picker.getByRole("button", { name: /^Unknown\s/ })).toHaveCount(1);
    await filter.check();
    expect(database(target, `return {sessions:await p.acquisitionSession.count({where:{ownerPlayerId:${q(tag)}}}),quantity:(await p.inventoryItem.aggregate({where:{currentOwnerId:${q(tag)}},_sum:{quantity:true}}))._sum.quantity};`)).toEqual(before);
    await page.screenshot({ path: `test-results/actual-scan-filter-on-${width}.png` });

    // Owned fixture writes simulate newer capacity. No scanner command is sent.
    database(target, `await p.inventoryItem.updateMany({where:{locationId:${q(tag + "-partial")},locationSection:'Free'},data:{quantity:8}});
      await p.inventoryItem.updateMany({where:{locationId:${q(tag + "-vault")}},data:{quantity:85}}); return true;`);
    await setup.getByRole("button", { name: "Refresh capacity", exact: true }).click();
    await expect(picker).toContainText("It does not match the free-space filter. Your selection is kept");
    await expect(picker.locator('input[name="destinationLocationId"]')).toHaveValue(tag + "-partial");
    await expect(picker.locator('input[name="destinationLocationSection"]')).toHaveValue("Free");
    await picker.getByRole("button", { name: "Change", exact: true }).click();
    await expect(picker.getByRole("option")).toHaveCount(0);
    await expect(picker).toContainText("No configured destinations with free space found");
    await picker.getByRole("combobox").focus(); await page.keyboard.press("Escape");
    await filter.uncheck();
    await picker.getByRole("button", { name: "Change", exact: true }).click();
    await expect(picker.getByRole("option")).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/actual-scan-filter-restored-${width}.png` });
  } catch (error) { primaryError = error; throw error; }
  finally {
    try {
      database(target, `const n=${q(tag)};await p.acquisitionSession.deleteMany({where:{ownerPlayerId:n}});
        await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});
        await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:n}});
        return true;`);
    } catch (cleanupError) {
      if (primaryError) throw new AggregateError([primaryError, cleanupError], "Application check and owned-fixture cleanup failed");
      throw cleanupError;
    }
  }
});
