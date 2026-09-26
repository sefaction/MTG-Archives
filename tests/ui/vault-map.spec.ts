import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeEach(({ baseURL }) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
});
const quote = JSON.stringify;
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Synthetic vault-map fixture operation failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}

test("visual vault retains exact placements, previews moves, refreshes counts and works on phones", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const tag = `ui-vault-map-${randomUUID()}`,
    password = randomUUID();
  try {
    const fixture = database<{
      vaultId: string;
      foreignVaultId: string;
      ownerId: string;
    }>(`
      return p.$transaction(async tx=>{
        const tag=${quote(tag)}, passwordHash=await require('bcryptjs').hash(${quote(password)},10);
        const card=await tx.card.findFirstOrThrow({where:{name:'Forest'},orderBy:{id:'asc'}});
        let vaultId,foreignVaultId,ownerId;
        for(const suffix of ['own','foreign']) {
          const name=tag+'-'+suffix;
          const owner=await tx.player.create({data:{name,displayName:name}});
          await tx.user.create({data:{username:name,displayName:name,passwordHash,playerId:owner.id}});
          const vault=await tx.inventoryLocation.create({data:{ownerPlayerId:owner.id,name:suffix==='own'?'Archive test vault':'Other private vault',normalizedName:suffix==='own'?'archive test vault':'other private vault',type:'Vault',visibility:'PRIVATE'}});
          if(suffix==='foreign'){foreignVaultId=vault.id;continue;}
          vaultId=vault.id;ownerId=owner.id;
          for(const [section,quantity] of [['Sect 1',68],['Sect 2',85],['Sect 3',90],['Sect 10',3],['Overflow',10],[null,4],['',3]])await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:owner.id,locationId:vault.id,locationSection:section,quantity,sourceType:'MANUAL',condition:'NM',notes:tag}});
        }
        return {vaultId,foreignVaultId,ownerId};
      });
    `);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(`${tag}-own`);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(
      `/inventory?locationId=${fixture.vaultId}&displayMode=exact`,
    );
    const map = page.getByRole("region", {
      name: "Archive test vault vault layout",
      exact: true,
    });
    await expect(map).toBeVisible();
    const slots = map.locator("[data-vault-section-row] > div");
    await expect(slots).toHaveCount(6);
    const layout = await slots.evaluateAll((nodes) =>
      nodes.map((n) => ({
        x: n.getBoundingClientRect().x,
        y: n.getBoundingClientRect().y,
      })),
    );
    expect(new Set(layout.map((n) => Math.round(n.y))).size).toBe(1);
    expect(layout.every((n, i) => i === 0 || n.x > layout[i - 1].x)).toBe(true);
    await expect(
      map.getByRole("link", { name: /^Sect 1,/ }),
    ).toHaveAccessibleName(/68 \/ 85 cards · 17 spaces left/);
    await expect(
      map.getByRole("link", { name: /^Sect 2,/ }),
    ).toHaveAccessibleName(/85 \/ 85 cards · full/);
    await expect(
      map.getByRole("link", { name: /^Sect 3,/ }),
    ).toHaveAccessibleName(/90 \/ 85 cards · 5 over capacity/);
    await expect(
      map.getByText("All cards may not fit.", { exact: true }),
    ).toBeVisible();
    await expect(
      map.getByRole("link", { name: "Unsectioned · 7 cards", exact: true }),
    ).toBeVisible();
    await expect(
      map.getByRole("link", { name: "Sect 10 · 3 cards", exact: true }),
    ).toBeVisible();
    await map.screenshot({ path: "test-results/vault-map-desktop.png" });
    await map.getByRole("link", { name: /^Sect 1,/ }).click();
    await expect(page).toHaveURL(/locationSectionMatch=exact/);
    const result = await (
      await page.request.get(
        `/api/inventory/list?${new URL(page.url()).searchParams}`,
      )
    ).json();
    expect(
      result.rows.reduce(
        (sum: number, row: { quantity: number }) => sum + row.quantity,
        0,
      ),
    ).toBe(68);
    const selection = page.locator('tbody input[type="checkbox"]');
    await expect(selection).toHaveCount(1);
    await selection.check();
    const selectedCopies = page.getByRole("spinbutton", {
      name: "Copies selected from Forest",
    });
    await expect(selectedCopies).toHaveValue("68");
    await selectedCopies.fill("10");
    const moveHere = map.getByRole("button", {
      name: "Move selected to Sect 0",
      exact: true,
    });
    await moveHere.click();
    const dialog = page.getByRole("dialog", { name: "Move inventory" });
    await expect(
      dialog.locator('input[name="destinationLocationSection"]'),
    ).toHaveValue("Sect 0");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(moveHere).toBeFocused();
    await expect(selection).toBeChecked();
    await expect(selectedCopies).toHaveValue("10");
    await moveHere.click();
    await expect(dialog.getByText("10 physical copies")).toBeVisible();
    await dialog
      .getByRole("button", { name: "Move 10 cards", exact: true })
      .click();
    await expect(page.getByText(/Moved 10 cards across/)).toBeVisible();
    await expect(
      map.getByRole("link", { name: /^Sect 0,/ }),
    ).toHaveAccessibleName(/10 \/ 85 cards · 75 spaces left/);
    await expect(
      map.getByRole("link", { name: /^Sect 1,/ }),
    ).toHaveAccessibleName(/58 \/ 85 cards · 27 spaces left/);
    await expect(
      map.getByRole("button", { name: /Move selected/ }),
    ).toHaveCount(0);
    await map
      .getByRole("link", { name: "Unsectioned · 7 cards", exact: true })
      .click();
    const emptyResult = await (
      await page.request.get(
        `/api/inventory/list?${new URL(page.url()).searchParams}`,
      )
    ).json();
    expect(
      emptyResult.rows.reduce(
        (sum: number, row: { quantity: number }) => sum + row.quantity,
        0,
      ),
    ).toBe(7);
    await expect(
      map.getByRole("link", { name: "Unsectioned · 7 cards", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    // The exact filter also applies to matching-selection moves, not just the initial page.
    await map
      .getByRole("link", { name: "Sect 10 · 3 cards", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Select all matching filters", exact: true })
      .click();
    await map
      .getByRole("button", { name: "Move selected to Sect 4", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: /^Move (up to )?3 cards$/ })
      .click();
    await expect(page.getByText(/Moved 3 cards across/)).toBeVisible();
    await expect(
      map.getByRole("link", { name: /^Sect 4,/ }),
    ).toHaveAccessibleName(/3 \/ 85 cards/);
    const after = database<{
      copies: number;
      sections: {
        locationSection: string | null;
        _sum: { quantity: number };
      }[];
    }>(
      `return {copies:(await p.inventoryItem.aggregate({where:{currentOwnerId:${quote(fixture.ownerId)}},_sum:{quantity:true}}))._sum.quantity,sections:await p.inventoryItem.groupBy({by:['locationSection'],where:{locationId:${quote(fixture.vaultId)}},_sum:{quantity:true}})};`,
    );
    expect(after.copies).toBe(263);
    expect(
      after.sections.find((s) => s.locationSection === "Sect 4")?._sum.quantity,
    ).toBe(3);
    expect(
      after.sections.find((s) => s.locationSection === "Overflow")?._sum
        .quantity,
    ).toBe(10);
    expect(
      after.sections.find((s) => s.locationSection === "Sect 1")?._sum.quantity,
    ).toBe(58);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/inventory?locationId=${fixture.vaultId}&locationSectionMatch=exact&locationSection=Sect+5`,
    );
    await expect(map.getByRole("link", { name: /^Sect 5,/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect
      .poll(() => map.getByRole("group").evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await map.screenshot({ path: "test-results/vault-map-phone.png" });
    await page.goto(`/locations?selected=${fixture.vaultId}`);
    await expect(map).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await map.screenshot({
      path: "test-results/vault-map-locations-phone.png",
    });
    await page.goto(`/inventory?locationId=${fixture.foreignVaultId}`);
    await expect(
      page.getByRole("region", {
        name: "Other private vault vault layout",
        exact: true,
      }),
    ).toHaveCount(0);
    const denied = await (
      await page.request.get(
        `/api/inventory/list?locationId=${fixture.foreignVaultId}&locationSectionMatch=empty`,
      )
    ).json();
    expect(denied.rows).toEqual([]);
  } finally {
    database(
      `const users=await p.user.findMany({where:{username:{startsWith:${quote(tag + "-")}}},select:{id:true,playerId:true}});const ids=users.map(u=>u.id),owners=users.map(u=>u.playerId).filter(Boolean);await p.$transaction(async tx=>{await tx.inventoryAuditLog.deleteMany({where:{changedByUserId:{in:ids}}});await tx.inventoryItem.deleteMany({where:{currentOwnerId:{in:owners}}});await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});await tx.user.deleteMany({where:{id:{in:ids}}});await tx.player.deleteMany({where:{id:{in:owners}}});});return true;`,
    );
  }
});
