import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

function database<T>(body: string): T {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Sorting fixture operation failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000,
  }));
}

for (const surface of ["inventory", "public/inventory"] as const) {
for (const displayMode of ["exact", "grouped"] as const) {
  test(`${surface} ${displayMode} header sorting agrees with the server and survives reload`, async ({ page, baseURL }) => {
    test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires disposable local snapshot");
    expect(baseURL).toBe("http://127.0.0.1:13001");
    test.setTimeout(120000);
    const tag = `ui-sorting-${randomUUID()}`, password = randomUUID();
    const ascending = ["Forest", "Island", "Mountain", "Plains"];
    const quantityDescending = ["Mountain", "Forest", "Plains", "Island"];
    const names = () => page.locator(".inventory-results table tbody tr td button.underline").allTextContents();
    try {
      database(`return p.$transaction(async tx=>{
        const tag=${JSON.stringify(tag)},passwordHash=await require('bcryptjs').hash(${JSON.stringify(password)},10);
        const owner=await tx.player.create({data:{id:tag,name:tag,displayName:tag}});
        await tx.user.create({data:{id:tag,username:tag,displayName:tag,passwordHash,playerId:owner.id,inventoryDefaultVisibility:'PUBLIC'}});
        for(const [name,quantity] of [['Forest',8],['Island',2],['Mountain',17],['Plains',5]]) {
          const card=await tx.card.findFirstOrThrow({where:{name},orderBy:{id:'asc'}});
          await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:owner.id,quantity,sourceType:'MANUAL',condition:'NM',language:'EN',notes:tag}});
        }
        return true;
      });`);
      await page.goto("/login");
      await page.getByLabel(/username or email/i).fill(tag);
      await page.getByLabel(/^password$/i).fill(password);
      await page.getByRole("button", { name: /^log in$/i }).click();
      await page.waitForURL(/\/dashboard/);
      await page.setViewportSize({width:1366,height:900});
      const query = `displayMode=${displayMode}&pageSize=10&browse=paginated${surface === "public/inventory" ? `&owner=${tag}` : ""}`;
      const response = await page.request.get(`/api/${surface}/list?${query}&sort=quantity&sortDir=desc`);
      expect(response.ok()).toBe(true);
      const api = await response.json();
      expect(api.rows.map((row: {cardName:string})=>row.cardName)).toEqual(quantityDescending);
      await page.goto(`/${surface}?${query}&sort=quantity&sortDir=desc`);
      await page.waitForLoadState("networkidle");
      await expect.poll(names).toEqual(quantityDescending);
      await page.goto(`/${surface}?${query}&sort=cardName&sortDir=asc`);
      await page.waitForLoadState("networkidle");
      await expect.poll(names).toEqual(ascending);
      await page.getByRole("columnheader",{name:"Total cards",exact:true}).getByRole("link").click();
      await expect(page).toHaveURL(/sort=quantity/);
      await page.waitForLoadState("networkidle");
      await expect.poll(names).toEqual(quantityDescending);
      await page.getByRole("columnheader",{name:"Total cards",exact:true}).getByRole("link").click();
      await page.waitForLoadState("networkidle");
      await expect.poll(names).toEqual([...quantityDescending].reverse());
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect.poll(names).toEqual([...quantityDescending].reverse());
      await page.setViewportSize({width:390,height:844});
      await page.getByRole("columnheader",{name:"Card Name",exact:true}).getByRole("link").click();
      await page.waitForLoadState("networkidle");
      await expect.poll(names).toEqual(ascending);
      await page.getByRole("columnheader",{name:"Card Name",exact:true}).getByRole("link").click();
      await page.waitForLoadState("networkidle");
      await expect.poll(names).toEqual([...ascending].reverse());
      await page.screenshot({path:`test-results/inventory-sorting-${displayMode}-390.png`});
    } finally {
      database(`const n=${JSON.stringify(tag)};await p.$transaction(async tx=>{await tx.inventoryItem.deleteMany({where:{currentOwnerId:n}});await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await tx.authSession.deleteMany({where:{userId:n}});await tx.user.deleteMany({where:{id:n}});await tx.player.deleteMany({where:{id:n}})});return true;`);
    }
  });
}


}


