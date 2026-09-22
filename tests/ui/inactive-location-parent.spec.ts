import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
const quote = JSON.stringify;
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Inactive location fixture failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}

test("inactive child metadata preserves its parent and supports explicit reparenting", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(90_000);
  const tag = `ui-inactive-parent-${randomUUID()}`,
    password = randomUUID();
  try {
    const fixture = database<{
      parent: string;
      child: string;
      destination: string;
    }>(`
      return p.$transaction(async tx=>{
        const tag=${quote(tag)}, passwordHash=await require('bcryptjs').hash(${quote(password)},10);
        const owner=await tx.player.create({data:{name:tag,displayName:tag}});
        await tx.user.create({data:{username:tag,displayName:tag,passwordHash,playerId:owner.id}});
        const parent=await tx.inventoryLocation.create({data:{name:'Archived shelf',normalizedName:'archived shelf',ownerPlayerId:owner.id,active:false}});
        const child=await tx.inventoryLocation.create({data:{name:'Archived box',normalizedName:'archived box',ownerPlayerId:owner.id,parentLocationId:parent.id,active:false}});
        const destination=await tx.inventoryLocation.create({data:{name:'Current shelf',normalizedName:'current shelf',ownerPlayerId:owner.id}});
        return {parent:parent.id,child:child.id,destination:destination.id};
      });`);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto(
      `/locations?selected=${fixture.child}&edit=${fixture.child}`,
    );
    const detail = page.getByRole("article", { name: "Selected location" });
    const editor = detail.locator("form").filter({
      has: page.getByRole("button", { name: "Save location", exact: true }),
    });
    // Submit metadata before checking the picker so the baseline exposes the actual mutation.
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Archived metadata updated");
    await editor
      .getByRole("button", { name: "Save location", exact: true })
      .click();
    await expect(detail).toContainText("Archived metadata updated");
    expect(
      database<{ parentLocationId: string; active: boolean }>(
        `return p.inventoryLocation.findUniqueOrThrow({where:{id:${quote(fixture.child)}},select:{parentLocationId:true,active:true}});`,
      ),
    ).toEqual({ parentLocationId: fixture.parent, active: false });
    const parent = editor.locator('select[name="parentLocationId"]');
    await expect(parent).toHaveValue(fixture.parent);
    await expect(
      parent.locator(`option[value="${fixture.parent}"]`),
    ).toContainText("Inactive");
    await editor.getByLabel("Search parent options").fill("no matches");
    await expect(parent).toHaveValue(fixture.parent);
    await editor.getByLabel("Search parent options").fill("");
    await parent.selectOption(fixture.destination);
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Explicit reparent saved");
    await editor
      .getByRole("button", { name: "Save location", exact: true })
      .click();
    await expect(parent).toHaveValue(fixture.destination);
    await expect(detail).toContainText("Explicit reparent saved");
    await expect(
      parent.locator(`option[value="${fixture.parent}"]`),
    ).toHaveCount(0);
    expect(
      database<string>(
        `return (await p.inventoryLocation.findUniqueOrThrow({where:{id:${quote(fixture.child)}}})).parentLocationId;`,
      ),
    ).toBe(fixture.destination);
    await parent.selectOption("");
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Top-level move saved");
    await editor
      .getByRole("button", { name: "Save location", exact: true })
      .click();
    await expect(
      detail.getByRole("heading", { name: "Archived box", exact: true }),
    ).toBeVisible();
    await expect(detail).toContainText("Top-level move saved");
    expect(
      database<string | null>(
        `return (await p.inventoryLocation.findUniqueOrThrow({where:{id:${quote(fixture.child)}}})).parentLocationId;`,
      ),
    ).toBeNull();
  } finally {
    database(`const owners=await p.player.findMany({where:{name:${quote(tag)}}});const ids=owners.map(x=>x.id);
      await p.inventoryAuditLog.deleteMany({where:{changedByUser:{username:${quote(tag)}}}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids},parentLocationId:{not:null}}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids}}});
      await p.user.deleteMany({where:{playerId:{in:ids}}});await p.player.deleteMany({where:{id:{in:ids}}});return true;`);
  }
});
