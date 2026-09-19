import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// Opt-in: this test creates and removes only uniquely named local fixtures.
test.skip(
  process.env.MTG_LOCAL_PILOT_TEST !== "1",
  "Requires the disposable local Docker snapshot",
);
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); (async()=>{${body}})().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
    }),
  );
}

test("vault creation, multi-selection fill, advisory overflow, refreshed occupancy and phone layout", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  expect(baseURL).toBe("http://127.0.0.1:13001");
  const name = `UI vault pilot ${randomUUID()}`;
  const privateName = `${name} private other owner`;
  try {
    await page.goto("/login");
    await page
      .getByLabel(/username or email/i)
      .fill(process.env.UI_ADMIN_USERNAME || "admin");
    await page
      .getByLabel(/^password$/i)
      .fill(process.env.UI_ADMIN_PASSWORD || "admin123");
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/(dashboard|change-password)/);
    if (page.url().includes("/change-password")) {
      const password = process.env.UI_ADMIN_PASSWORD || "admin123";
      await page.getByLabel(/current password/i).fill(password);
      await page.getByLabel(/^new password$/i).fill(password);
      await page.getByLabel(/confirm new password/i).fill(password);
      await page.getByRole("button", { name: /change password/i }).click();
      await page.waitForURL(/\/dashboard/);
    }
    await page.goto("/locations");
    const create = page.locator("form").filter({
      has: page.getByRole("button", { name: "Create Location", exact: true }),
    });
    await create.locator('input[name="name"]').fill(name);
    await create.getByLabel("Location type").selectOption({ label: "Vault" });
    await create
      .getByRole("button", { name: "Create Location", exact: true })
      .click();
    const sections = page.getByLabel(`${name} sections`, { exact: true });
    const vaultGroup = page.locator("details").filter({ has: sections }).last();
    await vaultGroup.locator("summary").first().click();
    await expect(sections).toBeVisible();
    await expect(
      sections.getByText("0 / 85 cards · 85 spaces left", { exact: true }),
    ).toHaveCount(6);
    const fixture = database<{ sourceId: string; vaultId: string }>(`
      const vault=await p.inventoryLocation.findFirstOrThrow({where:{name:${JSON.stringify(name)}}});
      const source=await p.inventoryLocation.create({data:{name:${JSON.stringify(name + " source")},normalizedName:${JSON.stringify((name + " source").toLowerCase())},ownerPlayerId:vault.ownerPlayerId,type:'Box'}});
      const cards=await p.card.findMany({take:2,orderBy:{id:'asc'}});
      if(cards.length!==2) throw new Error('Needs two cached printings');
      for(const [i,quantity] of [10,100].entries()) await p.inventoryItem.create({data:{currentOwnerId:vault.ownerPlayerId,originalOpenerId:vault.ownerPlayerId,cardId:cards[i].id,quantity,condition:'NM',sourceType:'MANUAL',notes:${JSON.stringify(name)},locationId:source.id}});
      await p.inventoryItem.create({data:{currentOwnerId:vault.ownerPlayerId,originalOpenerId:vault.ownerPlayerId,cardId:cards[0].id,quantity:68,condition:'NM',sourceType:'MANUAL',notes:${JSON.stringify(name)},locationId:vault.id,locationSection:'Sect 0'}});
      return {sourceId:source.id,vaultId:vault.id};
    `);
    const otherOwnerId = database<string>(`
      const owner=await p.player.create({data:{name:${JSON.stringify(privateName)},displayName:${JSON.stringify(privateName)}}});
      await p.inventoryLocation.create({data:{name:${JSON.stringify(privateName)},normalizedName:${JSON.stringify(privateName.toLowerCase())},ownerPlayerId:owner.id,type:'Vault',visibility:'PRIVATE'}});
      return owner.id;
    `);
    await page.goto(`/inventory?ownerId=${otherOwnerId}`);
    expect(await page.content()).not.toContain(privateName);
    await page.goto(
      `/inventory?locationId=${fixture.sourceId}&displayMode=exact`,
    );
    const selected = page.locator('tbody input[type="checkbox"]');
    await expect(selected).toHaveCount(2);
    await selected.nth(0).check();
    await selected.nth(1).check();
    const picker = page.getByTestId("storage-destination");
    await picker.getByLabel("Find destination").fill(name);
    await picker
      .getByLabel("Destination location", { exact: true })
      .selectOption(fixture.vaultId);
    await picker.getByRole("button", { name: /Sect 0.*68 \/ 85/ }).click();
    await page
      .getByRole("button", { name: "Fill remaining space", exact: true })
      .click();
    await expect(page.getByLabel("Maximum copies to move")).toHaveValue("17");
    await expect(picker.getByText(/85 after move/)).toBeVisible();
    await picker.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/vault-desktop.png" });
    await page
      .getByRole("button", { name: "Move selected", exact: true })
      .click();
    await expect(page.getByText(/Moved 17 cards across/)).toBeVisible();
    await page.goto("/locations");
    await vaultGroup.locator("summary").first().click();
    await expect(
      sections.getByText("85 / 85 cards · full", { exact: true }),
    ).toBeVisible();

    // Remaining source is one partial stack; advisory overflow never disables move.
    await page.goto(
      `/inventory?locationId=${fixture.sourceId}&displayMode=exact`,
    );
    await expect(selected).toHaveCount(1);
    await selected.first().check();
    await picker
      .getByLabel("Destination location", { exact: true })
      .selectOption(fixture.vaultId);
    await picker.getByRole("button", { name: /Sect 0.*85 \/ 85/ }).click();
    await page.getByRole("button", { name: "85 copies", exact: true }).click();
    await expect(picker.getByText(/All cards may not fit/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Move selected", exact: true }),
    ).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await picker.scrollIntoViewIfNeeded();
    expect(
      await picker.evaluate((el) => el.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "test-results/vault-phone.png" });
    await page
      .getByRole("button", { name: "Move selected", exact: true })
      .click();
    await expect(page.getByText(/Moved 85 cards across/)).toBeVisible();
    const total = database<number>(
      `return (await p.inventoryItem.aggregate({where:{notes:${JSON.stringify(name)}},_sum:{quantity:true}}))._sum.quantity;`,
    );
    expect(total).toBe(178);
    await page.goto("/locations");
    await vaultGroup.locator("summary").first().click();
    await expect(
      sections.getByText("170 / 85 cards · 85 over capacity", { exact: true }),
    ).toBeVisible();
    await sections.screenshot({
      path: "test-results/vault-occupancy-phone.png",
    });
    expect(
      await sections.evaluate((el) => el.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(390);
    database(`
      const source=await p.inventoryLocation.findUniqueOrThrow({where:{id:${JSON.stringify(fixture.sourceId)}}});
      const cards=await p.card.findMany({take:12,orderBy:{id:'asc'}});
      await p.inventoryItem.createMany({data:cards.map(card=>({currentOwnerId:source.ownerPlayerId,originalOpenerId:source.ownerPlayerId,cardId:card.id,quantity:1,condition:'NM',sourceType:'MANUAL',notes:${JSON.stringify(name)},locationId:source.id}))});
      return true;
    `);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(
      `/inventory?locationId=${fixture.sourceId}&displayMode=exact&pageSize=10`,
    );
    await expect(selected).toHaveCount(10);
    await page
      .getByRole("button", { name: "Select all matching filters", exact: true })
      .click();
    await expect(page.getByText(/12 entries.*20 cards/).first()).toBeVisible();
  } finally {
    database(`
      const locations=await p.inventoryLocation.findMany({where:{name:{in:[${JSON.stringify(name)},${JSON.stringify(name + " source")},${JSON.stringify(privateName)}]}}});
      const ids=locations.map(l=>l.id);
      const items=await p.inventoryItem.findMany({where:{locationId:{in:ids}},select:{id:true}});
      await p.inventoryAuditLog.deleteMany({where:{OR:[{inventoryItemId:{in:items.map(i=>i.id)}},...ids.map(id=>({changeType:'location_created',afterJson:{path:['id'],equals:id}}))]}});
      await p.inventoryItem.deleteMany({where:{locationId:{in:ids}}});
      await p.inventoryLocation.deleteMany({where:{id:{in:ids}}});
      await p.player.deleteMany({where:{name:${JSON.stringify(privateName)}}});
      return {removedTestLocations:ids.length};
    `);
  }
});
