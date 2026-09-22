import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.skip(
  process.env.MTG_LOCAL_PILOT_TEST !== "1",
  "Requires disposable local Docker snapshot",
);
const quote = JSON.stringify;
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 60_000,
    }),
  );
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("builder keeps cards visible, tasks keyboard accessible and views permission safe", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  expect(baseURL).toBe("http://127.0.0.1:13001");
  const tag = `ui-deck-workspace-${randomUUID()}`;
  const password = randomUUID();
  try {
    const fixture = database<{
      deck: string;
      empty: string;
      publicDeck: string;
      owner: string;
    }>(`
      const owner=await p.player.create({data:{name:${quote(tag)},displayName:${quote(tag)}}});
      const user=await p.user.create({data:{username:${quote(tag)},displayName:${quote(tag)},playerId:owner.id,passwordHash:await require('bcryptjs').hash(${quote(password)},10)}});
      const card=await p.card.findFirstOrThrow({where:{name:'Forest'},orderBy:{id:'asc'}});
      const deck=await p.deck.create({data:{ownerUserId:user.id,name:'Workspace fixture',description:'Saved deck description',format:'COMMANDER',visibility:'PRIVATE',cards:{create:{cardId:card.id,cardName:card.name,quantity:99,section:'MAINBOARD'}}}});
      const empty=await p.deck.create({data:{ownerUserId:user.id,name:'Empty workspace',visibility:'PRIVATE'}});
      const publicDeck=await p.deck.create({data:{ownerUserId:user.id,name:'Public workspace',visibility:'PUBLIC',cards:{create:{cardId:card.id,cardName:card.name,quantity:1,section:'MAINBOARD'}}}});
      return {deck:deck.id,empty:empty.id,publicDeck:publicDeck.id,owner:owner.id};
    `);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/decks/${fixture.deck}`);
    const workspace = page.locator("#deck-workspace");
    const add = page.getByRole("button", { name: "Add card", exact: true });
    await expect(add).toBeVisible();
    expect((await workspace.boundingBox())!.y).toBeLessThan(420);
    expect(
      (await workspace
        .getByRole("button", { name: "Forest", exact: true })
        .first()
        .boundingBox())!.y,
    ).toBeLessThan(768);
    await page.screenshot({ path: "test-results/deck-workspace-desktop.png" });
    const details = page
      .locator("summary")
      .filter({ hasText: "Deck details, art" });
    await details.click();
    await expect(page.getByText("Saved deck description")).toBeVisible();
    await expect(
      page.getByText("Owned coverage", { exact: true }),
    ).toBeVisible();
    await details.click();

    // A keyboard opener is restored on Escape; Tab cannot escape the modal.
    await add.focus();
    await page.keyboard.press("Enter");
    let dialog = page.getByRole("dialog", { name: "Add card", exact: true });
    await expect(dialog).toBeVisible();
    for (let index = 0; index < 18; index++) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((node) => node.contains(document.activeElement)),
      ).toBe(true);
    }
    for (let index = 0; index < 18; index++) {
      await page.keyboard.press("Shift+Tab");
      expect(
        await dialog.evaluate((node) => node.contains(document.activeElement)),
      ).toBe(true);
    }
    await dialog
      .getByLabel("Search for a card or printing")
      .fill("Llanowar Elves");
    await dialog
      .locator(".max-h-80 button")
      .filter({ has: page.getByText("Llanowar Elves", { exact: true }) })
      .first()
      .click();
    await dialog.getByLabel("Quantity", { exact: true }).fill("2");
    await dialog.getByRole("button", { name: "Add selected printing" }).click();
    await expect
      .poll(() =>
        database<number>(
          `return (await p.deckCard.aggregate({where:{deckId:${quote(fixture.deck)}},_sum:{quantity:true}}))._sum.quantity;`,
        ),
      )
      .toBe(101);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();

    const selection = page.getByRole("button", {
      name: "Selection & printing tools",
      exact: true,
    });
    await selection.click();
    dialog = page.getByRole("dialog", {
      name: "Selection & printing tools",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "Move selected", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Select all in current view" })
      .click();
    await expect(dialog.getByText(/101 deck-list cards/)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Move selected", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Clear selection", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(selection).toBeFocused();

    await page
      .getByRole("button", { name: "Deck options", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Deck settings", exact: true });
    await expect(dialog.locator('input[name="name"]')).toBeVisible();
    await dialog
      .getByRole("button", { name: "Delete deck", exact: true })
      .click();
    const deleteForm = page
      .getByRole("dialog", { name: "Delete deck", exact: true })
      .locator("form");
    await expect(
      deleteForm.getByRole("button", { name: "Delete deck", exact: true }),
    ).toBeVisible();
    page.once("dialog", async (confirmation) => {
      await confirmation.dismiss();
    });
    await deleteForm
      .getByRole("button", { name: "Delete deck", exact: true })
      .click();
    expect(
      database<number>(
        `return p.deck.count({where:{id:${quote(fixture.deck)}}});`,
      ),
    ).toBe(1);
    await page.keyboard.press("Escape");
    await page
      .getByRole("link", { name: "Paste decklist", exact: true })
      .click();
    await expect(
      page.getByLabel("Decklist text", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Back to deck", exact: true }).click();
    for (const label of ["Analysis", "Sample Hands", "Playtest"]) {
      await page
        .getByRole("navigation", { name: "Deck tools" })
        .getByRole("link", { name: label, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { level: 1, name: "Workspace fixture" }),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "Back to deck", exact: false })
        .click();
      await expect(add).toBeVisible();
    }
    for (const value of ["text", "grid", "spoiler", "compact"]) {
      await page
        .getByRole("combobox", { name: "View", exact: true })
        .selectOption(value);
      await expect(
        workspace
          .getByRole("checkbox", { name: "Select Forest", exact: true })
          .first(),
      ).toBeVisible();
    }
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
      await add.click();
      await noOverflow(page);
      await page.screenshot({
        path: `test-results/deck-workspace-add-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await selection.click();
      await noOverflow(page);
      await page.keyboard.press("Escape");
    }
    for (const theme of [
      "golgari",
      "azorius",
      "rakdos",
      "lotus",
      "selesnya",
      "izzet",
    ]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      const color = await page.evaluate(
        () => getComputedStyle(document.body).color,
      );
      await expect(add).toHaveCSS("color", color);
      await add.click();
      await expect(page.getByRole("dialog")).toHaveCSS("color", color);
      await expect(
        page
          .getByRole("dialog")
          .getByText("No printing selected", { exact: true }),
      ).toHaveCSS("color", color);
      await noOverflow(page);
      if (theme === "azorius")
        await page.screenshot({
          path: "test-results/deck-workspace-light.png",
          animations: "disabled",
        });
      await page.keyboard.press("Escape");
    }
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "200%"),
    );
    await noOverflow(page);
    await selection.click();
    await noOverflow(page);
    await page.screenshot({ path: "test-results/deck-workspace-enlarged.png" });
    await page.keyboard.press("Escape");
    await details.click();
    await noOverflow(page);
    await details.click();
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    await page.goto(`/decks/${fixture.empty}`);
    await expect(
      page.getByText("No cards in this deck yet.", { exact: true }),
    ).toBeVisible();
    await expect(add).toBeVisible();
    expect(
      database<number>(
        `return (await p.inventoryItem.aggregate({where:{currentOwnerId:${quote(fixture.owner)}},_sum:{quantity:true}}))._sum.quantity||0;`,
      ),
    ).toBe(0);
    await page.context().clearCookies();
    expect((await page.goto(`/decks/${fixture.deck}`))?.status()).toBe(404);
    await page.goto(`/decks/${fixture.publicDeck}`);
    await expect(page.getByText(/Read-only deck view/)).toBeVisible();
    await expect(add).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Deck options", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Paste decklist", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Analysis", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Public workspace" }),
    ).toBeVisible();
  } finally {
    database(
      `const owner=await p.player.findFirst({where:{name:${quote(tag)}}});if(owner){await p.inventoryLocation.deleteMany({where:{ownerPlayerId:owner.id}});await p.user.deleteMany({where:{playerId:owner.id}});await p.player.delete({where:{id:owner.id}});}return true;`,
    );
  }
});

