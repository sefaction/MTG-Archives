import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
const quote = JSON.stringify;
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Imports workspace fixture failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}
async function noOverflow(page: Page) {
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    )
  ) {
    console.log(
      await page.evaluate(() =>
        [...document.querySelectorAll("main *, nav *")]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return (
              box.width > 0 &&
              box.right > innerWidth + 1 &&
              !element.closest(".overflow-x-auto")
            );
          })
          .slice(0, 15)
          .map((element) => ({
            tag: element.tagName,
            classes: element.className,
            right: element.getBoundingClientRect().right,
          })),
      ),
    );
    await page.screenshot({ path: "test-results/imports-overflow.png" });
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("Imports separates tasks and preserves upload, review, commit, history and owner boundaries", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(210_000);
  const tag = `ui-imports-workspace-${randomUUID()}`,
    password = randomUUID();
  try {
    const fixture = database<{
      owner: string;
      destination: string;
      card: {
        id: string;
        scryfallId: string;
        setCode: string;
        collectorNumber: string;
      };
      longBatch: string;
      lastItem: string;
      foreignBatch: string;
    }>(`
      return p.$transaction(async tx=>{
        const tag=${quote(tag)}, passwordHash=await require('bcryptjs').hash(${quote(password)},10);
        const owner=await tx.player.create({data:{name:tag,displayName:'Import reviewer'}});
        const other=await tx.player.create({data:{name:tag+'-other',displayName:tag+'-other'}});
        const user=await tx.user.create({data:{username:tag,displayName:'Import reviewer',passwordHash,playerId:owner.id,role:'ADMIN'}});
        const destination=await tx.inventoryLocation.create({data:{name:'Import shelf',normalizedName:'import shelf',ownerPlayerId:owner.id,type:'Vault'}});
        const card=await tx.card.findFirstOrThrow({where:{name:'Forest'},select:{id:true,scryfallId:true,setCode:true,collectorNumber:true}});
        await tx.inventoryItem.create({data:{cardId:card.id,currentOwnerId:owner.id,originalOpenerId:owner.id,locationId:destination.id,locationSection:'Sect 0',quantity:2,sourceType:'MANUAL',condition:'NM',language:'EN',foilStatus:'NONFOIL'}});
        const longBatch=await tx.importBatch.create({data:{filename:'Long review fixture.csv',importType:'inventory_csv:add',selectedPlayerId:owner.id,selectedOriginalOpenerId:owner.id,createdByUserId:user.id,status:'PREVIEW',totalRows:120}});
        let lastItem;
        for(let i=0;i<120;i++) lastItem=await tx.importBatchItem.create({data:{importBatchId:longBatch.id,rowNumber:i+2,status:'matched',cardPrintingId:card.id,parsedFoilStatus:'NONFOIL',parsedCondition:'NM',rawRowJson:{Name:'Forest',Quantity:3},parsedRowJson:{name:'Forest',quantity:3,foilStatus:'NONFOIL',condition:'NM',language:'EN',setCode:card.setCode,collectorNumber:card.collectorNumber}}});
        const foreignBatch=await tx.importBatch.create({data:{filename:'Foreign private sentinel.csv',importType:'inventory_csv:add',selectedPlayerId:other.id,selectedOriginalOpenerId:other.id,status:'PREVIEW'}});
        return {owner:owner.id,destination:destination.id,card,longBatch:longBatch.id,lastItem:lastItem.id,foreignBatch:foreignBatch.id};
      });`);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/imports");
    const tasks = page.getByRole("navigation", { name: "Import tasks" });
    await expect(
      tasks.getByRole("link", { name: "Import CSV", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("CSV file")).toBeVisible();
    expect((await page.getByLabel("CSV file").boundingBox())!.y).toBeLessThan(
      768,
    );
    await expect(
      page.getByRole("heading", { name: "Import History", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("Foreign private sentinel.csv")).toHaveCount(0);
    await page.screenshot({ path: "test-results/imports-capture-desktop.png" });
    await tasks.getByRole("link", { name: "Add card", exact: true }).click();
    await expect(
      page.getByLabel("Search by card name or printing"),
    ).toBeVisible();
    await expect(page.getByLabel("CSV file")).toHaveCount(0);
    await tasks.getByRole("link", { name: "Export", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Download CSV", exact: true }),
    ).toBeVisible();
    await tasks.getByRole("link", { name: "Import CSV", exact: true }).click();

    // Actual capture and background local-printing resolution; no inventory mutation before commit.
    const csv = `Quantity,Name,Set,Collector Number,Scryfall ID,Section\n2,Forest,${fixture.card.setCode},${fixture.card.collectorNumber},${fixture.card.scryfallId},Pocket 1\n3,Forest,${fixture.card.setCode},${fixture.card.collectorNumber},${fixture.card.scryfallId},\n`;
    await page.getByLabel("CSV file").setInputFiles({
      name: tag + ".csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page
      .getByRole("button", { name: "Preview Import", exact: true })
      .click();
    await page.waitForURL(/batchId=/);
    const batchId = new URL(page.url()).searchParams.get("batchId")!;
    const summary = page.locator("[data-import-summary]");
    await expect(summary).toContainText("2 ready rows · 5 copies");
    await expect(page.getByLabel("CSV file")).toHaveCount(0);
    const total = () =>
      database<number>(
        `return (await p.inventoryItem.aggregate({where:{currentOwnerId:${quote(fixture.owner)}},_sum:{quantity:true}}))._sum.quantity;`,
      );
    expect(total()).toBe(2);
    await page
      .getByRole("link", { name: "Review & commit", exact: true })
      .click();
    const commit = page.getByRole("form", { name: "Commit reviewed import" });
    await expect(commit).toContainText("5 physical copies from 2 ready rows");
    const picker = commit.locator('[data-testid="storage-destination"]');
    if (
      await picker
        .getByRole("button", { name: "Change", exact: true })
        .isVisible()
    )
      await picker.getByRole("button", { name: "Change", exact: true }).click();
    await picker
      .getByRole("combobox", { name: "Search destinations" })
      .fill("Import shelf");
    await picker.getByRole("option").click();
    await picker.getByRole("button", { name: /^Sect 0/ }).click();
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("5 physical copies from 2 ready rows");
      await dialog.dismiss();
    });
    await commit
      .getByRole("button", { name: "Commit Import", exact: true })
      .click();
    expect(total()).toBe(2);
    page.once("dialog", (dialog) => dialog.accept());
    await commit
      .getByRole("button", { name: "Commit Import", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: `Completed: ${tag}.csv`, exact: true }),
    ).toBeVisible();
    expect(total()).toBe(7);
    expect(
      database<number>(
        `return p.inventoryAuditLog.count({where:{changeType:'import_committed',inventoryItem:{currentOwnerId:${quote(fixture.owner)}}}});`,
      ),
    ).toBe(2);
    expect(
      database<number>(
        `return (await p.inventoryItem.aggregate({where:{currentOwnerId:${quote(fixture.owner)},locationId:${quote(fixture.destination)},locationSection:'Pocket 1'},_sum:{quantity:true}}))._sum.quantity;`,
      ),
    ).toBe(2);
    expect(
      database<number>(
        `return (await p.inventoryItem.aggregate({where:{currentOwnerId:${quote(fixture.owner)},locationId:${quote(fixture.destination)},locationSection:'Sect 0'},_sum:{quantity:true}}))._sum.quantity;`,
      ),
    ).toBe(5);
    await expect(commit).toHaveCount(0);
    await tasks.getByRole("link", { name: "History", exact: true }).click();
    await expect(
      page.getByRole("link", { name: tag + ".csv", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Import Maintenance", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Clear my import history",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(`/imports?batchId=${fixture.foreignBatch}`);
    await expect(page).toHaveURL(/\/imports$/);
    await expect(page.getByText("Foreign private sentinel.csv")).toHaveCount(0);

    // Direct review, long-table commit access and resolver return context.
    await page.goto(
      `/imports?batchId=${fixture.longBatch}&status=resolved&q=Forest&resolveItemId=${fixture.lastItem}`,
    );
    const dialog = page.getByRole("dialog", { name: "Resolve Row 121" });
    await expect(dialog).toBeVisible();
    const search = dialog.locator('form[method="get"]');
    await search
      .locator('input[name="resolverQ"]')
      .fill(`set:${fixture.card.setCode} cn:${fixture.card.collectorNumber}`);
    await search.getByRole("button", { name: "Search", exact: true }).click();
    expect(new URL(page.url()).searchParams.get("status")).toBe("resolved");
    expect(new URL(page.url()).searchParams.get("q")).toBe("Forest");
    await dialog.getByLabel("Quantity", { exact: true }).fill("4");
    await dialog
      .getByRole("button", { name: "Save Row Edits", exact: true })
      .click();
    await expect(
      dialog.getByText("Quantity: 4", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(summary).toContainText("120 ready rows · 361 copies");
    expect(new URL(page.url()).searchParams.get("q")).toBe("Forest");
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      (await page.locator("#import-review tbody tr").first().boundingBox())!.y,
    ).toBeLessThan(768);
    await page.screenshot({ path: "test-results/imports-review-top.png" });
    await page
      .getByRole("link", { name: "Review & commit", exact: true })
      .click();
    await expect(commit).toBeVisible();
    expect((await summary.boundingBox())!.height).toBeLessThan(160);
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain(
        "361 physical copies from 120 ready rows",
      );
      expect(dialog.message()).not.toContain("{selection}");
      await dialog.dismiss();
    });
    await commit
      .getByRole("button", { name: "Commit Import", exact: true })
      .click();
    expect(total()).toBe(7);

    for (const width of [1366, 1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
      await page
        .getByRole("link", { name: "Review & commit", exact: true })
        .click();
      await expect(
        commit.getByRole("button", { name: "Commit Import", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `test-results/imports-review-${width}.png`,
      });
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
      await noOverflow(page);
      const themeTextColor = await page.evaluate(
        () => getComputedStyle(document.body).color,
      );
      await expect(
        page.getByRole("link", { name: "Review & commit", exact: true }),
      ).toHaveCSS("color", themeTextColor);
      await expect(commit.getByRole("button", { name: /^Sect 0/ })).toHaveCSS(
        "color",
        themeTextColor,
      );
      if (theme === "azorius")
        await page.screenshot({
          path: "test-results/imports-review-light.png",
          animations: "disabled",
        });
    }
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "200%"),
    );
    await noOverflow(page);
    expect((await summary.boundingBox())!.height).toBeLessThan(270);
    await page.screenshot({ path: "test-results/imports-review-enlarged.png" });
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    expect(total()).toBe(7); // Long-batch review and edits never committed copies.
    expect(
      database<string>(
        `return (await p.importBatch.findUniqueOrThrow({where:{id:${quote(batchId)}}})).status;`,
      ),
    ).toBe("IMPORTED");
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/imports?view=history");
    await page
      .getByRole("button", { name: "Enter Admin Mode", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Import Maintenance", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Import CSV", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Current owner", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Exit Admin Mode", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Current owner", exact: true }),
    ).toHaveCount(0);
  } finally {
    database(`const owners=await p.player.findMany({where:{name:{in:[${quote(tag)},${quote(tag + "-other")}]}}});const ids=owners.map(x=>x.id);
      const batches=await p.importBatch.findMany({where:{selectedPlayerId:{in:ids}}});const batchIds=batches.map(x=>x.id);
      await p.importResolutionJob.deleteMany({where:{importBatchId:{in:batchIds}}});
      await p.importResolutionAttempt.deleteMany({where:{importBatchItem:{importBatchId:{in:batchIds}}}});
      await p.importBatchItem.deleteMany({where:{importBatchId:{in:batchIds}}});await p.importBatch.deleteMany({where:{id:{in:batchIds}}});
      await p.inventoryAuditLog.deleteMany({where:{changedByUser:{username:${quote(tag)}}}});
      await p.inventoryItem.deleteMany({where:{currentOwnerId:{in:ids}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids}}});
      await p.user.deleteMany({where:{playerId:{in:ids}}});await p.player.deleteMany({where:{id:{in:ids}}});
      for(const batch of batches) if(batch.filename===${quote(tag + ".csv")}) for(const base of [process.env.UPLOADS_DATA_PATH,process.env.IMPORTS_DATA_PATH]) if(base){const path=require('node:path');const target=path.resolve(base,batch.id+'-'+batch.filename);if(path.dirname(target)!==path.resolve(base))throw Error('Invalid fixture file');await require('node:fs/promises').rm(target,{force:true});}return true;`);
  }
});
