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
  page.setDefaultTimeout(15_000);
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
    await page
      .getByRole("link", { name: "Create location", exact: true })
      .click();
    const create = page.getByRole("form", {
      name: "Create location",
      exact: true,
    });
    await create.locator('input[name="name"]').fill(name);
    await create
      .getByRole("combobox", { name: "Location type", exact: true })
      .selectOption({ label: "Vault" });
    await create.getByRole("button", { name: "Continue", exact: true }).click();
    await create.getByRole("button", { name: "Continue", exact: true }).click();
    await create
      .getByRole("button", { name: "Create Location", exact: true })
      .click();
    const sections = page.getByLabel(`${name} sections`, { exact: true });
    await expect(sections).toBeVisible();
    await expect(
      sections.getByRole("link", {
        name: /^Sect [0-5], 0 \/ 85 cards · 85 spaces left\. Browse cards\.$/,
      }),
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
    const openMove = page.getByRole("button", {
      name: "Move cards…",
      exact: true,
    });
    await openMove.click();
    const dialog = page.getByRole("dialog", { name: "Move inventory" });
    const picker = dialog.getByTestId("storage-destination");
    const search = picker.getByRole("combobox", {
      name: "Search destinations",
    });
    await search.fill("no-matching-destination");
    await expect(picker.getByText(/No destinations found/)).toBeVisible();
    await search.press("Enter");
    await expect(dialog).toBeVisible();
    await search.fill(name + " source");
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(
      dialog.getByRole("button", { name: "Move 0 cards", exact: true }),
    ).toBeDisabled();
    await picker.getByRole("button", { name: "Change", exact: true }).click();
    await search.fill(name);
    // A single searchable control replaces the disconnected search + select.
    await expect(picker.locator("select")).toHaveCount(0);
    await picker.getByRole("option").filter({ hasText: "Vault ·" }).click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(openMove).toBeFocused();
    await expect(selected.nth(0)).toBeChecked();
    await openMove.click();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await openMove.click();
    await picker.getByRole("button", { name: /Sect 0.*68 \/ 85/ }).click();
    await page.getByRole("button", { name: /^Fill remaining space/ }).click();
    await expect(page.getByLabel("Maximum copies to move")).toHaveValue("17");
    await expect(picker.getByText(/85 after move/)).toBeVisible();
    await picker.getByRole("button", { name: /Sect 1.*0 \/ 85/ }).click();
    await expect(page.getByLabel("Maximum copies to move")).toHaveValue("85");
    await picker.getByRole("button", { name: /Sect 0.*68 \/ 85/ }).click();
    await expect(page.getByLabel("Maximum copies to move")).toHaveValue("17");
    await picker
      .getByRole("button", { name: "+ Custom section", exact: true })
      .click();
    await picker
      .getByRole("textbox", { name: "Section name" })
      .fill("Temporary section");
    await expect(
      picker.locator('input[name="destinationLocationSection"]'),
    ).toHaveValue("Temporary section");
    await picker.getByRole("button", { name: /Sect 0.*68 \/ 85/ }).click();
    await picker.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/vault-desktop.png" });
    // Stale selection errors stay inside the panel and do not discard selection.
    database(
      `await p.inventoryItem.updateMany({where:{locationId:${JSON.stringify(fixture.sourceId)},quantity:100},data:{quantity:101}}); return true;`,
    );
    await dialog
      .getByRole("button", { name: "Move 17 cards", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("changed since");
    await expect(dialog).toBeVisible();
    database(
      `await p.inventoryItem.updateMany({where:{locationId:${JSON.stringify(fixture.sourceId)},quantity:101},data:{quantity:100}}); return true;`,
    );
    await page
      .getByRole("button", { name: "Move 17 cards", exact: true })
      .click();
    await expect(page.getByText(/Moved 17 cards across/)).toBeVisible();
    await page.goto(`/locations?selected=${fixture.vaultId}`);
    await expect(
      sections.getByRole("link", {
        name: "Sect 0, 85 / 85 cards · full. Browse cards.",
        exact: true,
      }),
    ).toBeVisible();

    // Remaining source is one partial stack; advisory overflow never disables move.
    await page.goto(
      `/inventory?locationId=${fixture.sourceId}&displayMode=exact`,
    );
    await expect(selected).toHaveCount(1);
    await selected.first().check();
    await openMove.click();
    await search.fill(name);
    await picker.getByRole("option").filter({ hasText: "Vault ·" }).click();
    await picker.getByRole("button", { name: /Sect 0.*85 \/ 85/ }).click();
    await picker.getByLabel("Only sections with room").check();
    await expect(picker.getByRole("button", { name: /Sect 0/ })).toHaveCount(0);
    await picker.getByLabel("Only sections with room").uncheck();
    await page.getByRole("button", { name: "85 copies", exact: true }).click();
    await expect(picker.getByText(/All cards may not fit/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Move 85 cards", exact: true }),
    ).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog
      .getByRole("button", { name: "Custom amount", exact: true })
      .click();
    await dialog.getByLabel("Maximum copies to move").fill("");
    await expect(
      dialog.getByRole("button", { name: "Move 0 cards", exact: true }),
    ).toBeDisabled();
    await dialog.getByLabel("Maximum copies to move").fill("10");
    await expect(
      dialog.getByRole("button", { name: "Move 10 cards", exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: "test-results/vault-phone-quantity.png" });
    await dialog
      .getByRole("button", { name: "85 copies", exact: true })
      .click();
    await picker.scrollIntoViewIfNeeded();
    expect(
      await picker.evaluate((el) => el.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "test-results/vault-phone.png" });
    const confirmBounds = await dialog
      .getByRole("button", { name: "Move 85 cards", exact: true })
      .boundingBox();
    expect(confirmBounds!.y + confirmBounds!.height).toBeLessThanOrEqual(844);
    await page
      .getByRole("button", { name: "Move 85 cards", exact: true })
      .click();
    await expect(page.getByText(/Moved 85 cards across/)).toBeVisible();
    const total = database<number>(
      `return (await p.inventoryItem.aggregate({where:{notes:${JSON.stringify(name)}},_sum:{quantity:true}}))._sum.quantity;`,
    );
    expect(total).toBe(178);
    await page.goto(`/locations?selected=${fixture.vaultId}`);
    await expect(
      sections.getByRole("link", {
        name: "Sect 0, 170 / 85 cards · 85 over capacity. Browse cards.",
        exact: true,
      }),
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
    await openMove.click();
    await expect(
      dialog.getByText(/12 entries.*20 cards/).first(),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const tableRows = page.locator("tbody tr");
    const checked = page.locator('tbody input[type="checkbox"]:checked');
    await tableRows.nth(1).locator("td").nth(2).click();
    await expect(checked).toHaveCount(1);
    await tableRows
      .nth(3)
      .locator("td")
      .nth(2)
      .click({ modifiers: ["Control"] });
    await expect(checked).toHaveCount(2);
    await tableRows
      .nth(1)
      .locator("td")
      .nth(2)
      .click({ modifiers: ["Control"] });
    await expect(checked).toHaveCount(1);
    await tableRows
      .nth(6)
      .locator("td")
      .nth(2)
      .click({ modifiers: ["Shift"] });
    await expect(checked).toHaveCount(6);
    await tableRows
      .nth(4)
      .locator("td")
      .nth(2)
      .click({ modifiers: ["Shift"] });
    await expect(checked).toHaveCount(4);
    await tableRows
      .nth(8)
      .locator("td")
      .nth(2)
      .click({ modifiers: ["Control", "Shift"] });
    await expect(checked).toHaveCount(8);
    await tableRows.nth(4).locator("td").nth(2).click();
    await selected.nth(0).click();
    await selected.nth(2).click({ modifiers: ["Shift"] });
    await expect(checked).toHaveCount(4);
    await tableRows.nth(6).focus();
    await page.keyboard.press("Shift+Space");
    await expect(checked).toHaveCount(7);
    await page
      .getByRole("button", { name: "Clear selection", exact: true })
      .click();
    await expect(checked).toHaveCount(0);
    await tableRows
      .nth(3)
      .locator("td")
      .nth(2)
      .click({ modifiers: ["Shift"] });
    await expect(checked).toHaveCount(1);
    await tableRows
      .nth(1)
      .locator("td")
      .nth(1)
      .getByRole("button")
      .click({ modifiers: ["Control"] });
    await expect(checked).toHaveCount(2);
    await tableRows
      .nth(4)
      .locator("td")
      .nth(1)
      .getByRole("button")
      .click({ modifiers: ["Shift"] });
    await expect(checked).toHaveCount(4);
    await expect(
      page.getByRole("button", { name: "Close", exact: true }),
    ).toHaveCount(0);
    await tableRows.nth(3).locator("td").nth(2).click();
    await page
      .getByRole("button", { name: "Binder View", exact: true })
      .click();
    const binderChecks = page.locator('input[aria-label^="Select "]');
    const binderChecked = page.locator('input[aria-label^="Select "]:checked');
    await expect(binderChecks).toHaveCount(10);
    await binderChecks.nth(0).click();
    await binderChecks
      .nth(1)
      .locator("..")
      .getByRole("button")
      .click({ modifiers: ["Control"] });
    await expect(binderChecked).toHaveCount(3);
    await binderChecks
      .nth(4)
      .locator("..")
      .getByRole("button")
      .click({ modifiers: ["Shift"] });
    await expect(binderChecked).toHaveCount(4);
    await binderChecks.nth(2).locator("..").getByRole("button").click();
    await expect(binderChecked).toHaveCount(4);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Table View", exact: true }).click();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(selected).toHaveCount(2);
    await expect(checked).toHaveCount(0);
    await page.goto("/imports");
    await page.getByRole("link", { name: "Add card", exact: true }).click();
    const manualPicker = page.getByTestId("storage-destination").first();
    await manualPicker
      .getByRole("button", { name: "Change", exact: true })
      .click();
    await manualPicker
      .getByRole("combobox", { name: "Search destinations" })
      .fill(name);
    await manualPicker
      .getByRole("option")
      .filter({ hasText: "Vault ·" })
      .click();
    await manualPicker.getByRole("button", { name: /Sect 2.*0 \/ 85/ }).click();
    await expect(manualPicker.locator('input[name="locationId"]')).toHaveValue(
      fixture.vaultId,
    );
    await expect(
      manualPicker.locator('input[name="locationSection"]'),
    ).toHaveValue("Sect 2");
    await page.getByLabel("Quantity", { exact: true }).fill("5");
    await expect(manualPicker.getByText(/5 after move/)).toBeVisible();
  } finally {
    // Fixture cleanup also runs after a failed assertion or interrupted browser step.
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
