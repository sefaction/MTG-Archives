import { expect, test, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
const quote = JSON.stringify;

function database<T>(body: string): T {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Core task fixture failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8",
    timeout: 30_000,
  }));
}

test("desktop Inventory move and Locations edit have bounded, visible task actions", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires disposable local snapshot");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(90_000);
  const tag = `ui-actions-${randomUUID()}`;
  const password = randomUUID();
  const counts = { inventoryMove: 0, locationEdit: 0 };
  const act = async (task: keyof typeof counts, action: () => Promise<unknown>) => {
    await action();
    counts[task]++;
  };
  const firstFold = async (control: Locator) => {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(768);
  };

  try {
    database(`return p.$transaction(async tx=>{
      const tag=${quote(tag)},passwordHash=await require('bcryptjs').hash(${quote(password)},10);
      const owner=await tx.player.create({data:{name:tag,displayName:'Task reviewer'}});
      await tx.user.create({data:{username:tag,displayName:'Task reviewer',passwordHash,playerId:owner.id}});
      await tx.inventoryLocation.create({data:{name:'Aster Vault',normalizedName:'aster vault',ownerPlayerId:owner.id,type:'Vault'}});
      await tx.inventoryLocation.create({data:{name:tag+' destination',normalizedName:(tag+' destination').toLowerCase(),ownerPlayerId:owner.id,type:'Box'}});
      for(const [name,quantity] of [['Forest',8],['Island',3]]) {
        const card=await tx.card.findFirstOrThrow({where:{name},orderBy:{id:'asc'}});
        await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:owner.id,quantity,sourceType:'MANUAL',condition:'NM',language:'EN',notes:tag}});
      }
      return true;
    });`);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto("/inventory?displayMode=exact&pageSize=10");
    const quickSearch = page.getByRole("combobox", { name: "Quick card name search" });
    const search = page.getByRole("button", { name: "Search", exact: true });
    const filters = page.getByRole("button", { name: /advanced inventory search/i });
    await expect(page.locator(".inventory-results table")).toBeVisible();
    for (const control of [quickSearch, search, filters]) await firstFold(control);
    await act("inventoryMove", () => quickSearch.fill("Forest"));
    await act("inventoryMove", () => search.click());
    await expect(page).toHaveURL(/cardName=Forest/);
    await expect(page.locator(".inventory-results table")).not.toContainText("Island");
    const selectForest = page.getByRole("checkbox", { name: /^Select Forest, / });
    await act("inventoryMove", () => selectForest.check());
    const copies = page.getByRole("spinbutton", { name: /^Copies selected from Forest, / });
    await expect(copies).toHaveValue("8");
    await act("inventoryMove", () => copies.fill("5"));
    const move = page.getByRole("button", { name: "Move cards…", exact: true });
    await firstFold(move);
    await act("inventoryMove", () => move.click());
    const dialog = page.getByRole("dialog", { name: "Move inventory" });
    await expect(dialog).toBeVisible();
    const destination = dialog.getByRole("combobox", { name: "Search destinations" });
    await act("inventoryMove", () => destination.fill(`${tag} destination`));
    await act("inventoryMove", () => destination.press("ArrowDown"));
    await act("inventoryMove", () => destination.press("Enter"));
    await act("inventoryMove", () => dialog.getByRole("button", { name: "Move 5 cards", exact: true }).click());
    await expect(page.getByText(/Moved 5 cards across 1 entry/)).toBeVisible();
    expect(database<number>(`return (await p.inventoryItem.aggregate({where:{notes:${quote(tag)},location:{name:${quote(tag + " destination")}}},_sum:{quantity:true}}))._sum.quantity;`)).toBe(5);

    await page.goto("/locations");
    const locationSearch = page.getByLabel("Search locations", { exact: true });
    const find = page.getByRole("button", { name: "Find locations", exact: true });
    const detail = page.getByRole("article", { name: "Selected location" });
    await expect(detail.getByRole("heading", { name: "Aster Vault", exact: true })).toBeVisible();
    for (const control of [locationSearch, find, detail.locator(".locations-counts")]) await firstFold(control);
    await act("locationEdit", () => locationSearch.fill("Aster Vault"));
    await act("locationEdit", () => find.click());
    await expect(page.locator("[data-location-result]")).toHaveCount(1);
    const contextUrl = page.url();
    await act("locationEdit", () => detail.getByRole("link", { name: "Manage", exact: true }).click());
    const editor = detail.locator("form").filter({ has: page.getByRole("button", { name: "Save location", exact: true }) });
    await expect(editor).toBeVisible();
    await act("locationEdit", () => editor.getByLabel("Description", { exact: true }).fill("Task edit verified"));
    await act("locationEdit", () => editor.getByRole("button", { name: "Save location", exact: true }).click());
    await expect(detail).toContainText("Task edit verified");
    expect(new URL(page.url()).searchParams.get("q")).toBe(new URL(contextUrl).searchParams.get("q"));
    expect(new URL(page.url()).searchParams.get("selected")).toBeTruthy();
    expect(counts).toEqual({ inventoryMove: 9, locationEdit: 5 });
    console.log(`Scripted control actions: ${JSON.stringify(counts)}; login and direct task entry excluded`);
  } finally {
    database(`const users=await p.user.findMany({where:{username:${quote(tag)}},select:{id:true,playerId:true}});const ids=users.map(u=>u.id),owners=users.map(u=>u.playerId).filter(Boolean);await p.$transaction(async tx=>{await tx.inventoryItem.deleteMany({where:{currentOwnerId:{in:owners}}});await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});await tx.user.deleteMany({where:{id:{in:ids}}});await tx.player.deleteMany({where:{id:{in:owners}}});});return true;`);
  }
});
