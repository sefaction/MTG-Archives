import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

test.skip(
  process.env.MTG_LOCAL_PILOT_TEST !== "1",
  "Disposable local Docker snapshot only",
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

test("advanced manual playtest persists safely and never writes authoritative card state", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  expect(baseURL).toBe("http://127.0.0.1:13001");
  const tag = `ui-playtest-${randomUUID()}`;
  const password = randomUUID();
  try {
    const fixture = database<{
      deckId: string;
      userId: string;
      cards: { id: string; cardName: string }[];
    }>(`
      const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);
      const user=await p.user.create({data:{username:${JSON.stringify(tag)},displayName:'Playtest fixture',passwordHash:hash}});
      const deck=await p.deck.create({data:{ownerUserId:user.id,name:'Advanced playtest fixture',format:'COMMANDER',visibility:'PRIVATE',cards:{create:Array.from({length:80},(_,i)=>({cardName:'Fixture Card '+String(i).padStart(2,'0'),quantity:1,section:'MAINBOARD'}))}},include:{cards:true}});
      return {deckId:deck.id,userId:user.id,cards:deck.cards.map(({id,cardName})=>({id,cardName}))};
    `);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    const path = `/decks/${fixture.deckId}/playtest`;
    await page.goto(path);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
        writes.push(request.method());
    });
    const saved = async () =>
      page.evaluate(
        () =>
          Object.entries(localStorage).find(([key]) =>
            key.startsWith("mtg:playtest:v1:"),
          )?.[1] ?? "",
      );
    await expect.poll(saved).not.toBe("");
    const distantId = JSON.parse(await saved()).state.zones.library[65].entryId;
    const distantName = fixture.cards.find(
      (card) => card.id === distantId,
    )!.cardName;
    await page.getByText("Search library", { exact: true }).click();
    await page.getByLabel("Search library cards").fill(distantName);
    const library = page.getByRole("region", { name: "Library", exact: true });
    await expect(library.getByText(distantName, { exact: true })).toBeVisible();
    await library
      .getByRole("button", { name: "Battlefield", exact: true })
      .click();
    const battlefield = page.getByRole("region", {
      name: "Battlefield",
      exact: true,
    });
    await expect(battlefield.locator("article")).toHaveCount(1);
    await battlefield.getByRole("button", { name: "Edit details" }).click();
    const editor = page.getByRole("dialog");
    await editor.getByLabel("Group label").fill("Mana sources");
    await editor
      .getByRole("button", { name: "Add named counter", exact: true })
      .click();
    await editor.getByRole("button", { name: "power +1", exact: true }).click();
    await editor.getByLabel("X position").focus();
    await page.keyboard.press("ArrowRight");
    await editor.getByRole("button", { name: "Create temporary copy" }).click();
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await expect(battlefield.locator("article")).toHaveCount(2);
    await expect(
      battlefield.getByText("Mana sources", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Battlefield layout").selectOption("free");
    await battlefield.locator("article").first().focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(
        async () =>
          JSON.parse(await saved()).state.zones.battlefield[0].position.x,
      )
      .toBe(6);
    await page.getByLabel("Battlefield layout").selectOption("grouped");
    await page
      .getByText("Tokens, library and random tools", { exact: true })
      .click();
    await page.getByLabel("Token name").fill("1/1 Soldier");
    await page
      .getByRole("button", { name: "Create token", exact: true })
      .click();
    await expect(battlefield.locator("article")).toHaveCount(3);
    await page.getByRole("button", { name: "Roll die", exact: true }).click();
    await expect(page.getByText(/^d6: [1-6]$/)).toBeVisible();
    await page.getByRole("button", { name: "Flip coin", exact: true }).click();
    await expect(page.getByText(/^(Heads|Tails)$/)).toBeVisible();
    await page.getByRole("button", { name: "Surveil", exact: true }).click();
    const revealed = page.getByLabel("Revealed library cards");
    await expect(
      revealed.getByRole("button", { name: "Put in graveyard" }),
    ).toHaveCount(3);
    await revealed
      .getByRole("button", { name: "Put in graveyard" })
      .first()
      .click();
    await expect(
      revealed.getByRole("button", { name: "Put in graveyard" }),
    ).toHaveCount(2);
    await revealed.getByRole("button", { name: "Put bottom" }).first().click();
    await revealed.getByRole("button", { name: "Done looking" }).click();
    await battlefield.getByRole("checkbox").nth(0).check();
    await battlefield.getByRole("checkbox").nth(1).check();
    await page.getByLabel("Move selected cards to").selectOption("exile");
    await page
      .getByRole("button", { name: "Move selected", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Exile", exact: true })
        .locator("article"),
    ).toHaveCount(2);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(battlefield.locator("article")).toHaveCount(3);
    await page
      .getByText("Players and commander damage (0)", { exact: true })
      .click();
    await page.getByLabel("New player name").fill("Opponent One");
    await page.getByRole("button", { name: "Add player panel" }).click();
    await page.getByLabel("Player life", { exact: true }).fill("27");
    await page.getByLabel("Commander damage source").fill("Esika");
    await page.getByRole("button", { name: "Add damage", exact: true }).click();
    await expect(page.getByText("Esika: 1", { exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export playtest" }).click();
    const download = await downloadPromise;
    const exported = readFileSync((await download.path())!, "utf8");
    expect(JSON.parse(exported).version).toBe(1);
    await page.reload();
    await expect(battlefield.locator("article")).toHaveCount(3);
    await expect(
      page.getByText("Restored this device's saved playtest."),
    ).toBeVisible();
    await page
      .getByLabel("Import playtest file")
      .setInputFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"version":99}'),
      });
    await expect(
      page.getByText(/Invalid or unsupported playtest file/),
    ).toBeVisible();
    await expect(battlefield.locator("article")).toHaveCount(3);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Clear saved session" }).click();
    await expect(battlefield.locator("article")).toHaveCount(0);
    await expect.poll(saved).toBe("");
    await page
      .getByLabel("Import playtest file")
      .setInputFiles({
        name: "valid.json",
        mimeType: "application/json",
        buffer: Buffer.from(exported),
      });
    await expect(battlefield.locator("article")).toHaveCount(3);
    await page.setViewportSize({ width: 390, height: 844 });
    await battlefield
      .locator("article")
      .first()
      .getByRole("button", { name: "Edit details" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    ).toBe(false);
    await page.screenshot({ path: "test-results/playtest-phone-editor.png" });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.getByLabel("Battlefield layout").selectOption("free");
    await battlefield.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    ).toBe(false);
    await page.screenshot({ path: "test-results/playtest-phone-board.png" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await battlefield.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/playtest-desktop.png" });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Resume device saving" }).click();
    await expect.poll(saved).not.toBe("");
    const before = await saved();
    database(
      `await p.deckCard.update({where:{id:${JSON.stringify(fixture.cards[0]!.id)}},data:{quantity:2}});return true;`,
    );
    await page.reload();
    await expect(page.getByText(/different or changed deck/)).toBeVisible();
    expect(await saved()).toBe(before);
    expect(writes).toEqual([]);
    expect(
      database<number>(
        `return p.deckCard.count({where:{deckId:${JSON.stringify(fixture.deckId)}}});`,
      ),
    ).toBe(80);
    await page.context().clearCookies();
    await page.goto(path);
    await expect(page.getByText(/This page could not be found/)).toBeVisible();
  } finally {
    database(
      `await p.user.deleteMany({where:{username:${JSON.stringify(tag)}}});return true;`,
    );
  }
});
