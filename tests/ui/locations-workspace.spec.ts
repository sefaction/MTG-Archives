import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
const quote = JSON.stringify;
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Locations workspace fixture operation failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("Locations browses first and preserves storage, management, deck and owner workflows", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const tag = `ui-locations-workspace-${randomUUID()}`,
    password = randomUUID();
  try {
    const fixture = database<{
      vaultId: string;
      childId: string;
      destinationId: string;
      foreignId: string;
      otherId: string;
      deckId: string;
      typeName: string;
    }>(`
      return p.$transaction(async tx=>{
        const tag=${quote(tag)}, passwordHash=await require('bcryptjs').hash(${quote(password)},10);
        const owner=await tx.player.create({data:{name:tag,displayName:tag}});
        const other=await tx.player.create({data:{name:tag+'-other',displayName:tag+'-other'}});
        const user=await tx.user.create({data:{username:tag,displayName:'Storage reviewer',passwordHash,playerId:owner.id,role:'ADMIN'}});
        const type=await tx.locationType.create({data:{name:tag+' type',normalizedName:tag+'-type',createdByUserId:user.id}});
        const vault=await tx.inventoryLocation.create({data:{name:'Aster Vault',normalizedName:'aster vault',ownerPlayerId:owner.id,type:'Vault',visibility:'PRIVATE'}});
        const child=await tx.inventoryLocation.create({data:{name:'Binder',normalizedName:'binder',ownerPlayerId:owner.id,parentLocationId:vault.id,type:type.name}});
        const destination=await tx.inventoryLocation.create({data:{name:'Public box',normalizedName:'public box',ownerPlayerId:owner.id,visibility:'PUBLIC'}});
        const foreign=await tx.inventoryLocation.create({data:{name:'Foreign private sentinel',normalizedName:'foreign private sentinel',ownerPlayerId:other.id,visibility:'PRIVATE',type:type.name}});
        const deck=await tx.deck.create({data:{name:'Storage test deck',ownerUserId:user.id}});
        const deckLocation=await tx.inventoryLocation.create({data:{name:'Deck: Storage test deck',normalizedName:'deck: storage test deck',ownerPlayerId:owner.id,kind:'DECK',systemManaged:true,deckId:deck.id,type:'Deck'}});
        const card=await tx.card.findFirstOrThrow({where:{name:'Forest'}});
        for(const [locationId,section,quantity] of [[vault.id,'Sect 0',68],[vault.id,'Sect 10',2],[vault.id,null,3],[child.id,'Pocket 1',7],[child.id,'Pocket 10',11],[child.id,null,2],[deckLocation.id,null,4]]) await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:owner.id,locationId,locationSection:section,quantity,sourceType:'MANUAL',condition:'NM',notes:tag}});
        return {vaultId:vault.id,childId:child.id,destinationId:destination.id,foreignId:foreign.id,otherId:other.id,deckId:deck.id,typeName:type.name};
      });
    `);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/locations");
    const detail = page.getByRole("article", { name: "Selected location" });
    const results = page.locator("[data-location-result]");
    await expect(
      detail.getByRole("heading", { name: "Aster Vault", exact: true }),
    ).toBeVisible();
    await expect(detail).toContainText("73 copies here");
    await expect(detail).toContainText("93 copies with sub-locations");
    await expect(
      page.getByRole("button", { name: "Create Location", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('select[name="parentLocationId"]')).toHaveCount(
      0,
    );
    await expect(page.locator("[data-vault-section-row]")).toHaveCount(1);
    for (const item of [
      page.getByLabel("Search locations", { exact: true }),
      results.first(),
      detail.locator(".locations-counts"),
    ]) {
      const bounds = await item.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThan(768);
    }
    await page.screenshot({
      path: "test-results/locations-workspace-desktop.png",
    });
    await noOverflow(page);

    // Full-path search, arbitrary exact sections, and browser Back retain context.
    await page
      .getByLabel("Search locations", { exact: true })
      .fill("Aster Vault / Binder");
    await page
      .getByRole("button", { name: "Find locations", exact: true })
      .click();
    await expect(results).toHaveCount(1);
    await expect(detail).toContainText("20 copies here");
    const browsingUrl = page.url();
    await detail
      .getByRole("link", { name: "Pocket 1 7 copies", exact: true })
      .click();
    expect(new URL(page.url()).searchParams.get("locationSection")).toBe(
      "Pocket 1",
    );
    expect(new URL(page.url()).searchParams.get("locationSectionMatch")).toBe(
      "exact",
    );
    await expect(page.locator("tbody")).toContainText("Forest");
    await page.goBack();
    await expect(page).toHaveURL(browsingUrl);
    await expect(detail).toContainText("20 copies here");

    // Keyboard entry to the lazy editor; descendants are not possible parents.
    await detail.getByRole("link", { name: "Manage", exact: true }).focus();
    await page.keyboard.press("Enter");
    const editor = detail.locator("form").filter({
      has: page.getByRole("button", { name: "Save location", exact: true }),
    });
    await expect(editor).toHaveCount(1);
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Binder workflow verified");
    await editor
      .getByRole("combobox", { name: "Visibility", exact: true })
      .selectOption("PRIVATE");
    await editor
      .getByRole("button", { name: "Save location", exact: true })
      .click();
    await expect(detail).toContainText("Binder workflow verified");
    await detail
      .getByRole("link", { name: "Close editor", exact: true })
      .click();
    await expect(editor).toHaveCount(0);

    // Whole-location move is scoped, same-owner, confirmed, and excludes children.
    await detail
      .getByRole("link", { name: "Move all cards", exact: true })
      .click();
    const move = page.getByRole("region", { name: "Move an entire location" });
    await expect(
      move.getByRole("button", { name: "Move entire location", exact: true }),
    ).toBeDisabled();
    await move
      .getByLabel("Search destination location options")
      .fill("Public box");
    await move
      .getByLabel("Destination location", { exact: true })
      .selectOption(fixture.destinationId);
    await expect(move).toContainText(
      "will make them visible on your public collection page",
    );
    await move
      .getByLabel("Confirm moving all cards from the source location.")
      .check();
    await move
      .getByRole("button", { name: "Move entire location", exact: true })
      .click();
    await expect(detail).toContainText("0 copies here");
    expect(
      database<number>(
        `return (await p.inventoryItem.aggregate({where:{locationId:${quote(fixture.destinationId)}},_sum:{quantity:true}}))._sum.quantity;`,
      ),
    ).toBe(20);
    expect(
      database<number>(
        `return (await p.inventoryItem.aggregate({where:{notes:${quote(tag)}},_sum:{quantity:true}}))._sum.quantity;`,
      ),
    ).toBe(97);

    // Create from the toolbar, preserve parent path, and delete only this empty fixture.
    await page
      .getByRole("link", { name: "Create location", exact: true })
      .click();
    const create = page.locator("form").filter({
      has: page.getByRole("button", { name: "Create Location", exact: true }),
    });
    await create.getByLabel("Name", { exact: true }).fill("New storage child");
    await create
      .getByLabel("Search parent location options")
      .fill("Aster Vault");
    await create
      .getByLabel("Parent location", { exact: true })
      .selectOption(fixture.vaultId);
    await create
      .getByLabel("Location type", { exact: true })
      .selectOption("Vault");
    await create
      .getByRole("button", { name: "Create Location", exact: true })
      .click();
    await expect(
      detail.getByRole("heading", {
        name: "Aster Vault / New storage child",
        exact: true,
      }),
    ).toBeVisible();
    await expect(detail.locator("[data-vault-section-row] > div")).toHaveCount(
      6,
    );
    await detail.getByRole("link", { name: "Manage", exact: true }).click();
    await detail.getByText("Danger zone", { exact: true }).click();
    await expect(
      detail.getByRole("button", { name: "Delete contents", exact: true }),
    ).toHaveCount(0);
    await detail.getByLabel("Confirm deleting this unused location.").check();
    await detail
      .getByRole("button", { name: "Delete unused location", exact: true })
      .click();
    expect(
      database<number>(
        `return p.inventoryLocation.count({where:{name:'New storage child',ownerPlayer:{name:${quote(tag)}}}});`,
      ),
    ).toBe(0);

    // Shared type deletion restrictions and deck-managed read-only separation.
    await page
      .getByRole("link", { name: "Location types", exact: true })
      .click();
    const sharedType = page
      .locator("details")
      .filter({ has: page.getByText(fixture.typeName, { exact: true }) });
    await sharedType.locator("summary").click();
    await expect(
      sharedType.getByRole("button", { name: "Delete type", exact: true }),
    ).toBeDisabled();
    await expect(sharedType).toContainText(
      "Another user has locations using this type",
    );
    await page
      .getByRole("navigation", { name: "Location views" })
      .getByRole("link", { name: /^Deck locations/ })
      .click();
    await expect(
      page.getByRole("link", { name: "Open deck", exact: true }),
    ).toHaveAttribute("href", `/decks/${fixture.deckId}`);
    await expect(
      page.getByText("Read-only here · Managed from each deck", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Manage", exact: true }),
    ).toHaveCount(0);

    // Explicit inaccessible IDs cannot expose another owner's private location.
    await page.goto(
      `/locations?selected=${fixture.foreignId}&edit=${fixture.foreignId}`,
    );
    await expect(detail).toHaveCount(0);
    expect(await page.content()).not.toContain("Foreign private sentinel");

    // Admin mode retains a deliberate boundary and owner-filtered parent choices.
    await page
      .getByRole("button", { name: "Enter Admin Mode", exact: true })
      .click();
    await expect(
      detail.getByRole("heading", {
        name: "Foreign private sentinel",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Create location", exact: true })
      .click();
    await expect(
      create.getByRole("combobox", { name: "Owner", exact: true }),
    ).toHaveValue(fixture.otherId);
    const parentOptions = create
      .getByLabel("Parent location", { exact: true })
      .locator("option");
    expect(await parentOptions.allTextContents()).not.toContain("Aster Vault");
    await page
      .getByRole("button", { name: "Exit Admin Mode", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Enter Admin Mode", exact: true }),
    ).toBeVisible();

    // Phones, theme tokens and enlarged text contain only the six-section tray's scroll.
    await page.goto(`/locations?selected=${fixture.vaultId}`);
    await page.addStyleTag({
      content:
        "*, *::before, *::after { transition: none !important; animation: none !important; }",
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page);
      await page.screenshot({
        path: `test-results/locations-workspace-phone-${width}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const theme of [
      "azorius",
      "golgari",
      "rakdos",
      "lotus",
      "selesnya",
      "izzet",
    ]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await noOverflow(page);
      if (theme === "azorius" || theme === "izzet")
        await page.screenshot({
          path: `test-results/locations-workspace-${theme}.png`,
        });
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await noOverflow(page);
    await expect(
      detail.getByRole("link", { name: "Browse cards", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/locations-workspace-enlarged.png",
      fullPage: true,
    });
  } finally {
    database(`const owners=await p.player.findMany({where:{name:{in:[${quote(tag)},${quote(tag + "-other")}]}}});const ids=owners.map(x=>x.id);
      await p.inventoryAuditLog.deleteMany({where:{changedByUser:{username:${quote(tag)}}}});
      await p.inventoryItem.deleteMany({where:{currentOwnerId:{in:ids}}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids},parentLocationId:{not:null}}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids}}});
      await p.deck.deleteMany({where:{ownerUser:{username:${quote(tag)}}}});
      await p.locationType.deleteMany({where:{OR:[{createdByUser:{username:${quote(tag)}}},{name:${quote(tag + " type")}}]}});
      await p.user.deleteMany({where:{playerId:{in:ids}}});await p.player.deleteMany({where:{id:{in:ids}}});return true;`);
  }
});
