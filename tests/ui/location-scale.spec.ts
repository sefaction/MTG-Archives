import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.skip(
  process.env.MTG_LOCAL_PILOT_TEST !== "1",
  "Requires disposable local Docker snapshot",
);

function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 60_000,
    }),
  );
}

test("large owner-scoped location trees have bounded cards, lazy editors and usable search", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  expect(baseURL).toBe("http://127.0.0.1:13001");
  const tag = `ui-location-scale-${randomUUID()}`;
  const password = randomUUID();
  try {
    const fixture = database<{
      rootId: string;
      childId: string;
      otherLocationId: string;
      printingCount: number;
    }>(`
      const name=${JSON.stringify(tag)};
      const owner=await p.player.create({data:{name,displayName:name}});
      const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);
      await p.user.create({data:{username:name,displayName:name,playerId:owner.id,passwordHash:hash}});
      const roots=Array.from({length:100},(_,i)=>({id:name+'-r'+i,ownerPlayerId:owner.id,name:'Vault '+String(i).padStart(3,'0'),normalizedName:'vault '+i,type:'Vault'}));
      await p.inventoryLocation.createMany({data:roots});
      const children=Array.from({length:1100},(_,i)=>({id:name+'-c'+i,ownerPlayerId:owner.id,parentLocationId:roots[i%100].id,name:'Box '+String(i).padStart(4,'0'),normalizedName:'box '+i,type:'Box'}));
      await p.inventoryLocation.createMany({data:children});
      const cards=await p.card.findMany({take:1000,select:{id:true},orderBy:{id:'asc'}});const locs=[...roots,...children];
      if(cards.length!==1000) throw new Error('Needs 1,000 cached printings for the location scale fixture');
      await p.inventoryItem.createMany({data:Array.from({length:3000},(_,i)=>({cardId:cards[i%cards.length].id,currentOwnerId:owner.id,originalOpenerId:owner.id,locationId:locs[i%locs.length].id,quantity:50,condition:'NM',sourceType:'MANUAL',locationSection:'Sect '+i%6}))});
      const other=await p.player.create({data:{name:name+'-other',displayName:name+'-other'}});
      const otherLocation=await p.inventoryLocation.create({data:{name:'Private scale sentinel',normalizedName:'private scale sentinel',ownerPlayerId:other.id,visibility:'PRIVATE'}});
      for(const [suffix,quantity] of [['-other',5000],['-small',500],['-tiny',7]]) {
        const secondary=suffix==='-other'?other:await p.player.create({data:{name:name+suffix,displayName:name+suffix}});
        await p.user.create({data:{username:name+suffix,displayName:name+suffix,playerId:secondary.id,passwordHash:hash}});
        const location=suffix==='-other'?otherLocation:await p.inventoryLocation.create({data:{ownerPlayerId:secondary.id,name:'Other private storage',normalizedName:'other private storage'}});
        await p.inventoryItem.create({data:{cardId:cards[0].id,currentOwnerId:secondary.id,originalOpenerId:secondary.id,locationId:location.id,quantity,condition:'NM',sourceType:'MANUAL'}});
      }
      return {rootId:roots[0].id,childId:children[0].id,otherLocationId:otherLocation.id,printingCount:cards.length};
    `);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    const start = Date.now();
    await page.goto("/locations");
    const browser = page.locator("#normal-locations");
    await expect(browser.locator("[data-location-result]")).toHaveCount(25);
    await expect(browser.locator("article")).toHaveCount(1);
    await expect(
      browser.locator('form:has(input[name="locationId"])'),
    ).toHaveCount(0);
    const elapsedMs = Date.now() - start;
    const domHtmlBytes = Buffer.byteLength(await page.content());
    const options = await page.locator("option").count();
    console.log(
      JSON.stringify({
        locations: 1200,
        copies: 150000,
        printings: fixture.printingCount,
        owners: 4,
        secondaryOwnerCopies: [5000, 500, 7],
        elapsedMs,
        domHtmlBytes,
        options,
      }),
    );
    expect(options).toBeLessThan(50);
    expect(domHtmlBytes).toBeLessThan(500_000);
    await expect(
      browser.locator(".locations-browser").getByRole("status"),
    ).toHaveText(/1201 matching locations/);
    expect(await page.content()).not.toContain("Private scale sentinel");
    await browser
      .getByRole("link", { name: "Next locations", exact: true })
      .click();
    await expect(
      browser.locator(".locations-browser").getByRole("status"),
    ).toHaveText(/Page 2 of 49/);
    await expect(browser.locator("[data-location-result]")).toHaveCount(25);

    await browser
      .getByLabel("Search locations", { exact: true })
      .fill("Box 1099");
    await browser.getByRole("button", { name: "Find locations" }).click();
    await expect(browser.locator("article")).toHaveCount(1);
    await expect(browser.locator("article")).toContainText(
      "Vault 099 / Box 1099",
    );
    await expect(
      browser.locator(".locations-browser").getByRole("status"),
    ).toHaveText(/Page 1 of 1/);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await browser
        .getByLabel("Search locations", { exact: true })
        .evaluate((el) => el.getBoundingClientRect().width),
    ).toBeGreaterThan(280);
    await browser.getByRole("link", { name: "Manage", exact: true }).click();
    const editor = browser.locator("form").filter({
      has: page.getByRole("button", { name: "Save location", exact: true }),
    });
    await expect(editor).toHaveCount(1);
    expect(
      await editor.locator('select[name="parentLocationId"] option').count(),
    ).toBeLessThanOrEqual(32);
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Scale editor verification");
    await editor
      .getByRole("button", { name: "Save location", exact: true })
      .click();
    await expect(
      browser
        .locator("article")
        .getByText("Scale editor verification", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/location-scale-phone.png",
      fullPage: true,
    });
    await browser
      .getByRole("link", { name: "Close editor", exact: true })
      .click();
    await expect(
      browser.locator('form:has(input[name="locationId"])'),
    ).toHaveCount(0);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/locations?parent=${fixture.rootId}#normal-locations`);
    await expect(
      browser.locator(".locations-browser").getByRole("status"),
    ).toHaveText(/12 matching locations/);
    await expect(
      browser
        .getByRole("navigation", { name: "Locations tree" })
        .getByRole("link", { name: "Box 0000" }),
    ).toBeVisible();
    await browser
      .getByRole("navigation", { name: "Locations tree" })
      .getByRole("link", { name: "Box 0000" })
      .click();
    await expect(
      browser.locator(".locations-browser").getByRole("status"),
    ).toHaveText(/1 matching locations/);
    await page.screenshot({
      path: "test-results/location-scale-desktop.png",
      fullPage: true,
    });
    await page.goto(
      `/locations?parent=${fixture.otherLocationId}&edit=${fixture.otherLocationId}#normal-locations`,
    );
    await expect(
      browser.locator(".locations-browser").getByRole("status"),
    ).toHaveText(/0 matching locations/);
    expect(await page.content()).not.toContain("Private scale sentinel");
    expect(
      database<number>(
        `return (await p.inventoryItem.aggregate({where:{currentOwner:{name:${JSON.stringify(tag)}}},_sum:{quantity:true}}))._sum.quantity;`,
      ),
    ).toBe(150000);
  } finally {
    database(`const owners=await p.player.findMany({where:{name:{in:${JSON.stringify([tag, tag + "-other", tag + "-small", tag + "-tiny"])}}}});const ids=owners.map(x=>x.id);
      await p.inventoryAuditLog.deleteMany({where:{changedByUser:{username:${JSON.stringify(tag)}}}});
      await p.inventoryItem.deleteMany({where:{currentOwnerId:{in:ids}}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids},parentLocationId:{not:null}}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids}}});
      await p.user.deleteMany({where:{playerId:{in:ids}}});await p.player.deleteMany({where:{id:{in:ids}}});return {removedFixtures:ids.length};`);
  }
});
