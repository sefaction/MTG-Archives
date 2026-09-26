import { expect, test, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
const quote = JSON.stringify;

function database<T>(body: string): T {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8",
    timeout: 30_000,
  }));
}

test("desktop Deck Add card and Analysis return have bounded task actions", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires disposable local snapshot");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(90_000);
  const tag = `ui-deck-actions-${randomUUID()}`;
  const password = randomUUID();
  let actions = 0;
  const act = async (action: () => Promise<unknown>) => { await action(); actions++; };
  const firstFold = async (control: Locator, height: number) => {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
  };

  try {
    const deckId = database<string>(`const owner=await p.player.create({data:{name:${quote(tag)},displayName:${quote(tag)}}});
      const user=await p.user.create({data:{username:${quote(tag)},displayName:'Deck task reviewer',playerId:owner.id,passwordHash:await require('bcryptjs').hash(${quote(password)},10)}});
      const card=await p.card.findFirstOrThrow({where:{name:'Forest'},orderBy:{id:'asc'}});
      const deck=await p.deck.create({data:{ownerUserId:user.id,name:'Task deck',format:'COMMANDER',visibility:'PRIVATE',cards:{create:{cardId:card.id,cardName:card.name,quantity:99,section:'MAINBOARD'}}}});
      return deck.id;`);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    await page.goto(`/decks/${deckId}`);
    const add = page.getByRole("button", { name: "Add card", exact: true });
    const analysis = page.getByRole("navigation", { name: "Deck tools" }).getByRole("link", { name: "Analysis", exact: true });
    const cards = page.locator("#deck-workspace").getByRole("button", { name: "Forest", exact: true }).first();
    for (const control of [add, analysis, cards]) await firstFold(control, 768);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const control of [add, analysis, cards]) await firstFold(control, 900);
    await page.setViewportSize({ width: 1366, height: 768 });

    await act(() => add.click());
    const dialog = page.getByRole("dialog", { name: "Add card", exact: true });
    await expect(dialog).toBeVisible();
    await act(() => dialog.getByLabel("Search for a card or printing").fill("Llanowar Elves"));
    await act(() => dialog.locator(".max-h-80 button").filter({ has: page.getByText("Llanowar Elves", { exact: true }) }).first().click());
    await act(() => dialog.getByLabel("Quantity", { exact: true }).fill("2"));
    await act(() => dialog.getByRole("button", { name: "Add selected printing" }).click());
    await expect.poll(() => database<number>(`return (await p.deckCard.aggregate({where:{deckId:${quote(deckId)}},_sum:{quantity:true}}))._sum.quantity;`)).toBe(101);
    await act(() => page.keyboard.press("Escape"));
    await expect(add).toBeFocused();
    await act(() => analysis.click());
    await expect(page.getByRole("heading", { level: 1, name: "Task deck" })).toBeVisible();
    await act(() => page.getByRole("link", { name: "Back to deck", exact: false }).click());
    await expect(page).toHaveURL(new RegExp(`/decks/${deckId}$`));
    await expect(add).toBeVisible();
    expect(database<number>(`return (await p.deckCard.aggregate({where:{deckId:${quote(deckId)}},_sum:{quantity:true}}))._sum.quantity;`)).toBe(101);
    expect(actions).toBe(8);
    console.log(`Scripted Deck control actions: ${actions}; login and direct deck entry excluded`);
  } finally {
    database(`const owner=await p.player.findFirst({where:{name:${quote(tag)}}});if(owner){await p.user.deleteMany({where:{playerId:owner.id}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:owner.id}});await p.player.delete({where:{id:owner.id}});}return true;`);
  }
});