test("builder options and selected returns conserve committed physical copies", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  expect(baseURL).toBe("http://127.0.0.1:13001");
  const tag = `ui-deck-return-${randomUUID()}`;
  const password = randomUUID();
  try {
    const fixture = database<{
      deck: string;
      owner: string;
      destination: string;
    }>(`
      const owner=await p.player.create({data:{name:${quote(tag)},displayName:${quote(tag)}}});
      const user=await p.user.create({data:{username:${quote(tag)},displayName:${quote(tag)},playerId:owner.id,passwordHash:await require('bcryptjs').hash(${quote(password)},10)}});
      const card=await p.card.findFirstOrThrow({where:{name:'Llanowar Elves'},orderBy:{id:'asc'}});
      const deck=await p.deck.create({data:{ownerUserId:user.id,name:'Committed workspace',visibility:'PRIVATE',cards:{create:{cardId:card.id,cardName:card.name,quantity:4,section:'MAINBOARD'}}}});
      const location=await p.inventoryLocation.create({data:{ownerPlayerId:owner.id,name:'Deck fixture',normalizedName:'deck fixture',deckId:deck.id,kind:'DECK',systemManaged:true}});
      const destination=await p.inventoryLocation.create({data:{ownerPlayerId:owner.id,name:'Return destination',normalizedName:'return destination'}});
      await p.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:owner.id,locationId:location.id,quantity:4,sourceType:'MANUAL',condition:'NM'}});
      return {deck:deck.id,owner:owner.id,destination:destination.id};
    `);
    const quantities = () =>
      database<{ total: number; inDeck: number; listed: number }>(`
      const where={currentOwnerId:${quote(fixture.owner)}};
      return {total:(await p.inventoryItem.aggregate({where,_sum:{quantity:true}}))._sum.quantity||0,
        inDeck:(await p.inventoryItem.aggregate({where:{...where,location:{deckId:${quote(fixture.deck)}}},_sum:{quantity:true}}))._sum.quantity||0,
        listed:(await p.deckCard.aggregate({where:{deckId:${quote(fixture.deck)}},_sum:{quantity:true}}))._sum.quantity||0};
    `);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    await page.goto(`/decks/${fixture.deck}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("button", { name: "Deck options", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Return committed (4)", exact: true })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Return committed (4)",
      exact: true,
    });
    await dialog
      .getByLabel("Destination normal inventory location")
      .selectOption(fixture.destination);
    page.once("dialog", async (confirmation) => {
      await confirmation.dismiss();
    });
    await dialog
      .getByRole("button", { name: "Return all committed cards", exact: true })
      .click();
    expect(quantities()).toEqual({ total: 4, inDeck: 4, listed: 4 });
    await dialog
      .getByRole("button", { name: "Delete deck", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog", { name: "Delete deck", exact: true })
        .getByLabel("Type DELETE to confirm"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Selection & printing tools", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Selection & printing tools",
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Select all in current view" })
      .click();
    await expect(
      dialog.getByText(/4 deck-list cards \/ 4 physically committed/),
    ).toBeVisible();
    await dialog
      .getByLabel("Return destination")
      .selectOption(fixture.destination);
    await dialog
      .getByRole("button", {
        name: "Return selected committed cards",
        exact: true,
      })
      .click();
    await expect.poll(quantities).toEqual({ total: 4, inDeck: 0, listed: 4 });
    await expect(
      page.getByText("0 physically committed", { exact: false }).first(),
    ).toBeVisible();
  } finally {
    database(`const owner=await p.player.findFirst({where:{name:${quote(tag)}}});if(owner){
      await p.inventoryAuditLog.deleteMany({where:{changedByUser:{username:${quote(tag)}}}});
      await p.inventoryItem.deleteMany({where:{currentOwnerId:owner.id}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:owner.id}});
      await p.user.deleteMany({where:{playerId:owner.id}});await p.player.delete({where:{id:owner.id}});}return true;`);
  }
});
