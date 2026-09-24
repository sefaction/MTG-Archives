import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });

function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}

test("Public inventory shares browse tasks without exposing private inventory", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(150_000);
  const tag = `ui-public-parity-${randomUUID()}`;
  const password = randomUUID();
  const quote = JSON.stringify;
  const anonymous = await browser.newContext({ baseURL });
  try {
    database(`return p.$transaction(async tx=>{
      const tag=${quote(tag)};
      const owner=await tx.player.create({data:{name:tag+'-owner',displayName:'Public parity owner'}});
      const viewer=await tx.player.create({data:{name:tag+'-viewer',displayName:'Public parity viewer'}});
      await tx.user.create({data:{username:tag+'-owner',displayName:'Public parity owner',playerId:owner.id,passwordHash:await require('bcryptjs').hash(${quote(password)},10),inventoryDefaultVisibility:'PUBLIC'}});
      const viewerUser=await tx.user.create({data:{username:tag+'-viewer',displayName:'Public parity viewer',playerId:viewer.id,passwordHash:await require('bcryptjs').hash(${quote(password)},10)}});
      await tx.deck.create({data:{ownerUserId:viewerUser.id,name:tag+' deck'}});
      for(const [suffix,visibility] of [['Public','PUBLIC'],['Private','PRIVATE']]){
        const card=await tx.card.create({data:{name:tag+' '+suffix,scryfallId:require('node:crypto').randomUUID(),typeLine:'Artifact',setCode:'tst',collectorNumber:suffix,rarity:'common',prices:{}}});
        const location=await tx.inventoryLocation.create({data:{ownerPlayerId:owner.id,name:tag+' '+suffix,normalizedName:(tag+' '+suffix).toLowerCase(),visibility}});
        await tx.inventoryItem.create({data:{currentOwnerId:owner.id,originalOpenerId:owner.id,cardId:card.id,quantity:2,condition:'NM',locationId:location.id,sourceType:'MANUAL'}});
      }
      return true;
    });`);

    const anon = await anonymous.newPage();
    await anon.setViewportSize({ width: 1366, height: 768 });
    await anon.goto(`/public/inventory?cardName=${encodeURIComponent(tag)}`);
    await expect(
      anon.getByRole("heading", { name: "Public inventory" }),
    ).toBeVisible();
    await expect(anon.locator(".inventory-workspace")).toBeVisible();
    await expect(anon.locator(".inventory-result-summary")).toContainText(
      "public copies on this page",
    );
    await expect(anon.locator(".inventory-results")).toContainText(
      `${tag} Public`,
    );
    await expect(anon.locator(".inventory-results")).not.toContainText(
      `${tag} Private`,
    );
    await expect(
      anon.getByRole("button", {
        name: /move selected|bulk delete|save changes/i,
      }),
    ).toHaveCount(0);

    const filterButton = anon.getByRole("button", {
      name: /advanced inventory search/i,
    });
    await filterButton.click();
    const panel = anon.getByRole("dialog", { name: "Filter inventory" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Card" })).toBeVisible();
    await anon
      .getByRole("combobox", { name: "Quick card name search" })
      .fill(`${tag} Public`);
    await expect(panel.locator('input[name="cardName"]')).toHaveValue(
      `${tag} Public`,
    );
    await panel.getByRole("button", { name: "Close filters" }).click();

    await anon.goto("/public/inventory?cardName=no-matching-public-card-zz");
    await expect(
      anon.getByText("No public cards match these filters."),
    ).toBeVisible();
    await anon.getByRole("link", { name: "Clear filters" }).click();
    await expect(anon).not.toHaveURL(/cardName=/);

    for (const width of [390, 320]) {
      await anon.setViewportSize({ width, height: 844 });
      await anon.goto(`/public/inventory?cardName=${encodeURIComponent(tag)}`);
      await expect(
        anon.getByRole("heading", { name: "Public inventory" }),
      ).toBeVisible();
      expect(
        await anon.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const trigger = anon.getByRole("button", {
        name: /advanced inventory search/i,
      });
      await trigger.click();
      await expect(
        anon.getByRole("dialog", { name: "Filter inventory" }),
      ).toBeVisible();
      await anon.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    }

    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(`${tag}-viewer`);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    await page.goto(`/public/inventory?cardName=${encodeURIComponent(tag)}`);
    await expect(page.locator(".inventory-workspace")).toBeVisible();
    await expect(page.locator(".inventory-results")).toContainText(
      `${tag} Public`,
    );
    await expect(page.locator(".inventory-results")).not.toContainText(
      `${tag} Private`,
    );
    await expect(
      page.getByRole("button", {
        name: /move selected|bulk delete|save changes/i,
      }),
    ).toHaveCount(0);
  } finally {
    await anonymous.close();
    database(`const tag=${quote(tag)};const players=await p.player.findMany({where:{name:{startsWith:tag}},select:{id:true}});const ids=players.map(x=>x.id);
      await p.deck.deleteMany({where:{ownerUser:{playerId:{in:ids}}}});
      await p.inventoryItem.deleteMany({where:{currentOwnerId:{in:ids}}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids}}});
      await p.user.deleteMany({where:{playerId:{in:ids}}});
      await p.player.deleteMany({where:{id:{in:ids}}});
      await p.card.deleteMany({where:{name:{startsWith:tag}}});return true;`);
  }
});