test("filtered Public sorting preserves three-owner aggregation across pages", async ({ page, browser, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires disposable local snapshot");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(120000);
  const tag = `ui-sorting-public-${randomUUID()}`;
  const owners = [0, 1, 2].map(i => `${tag}-owner-${i}`);
  const samples = Array.from({length:12}, (_, i) => ({
    name: `${tag} Card ${String(i).padStart(2,"0")}`,
    quantity: 3*i+1+(i%2===0?1:0)+(i%3===0?1:0),
  }));
  const descending = [...samples].sort((a,b)=>b.quantity-a.quantity).map(s=>s.name);
  const names = () => page.locator(".inventory-results table tbody tr td button.underline").allTextContents();
  try {
    database(`return p.$transaction(async tx=>{
      const tag=${JSON.stringify(tag)},owners=${JSON.stringify(owners)};
      for(const owner of owners){await tx.player.create({data:{id:owner,name:owner,displayName:owner}});await tx.user.create({data:{id:owner,username:owner,displayName:owner,passwordHash:await require('bcryptjs').hash(require('crypto').randomUUID(),10),playerId:owner,inventoryDefaultVisibility:'PUBLIC'}});await tx.inventoryLocation.create({data:{id:owner,name:owner+' League',normalizedName:owner+' league',ownerPlayerId:owner,type:'League 2026',visibility:'PUBLIC'}})}
      for(let i=0;i<12;i++) {
        const card=await tx.card.create({data:{id:tag+'-card-'+i,scryfallId:require('crypto').randomUUID(),name:tag+' Card '+String(i).padStart(2,'0'),typeLine:'Artifact — Equipment',setCode:i<6?'zzz':'aaa',collectorNumber:String(i+1),rarity:'common',manaValue:12-i,prices:{}}});
        for(let o=0;o<3;o++){if(o===1&&i%2!==0||o===2&&i%3!==0)continue;await tx.inventoryItem.create({data:{currentOwnerId:owners[o],originalOpenerId:owners[o],cardId:card.id,locationId:owners[o],quantity:o===0?3*i+1:1,condition:'NM',language:'EN',sourceType:'MANUAL',notes:tag}})}
      }
      await tx.inventoryLocation.create({data:{id:tag+'-private',name:tag+' private',normalizedName:tag+' private',ownerPlayerId:owners[0],type:'League 2026',visibility:'PRIVATE'}});
      const hidden=await tx.card.create({data:{id:tag+'-card-hidden',scryfallId:require('crypto').randomUUID(),name:tag+' Card Hidden',typeLine:'Artifact — Equipment',setCode:'tst',collectorNumber:'999',rarity:'rare',prices:{}}});
      await tx.inventoryItem.create({data:{currentOwnerId:owners[0],originalOpenerId:owners[0],cardId:hidden.id,locationId:tag+'-private',quantity:999,condition:'NM',language:'EN',sourceType:'MANUAL',notes:tag}});
      return true;
    });`);
    const query=new URLSearchParams({displayMode:"grouped",pageSize:"10",browse:"paginated",type:"Equipment",locationType:"League 2026",owner:owners.join(","),cardName:tag});
    const response=await page.request.get(`/api/public/inventory/list?${query}&sort=quantity&sortDir=desc`);
    expect(response.ok()).toBe(true);
    const api=await response.json();
    expect(api.totalMatchingCount).toBe(12);
    expect(api.rows.map((r:{cardName:string})=>r.cardName)).toEqual(descending.slice(0,10));
    await page.setViewportSize({width:1366,height:900});
    await page.goto(`/public/inventory?${query}&sort=cardName&sortDir=asc`);
    await page.waitForLoadState("networkidle");
      await expect.poll(names).toEqual(samples.map(s=>s.name).slice(0,10));
    await page.getByRole("columnheader",{name:"Total cards",exact:true}).getByRole("link").click();
    await page.waitForLoadState("networkidle");
      await expect.poll(names).toEqual(descending.slice(0,10));
    const sorted=new URL(page.url());
    expect(sorted.searchParams.get("owner")).toBe(owners.join(","));
    expect(sorted.searchParams.get("type")).toBe("Equipment");
    expect(sorted.searchParams.get("locationType")).toBe("League 2026");
    sorted.searchParams.set("page","2");
    await page.goto(sorted.toString());
    await page.waitForLoadState("networkidle");
      await expect.poll(names).toEqual(descending.slice(10));
    sorted.searchParams.set("page","1");
    await page.goto(sorted.toString());
    await page.waitForLoadState("networkidle");
    await page.setViewportSize({width:390,height:844});
    const tableTop = await page.locator(".inventory-results table").evaluate(el => el.getBoundingClientRect().top + scrollY);
    await page.evaluate(y => window.scrollTo(0,y-90), tableTop);
    const quantityLink = page.getByRole("columnheader",{name:"Total cards",exact:true}).getByRole("link");
    await quantityLink.focus();
    const scrollBefore = await page.evaluate(() => scrollY);
    expect(scrollBefore).toBeGreaterThan(0);
    const historyBefore = await page.evaluate(() => history.length);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/sort=quantity&sortDir=asc/);
    await page.waitForLoadState("networkidle");
    await expect.poll(names).toEqual([...descending].reverse().slice(0,10));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(scrollBefore);
    expect(await page.evaluate(() => history.length)).toBe(historyBefore);
    await expect(page.getByRole("columnheader",{name:"Total cards",exact:true})).toHaveAttribute("aria-sort","ascending");
    await page.reload();
    await page.waitForLoadState("networkidle");
      await expect.poll(names).toEqual([...descending].reverse().slice(0,10));
    await page.screenshot({path:"test-results/public-filtered-sorting-390.png"});
    await page.setViewportSize({width:1366,height:900});
    const headings = page.locator(".inventory-results table thead th a");
    const headingCount = await headings.count();
    expect(headingCount).toBeGreaterThanOrEqual(3);
    for(let index=0;index<headingCount;index++) {
      const href = await headings.nth(index).getAttribute("href");
      expect(href).toBeTruthy();
      const destination = new URL(href!,baseURL);
      const sortedApi = await page.request.get("/api/public/inventory/list"+destination.search);
      expect(sortedApi.ok()).toBe(true);
      const sortedRows = await sortedApi.json();
      expect(sortedRows.totalMatchingCount).toBe(12);
      await headings.nth(index).click();
      await expect(page).toHaveURL(destination.toString());
      await page.waitForLoadState("networkidle");
      await expect.poll(names).toEqual(sortedRows.rows.map((r:{cardName:string})=>r.cardName));
      expect(new URL(page.url()).searchParams.get("owner")).toBe(owners.join(","));
    }
  } finally {
    database(`const owners=${JSON.stringify(owners)},tag=${JSON.stringify(tag)};await p.$transaction(async tx=>{await tx.inventoryItem.deleteMany({where:{currentOwnerId:{in:owners}}});await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});await tx.authSession.deleteMany({where:{userId:{in:owners}}});await tx.user.deleteMany({where:{id:{in:owners}}});await tx.player.deleteMany({where:{id:{in:owners}}});await tx.card.deleteMany({where:{id:{in:[...Array.from({length:12},(_,i)=>tag+'-card-'+i),tag+'-card-hidden']}}})});return true;`);
  }
});

