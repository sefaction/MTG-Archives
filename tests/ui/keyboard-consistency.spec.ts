import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.skip(
  process.env.MTG_LOCAL_PILOT_TEST !== "1",
  "Requires an owned local review runtime",
);
const quote = JSON.stringify;
const target = process.env.MTG_UI_WEB_CONTAINER || "mtg-archives-web-1";
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", target, "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30000,
    }),
  );
}

for (const width of [1366, 390, 320]) {
  test(`search and deck editing respect Enter, Escape and unsaved drafts at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120000);
    expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
    const tag = `keyboard-${randomUUID()}`;
    const password = randomUUID();
    try {
      database(`const owner=await p.player.create({data:{name:${quote(tag)},displayName:${quote(tag)}}});
        const user=await p.user.create({data:{username:${quote(tag)},displayName:${quote(tag)},playerId:owner.id,passwordHash:await require('bcryptjs').hash(${quote(password)},10)}});
        const card=await p.card.create({data:{name:${quote(tag)},scryfallId:require('node:crypto').randomUUID(),typeLine:'Artifact',setCode:'tst',collectorNumber:'1',rarity:'common'}});
        await p.inventoryItem.create({data:{currentOwnerId:owner.id,originalOpenerId:owner.id,cardId:card.id,quantity:2,condition:'NM',sourceType:'MANUAL'}});
        await p.deck.create({data:{ownerUserId:user.id,name:${quote(tag + " deck")},description:'Original description',visibility:'PRIVATE'}});return true;`);
      await page.goto("/login");
      await page.getByLabel(/username or email/i).fill(tag);
      await page.getByLabel(/^password$/i).fill(password);
      await page.getByRole("button", { name: /^log in$/i }).click();
      await page.waitForURL(/dashboard/);

      await page.goto("/wishlist");
      await page
        .getByText("Add a manual wishlist card", { exact: true })
        .click();
      const search = page.getByRole("textbox", {
        name: "Card search",
        exact: true,
      });
      let requests = 0;
      page.on("request", (request) => {
        if (request.url().includes("/api/decks/card-search?")) requests++;
      });
      await search.fill(tag);
      await search.press("Enter");
      await expect(page.getByLabel("Selected printing")).toBeVisible();
      expect(requests).toBe(1);
      await expect(page.getByLabel("Selected printing")).toContainText(tag);
      await expect(search).toBeFocused();
      // Explicit Scryfall remains separate; Enter uses the same local search as its button.
      await page
        .getByRole("button", { name: "Search local", exact: true })
        .click();
      await expect.poll(() => requests).toBe(2);
      await expect(search).toBeEditable();
      await page.route("**/api/decks/card-search?**", (route) =>
        route.fulfill({ status: 503, json: { error: "Unavailable" } }),
      );
      await search.press("Enter");
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Search unavailable. Please try again." }),
      ).toBeVisible();
      await expect(search).toBeEditable();

      await page.goto("/decks");
      await page
        .getByRole("searchbox", { name: "Search decks", exact: true })
        .fill(tag);
      const opener = page.getByRole("button", { name: "Edit", exact: true });
      await opener.click();
      const editor = page.getByRole("dialog", {
        name: `Edit ${tag} deck`,
        exact: true,
      });
      await expect(editor).toBeVisible();
      const close = editor.getByRole("button", { name: "Close", exact: true });
      await expect(close).toBeFocused();
      for (const label of ["Cancel", "Save changes"]) {
        expect(
          await editor
            .getByRole("button", { name: label, exact: true })
            .evaluate((element) => element.getBoundingClientRect().height),
        ).toBeLessThan(64);
      }
      await editor.screenshot({
        path: test.info().outputPath("deck-edit.png"),
      });
      await page.keyboard.press("Shift+Tab");
      await expect(
        editor.getByRole("button", { name: "Save changes", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      const name = editor.getByRole("textbox", { name: "Name", exact: true });
      await name.fill(tag + " changed");
      page.once("dialog", (dialog) => dialog.dismiss());
      await page.keyboard.press("Escape");
      await expect(editor).toBeVisible();
      await expect(name).toHaveValue(tag + " changed");
      page.once("dialog", (dialog) => dialog.dismiss());
      await close.click();
      await expect(editor).toBeVisible();
      page.once("dialog", (dialog) => dialog.dismiss());
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(name).toHaveValue(tag + " changed");
      if (width === 1366) {
        page.once("dialog", (dialog) => dialog.dismiss());
        await page.mouse.click(2, 300);
        await expect(editor).toBeVisible();
      }
      // Restoring the original values removes the discard prompt.
      await name.fill(tag + " deck");
      await page.keyboard.press("Escape");
      await expect(editor).not.toBeVisible();
      await expect(opener).toBeFocused();
      await opener.click();
      await name.fill(tag + " discarded");
      page.once("dialog", (dialog) => dialog.accept());
      await page.keyboard.press("Escape");
      await expect(editor).not.toBeVisible();
      await expect(opener).toBeFocused();
      await opener.click();
      await name.fill(tag + " saved");
      await name.press("Enter");
      await expect(editor).not.toBeVisible();
      await expect(
        page.getByRole("region", { name: "Deck library results" }),
      ).toContainText(tag + " saved");
      expect(
        database<number>(
          `return await p.inventoryItem.aggregate({where:{currentOwner:{name:${quote(tag)}}},_sum:{quantity:true}}).then(r=>r._sum.quantity);`,
        ),
      ).toBe(2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    } finally {
      database(`const users=await p.user.findMany({where:{username:${quote(tag)}},select:{id:true,playerId:true}});for(const user of users){
        await p.deck.deleteMany({where:{ownerUserId:user.id}});
        await p.inventoryItem.deleteMany({where:{currentOwnerId:user.playerId}});
        await p.inventoryLocation.deleteMany({where:{ownerPlayerId:user.playerId}});
        await p.authSession.deleteMany({where:{userId:user.id}});
        await p.deckTag.deleteMany({where:{ownerUserId:user.id}});
        await p.user.delete({where:{id:user.id}});await p.player.delete({where:{id:user.playerId}});
      }await p.card.deleteMany({where:{name:${quote(tag)}}});return true;`);
    }
  });
}

test("Escape closes an Inventory filter popup before its parent dialog", async ({
  page,
  baseURL,
}) => {
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/public/inventory");
  const trigger = page.getByRole("button", {
    name: /advanced inventory search/i,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Filter inventory",
    exact: true,
  });
  const popup = dialog.locator('button[aria-haspopup="listbox"]').first();
  await popup.click();
  await expect(popup).toHaveAttribute("aria-expanded", "true");
  const option = dialog
    .locator('[role="listbox"]:visible')
    .getByRole("checkbox")
    .first();
  const checked = await option.isChecked();
  await option.press("Enter");
  await expect(option).toBeChecked({ checked: !checked });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toBeVisible();
  await expect(popup).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
