import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

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

for (const sourceType of ["MANUAL", "ACQUISITION"] as const) {
  test(`owned ${sourceType} Inventory edit, split, audit and delete preserve copy accounting`, async ({
    page,
    baseURL,
  }) => {
    test.skip(
      process.env.MTG_LOCAL_PILOT_TEST !== "1",
      "Requires disposable local data",
    );
    expect(baseURL).toBe("http://127.0.0.1:13001");
    test.setTimeout(120_000);
    const tag = `ui-mutation-${randomUUID()}`;
    const password = randomUUID();
    try {
      database(`return p.$transaction(async tx=>{
      const tag=${quote(tag)}, passwordHash=await require('bcryptjs').hash(${quote(password)},10);
      const card=await tx.card.findUniqueOrThrow({where:{scryfallId:'a32261f2-164f-4433-bc4c-b5ac591e6a59'}});
      const owner=await tx.player.create({data:{name:tag,displayName:'Mutation reviewer'}});
      await tx.user.create({data:{username:tag,displayName:'Mutation reviewer',passwordHash,playerId:owner.id}});
      const source=await tx.inventoryLocation.create({data:{name:tag+' source',normalizedName:(tag+' source').toLowerCase(),ownerPlayerId:owner.id,type:'Box'}});
      const destination=await tx.inventoryLocation.create({data:{name:tag+' destination',normalizedName:(tag+' destination').toLowerCase(),ownerPlayerId:owner.id,type:'Box'}});
      await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:${sourceType === "ACQUISITION" ? "null" : "owner.id"},locationId:source.id,quantity:4,condition:'NM',language:'EN',sourceType:${quote(sourceType)}}});
      return {sourceId:source.id,destinationId:destination.id};
    });`);

      await page.goto("/login");
      await page.getByLabel(/username or email/i).fill(tag);
      await page.getByLabel(/^password$/i).fill(password);
      await page.getByRole("button", { name: /^log in$/i }).click();
      await page.waitForURL(/\/dashboard/);
      await page.goto(
        "/inventory?cardName=Hanweir&displayMode=exact" +
          (sourceType === "ACQUISITION" ? "&source=scan" : ""),
      );
      await expect(page.getByText("Hanweir Battlements").first()).toBeVisible();

      await page
        .getByLabel(/actions for Hanweir Battlements/i)
        .first()
        .click();
      await page.getByRole("button", { name: "Edit inventory" }).click();
      await expect(
        page.getByRole("heading", { name: "Edit Inventory Item" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Notes", exact: true })
        .fill("acceptance edit");
      await page.getByRole("button", { name: "Save stack" }).click();
      await expect(page.getByText("Inventory stack updated.")).toBeVisible();

      await page.reload();
      await page
        .getByLabel(/actions for Hanweir Battlements/i)
        .first()
        .click();
      await page.getByRole("button", { name: "Edit inventory" }).click();
      await page.getByRole("button", { name: "Split", exact: true }).click();
      await page.getByRole("spinbutton", { name: "Split quantity" }).fill("1");
      await page
        .getByRole("combobox", { name: "New location" })
        .selectOption({ label: `${tag} destination` });
      await page
        .getByRole("textbox", { name: "Notes for split stack" })
        .fill("acceptance split");
      await page.getByRole("button", { name: "Split stack" }).click();
      await expect(
        page.getByText("Inventory stack split.").first(),
      ).toBeVisible();

      const state = database<{
        quantities: number[];
        notes: string[];
        auditReasons: string[];
        openers: (string | null)[];
        sources: string[];
      }>(`
      const owner=await p.player.findUniqueOrThrow({where:{name:${quote(tag)}}});
      const items=await p.inventoryItem.findMany({where:{currentOwnerId:owner.id},orderBy:{quantity:'asc'}});
      const logs=await p.inventoryAuditLog.findMany({where:{inventoryItemId:{in:items.map(i=>i.id)}}});
      return {quantities:items.map(i=>i.quantity),notes:items.map(i=>i.notes),auditReasons:logs.map(l=>l.reason),openers:items.map(i=>i.originalOpenerId),sources:items.map(i=>i.sourceType)};
    `);
      expect(state.quantities).toEqual([1, 3]);
      expect(state.sources).toEqual([sourceType, sourceType]);
      if (sourceType === "ACQUISITION")
        expect(state.openers).toEqual([null, null]);
      else expect(state.openers.every(Boolean)).toBe(true);
      expect(state.notes).toContain("acceptance split");
      expect(state.auditReasons).toContain("Inventory stack edit.");
      expect(state.auditReasons).toContain("Inventory stack split.");

      await page.reload();
      await page
        .getByLabel(/actions for Hanweir Battlements/i)
        .first()
        .click();
      await page.getByRole("button", { name: "View details" }).click();
      await page.getByRole("button", { name: "Audit Trail" }).click();
      await expect(
        page.getByRole("heading", { name: "Audit Trail" }),
      ).toBeVisible();
      await expect(page.getByText("Inventory stack edit.")).toBeVisible();
      await expect(
        page.getByText("Inventory stack split.").first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "Close" }).click();

      await page.reload();
      await page
        .getByLabel(/actions for Hanweir Battlements/i)
        .first()
        .click();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Delete inventory" }).click();
      await expect(
        page.getByText(/deleted .*inventory/i).first(),
      ).toBeVisible();
      const remaining = database<number>(
        `const owner=await p.player.findUniqueOrThrow({where:{name:${quote(tag)}}});return p.inventoryItem.count({where:{currentOwnerId:owner.id}});`,
      );
      expect(remaining).toBe(0);
    } finally {
      database(`const owner=await p.player.findUnique({where:{name:${quote(tag)}}});if(owner){
      const user=await p.user.findUnique({where:{username:${quote(tag)}}});
      const items=await p.inventoryItem.findMany({where:{currentOwnerId:owner.id},select:{id:true}});
      await p.inventoryAuditLog.deleteMany({where:{OR:[{changedByUserId:user?.id},{inventoryItemId:{in:items.map(i=>i.id)}}]}});
      await p.inventoryItem.deleteMany({where:{currentOwnerId:owner.id}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:owner.id}});
      await p.user.deleteMany({where:{username:${quote(tag)}}});
      await p.player.delete({where:{id:owner.id}});
    }return true;`);
    }
  });
}
