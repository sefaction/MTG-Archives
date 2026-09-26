import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
const quote = JSON.stringify;
function db<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Storage layout fixture failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30000,
    }),
  );
}

test("guided storage copies type defaults, preserves overrides and placements, and filters live", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  const tag = `ui-storage-layout-${randomUUID()}`,
    password = randomUUID();
  try {
    const fixture = db<{ ownerId: string; legacyId: string }>(`
      const owner=await p.player.create({data:{name:${quote(tag)},displayName:'Storage layout owner'}});
      await p.user.create({data:{username:${quote(tag)},displayName:'Storage layout reviewer',playerId:owner.id,passwordHash:await require('bcryptjs').hash(${quote(password)},10)}});
      const legacy=await p.inventoryLocation.create({data:{ownerPlayerId:owner.id,name:'Legacy box',normalizedName:'legacy box',type:'Box'}});
      const card=await p.card.findFirstOrThrow({where:{name:'Forest'}});
      await p.inventoryItem.create({data:{currentOwnerId:owner.id,originalOpenerId:owner.id,cardId:card.id,quantity:20,condition:'NM',sourceType:'MANUAL',locationId:legacy.id,locationSection:'Old label',notes:${quote(tag)}}});
      return {ownerId:owner.id,legacyId:legacy.id};
    `);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/locations?view=types");
    await expect(
      page
        .getByRole("navigation", { name: "Location views" })
        .getByRole("link", { name: "Location types", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByText("Create location type", { exact: true }).click();
    const typeForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "Create type", exact: true }),
    });
    await typeForm.getByLabel("Type name").fill(tag);
    await typeForm
      .getByRole("button", { name: "Divided into sections" })
      .click();
    await typeForm.getByLabel("Number of sections").fill("2");
    await typeForm.getByLabel("Name prefix").fill("Row");
    await typeForm.getByLabel("Cards per section (optional)").fill("50");
    await typeForm.getByRole("button", { name: "Generate sections" }).click();
    await typeForm.getByLabel("Section 1 name", { exact: true }).fill("Front");
    await typeForm.getByLabel("Section 2 name", { exact: true }).fill("Back");
    await typeForm
      .getByRole("button", { name: "Create type", exact: true })
      .click();
    await expect(typeForm.getByRole("status")).toHaveText(
      "Type defaults saved.",
    );

    async function createLocation(name: string, firstCapacity?: string) {
      await page
        .getByRole("link", { name: "Create location", exact: true })
        .click();
      const wizard = page.getByRole("form", {
        name: "Create location",
        exact: true,
      });
      await wizard.getByLabel("Name", { exact: true }).fill(name);
      await wizard
        .getByRole("combobox", { name: "Location type", exact: true })
        .selectOption(tag);
      await wizard
        .getByRole("button", { name: "Continue", exact: true })
        .click();
      await expect(
        wizard.getByLabel("Section 1 name", { exact: true }),
      ).toHaveValue("Front");
      if (firstCapacity)
        await wizard
          .getByLabel("Section 1 capacity", { exact: true })
          .fill(firstCapacity);
      await wizard
        .getByRole("button", { name: "Continue", exact: true })
        .click();
      await expect(wizard).toContainText("2 default sections");
      expect(
        db<number>(
          `return p.inventoryLocation.count({where:{ownerPlayerId:${quote(fixture.ownerId)},name:${quote(name)}}});`,
        ),
      ).toBe(0);
      await wizard.getByRole("button", { name: "Back", exact: true }).click();
      if (firstCapacity)
        await expect(
          wizard.getByLabel("Section 1 capacity", { exact: true }),
        ).toHaveValue(firstCapacity);
      await wizard
        .getByRole("button", { name: "Continue", exact: true })
        .click();
      await wizard
        .getByRole("button", { name: "Create Location", exact: true })
        .click();
      await expect(
        page
          .getByRole("article", { name: "Selected location" })
          .getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      return new URL(page.url()).searchParams.get("selected")!;
    }
    const customId = await createLocation("Custom box", "10");
    const detail = page.getByRole("article", { name: "Selected location" });
    await expect(
      detail.getByRole("link", { name: /Front, 0 \/ 10 cards/ }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/storage-layout-custom.png" });
    await detail.getByRole("link", { name: "Manage", exact: true }).click();
    await detail
      .getByText("Storage layout and capacity", { exact: true })
      .click();
    await detail.getByLabel("Section 2 name", { exact: true }).fill("Front");
    await detail
      .getByRole("button", { name: "Save location", exact: true })
      .click();
    await expect(detail.getByRole("alert")).toContainText(
      "Section names must be unique",
    );
    await expect(
      detail.getByLabel("Section 2 name", { exact: true }),
    ).toHaveValue("Front");
    await detail.getByLabel("Section 2 name", { exact: true }).fill("Back");
    await detail
      .getByRole("button", { name: "Save location", exact: true })
      .click();
    await expect(detail.getByRole("alert")).toHaveCount(0);

    // Editing the shared type affects new locations, never a saved location snapshot.
    await page
      .getByRole("link", { name: "Location types", exact: true })
      .click();
    const typeCard = page
      .locator("details")
      .filter({ has: page.getByText(tag, { exact: true }) });
    await typeCard.locator("summary").first().click();
    await typeCard.getByLabel("Section 1 capacity", { exact: true }).fill("80");
    await typeCard.getByRole("button", { name: "Save type defaults" }).click();
    await expect(typeCard.getByRole("status")).toHaveText(
      "Type defaults saved.",
    );
    const secondId = await createLocation("Default box");
    expect(
      db<number>(
        `return (await p.inventoryLocation.findUniqueOrThrow({where:{id:${quote(customId)}}})).storageLayout.sections[0].capacity;`,
      ),
    ).toBe(10);
    expect(
      db<number>(
        `return (await p.inventoryLocation.findUniqueOrThrow({where:{id:${quote(secondId)}}})).storageLayout.sections[0].capacity;`,
      ),
    ).toBe(80);

    // Existing placements are not renamed when configuring a previously unbounded location.
    await page.goto(
      `/locations?selected=${fixture.legacyId}&edit=${fixture.legacyId}`,
    );
    await detail
      .getByText("Storage layout and capacity", { exact: true })
      .click();
    await detail
      .getByRole("button", { name: "One space", exact: true })
      .click();
    await detail
      .getByLabel("Location capacity (cards)", { exact: true })
      .fill("15");
    await detail
      .getByRole("button", { name: "Save location", exact: true })
      .click();
    await expect(detail).toContainText("20 / 15 cards capacity");
    await expect(detail).toContainText("over capacity");
    expect(
      db<string>(
        `return (await p.inventoryItem.findFirstOrThrow({where:{notes:${quote(tag)}}})).locationSection;`,
      ),
    ).toBe("Old label");

    await page.goto("/locations");
    const results = page.locator("[data-location-result]");
    await page.getByLabel("Search locations", { exact: true }).fill("Custom");
    await expect(results).toHaveCount(1); // No submit click.
    await expect(results.first()).toContainText("Custom box");
    await page.getByLabel("Search locations", { exact: true }).fill("");
    await expect(results).toHaveCount(4);
    await page
      .getByRole("combobox", { name: "Space", exact: true })
      .selectOption("available");
    await expect(results).toHaveCount(2);
    await expect(results).not.toContainText(["Legacy box", "Unassigned"]);
    await page
      .getByRole("combobox", { name: "Type", exact: true })
      .selectOption(tag);
    await expect(results).toHaveCount(2);
    await page
      .getByRole("combobox", { name: "Space", exact: true })
      .selectOption("full");
    await expect(results).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Type", exact: true })
      .selectOption("");
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText("Legacy box");
    await page
      .getByRole("combobox", { name: "Space", exact: true })
      .selectOption("unknown");
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText("Unassigned");

    // New capacity is visible in the shared inventory move picker and stays advisory.
    await page.goto(
      `/inventory?locationId=${fixture.legacyId}&displayMode=exact`,
    );
    await page.locator('tbody input[type="checkbox"]').first().check();
    await page
      .getByRole("button", { name: "Move cards…", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Move inventory" });
    const picker = dialog.getByTestId("storage-destination");
    await picker
      .getByRole("combobox", { name: "Search destinations" })
      .fill("Custom box");
    await picker.getByRole("option").click();
    await picker.getByRole("button", { name: /Front.*0 \/ 10/ }).click();
    await expect(picker.getByText(/All cards may not fit/)).toBeVisible();
    await dialog
      .getByRole("button", { name: "Move 20 cards", exact: true })
      .click();
    await expect(page.getByText(/Moved 20 cards across/)).toBeVisible();
    expect(
      db<number>(
        `return (await p.inventoryItem.aggregate({where:{currentOwnerId:${quote(fixture.ownerId)}},_sum:{quantity:true}}))._sum.quantity;`,
      ),
    ).toBe(20);

    await page.goto(`/inventory?locationId=${customId}&displayMode=exact`);
    await page.locator('tbody input[type="checkbox"]').first().check();
    const selectedCopies = page.getByRole("spinbutton", {
      name: "Copies selected from Forest",
    });
    await expect(selectedCopies).toHaveValue("20");
    await selectedCopies.fill("15");
    await page
      .getByRole("button", { name: "Move cards…", exact: true })
      .click();
    await picker
      .getByRole("combobox", { name: "Search destinations" })
      .fill("Legacy box");
    await picker.getByRole("option").click();
    await expect(dialog.getByText("15 physical copies")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Move 15 cards", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

    // Wizard reflow with actual defaults, including large text and the light theme.
    await page.goto("/imports");
    await page.getByRole("link", { name: "Add card", exact: true }).click();
    const importPicker = page
      .locator('[data-testid="storage-destination"]:visible')
      .first();
    await importPicker
      .getByRole("button", { name: "Change", exact: true })
      .click();
    await importPicker
      .getByRole("combobox", { name: "Search destinations" })
      .fill("Custom box");
    await importPicker.getByRole("option").click();
    await expect(
      importPicker.getByRole("button", { name: /Front.*20 \/ 10/ }),
    ).toBeVisible();
    await importPicker.getByRole("button", { name: /Front.*20 \/ 10/ }).click();
    await expect(importPicker.getByText(/All cards may not fit/)).toBeVisible();
    // Preview only: no import or manual-add submission.
    await page.goto("/locations?panel=create");
    const wizard = page.getByRole("form", {
      name: "Create location",
      exact: true,
    });
    await wizard.getByLabel("Name", { exact: true }).fill("Preview only");
    await wizard
      .getByRole("combobox", { name: "Location type", exact: true })
      .selectOption(tag);
    await wizard.getByRole("button", { name: "Continue", exact: true }).click();
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/storage-layout-wizard-${width}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "azorius";
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/storage-layout-wizard-enlarged.png",
      fullPage: true,
    });
  } finally {
    db(`const owners=await p.player.findMany({where:{name:${quote(tag)}}});const ids=owners.map(x=>x.id);
      await p.inventoryAuditLog.deleteMany({where:{changedByUser:{username:${quote(tag)}}}});
      await p.inventoryItem.deleteMany({where:{currentOwnerId:{in:ids}}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids},parentLocationId:{not:null}}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids}}});
      await p.locationType.deleteMany({where:{createdByUser:{username:${quote(tag)}}}});
      await p.user.deleteMany({where:{playerId:{in:ids}}});await p.player.deleteMany({where:{id:{in:ids}}});return true;`);
  }
});
