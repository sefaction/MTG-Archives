import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
const quote = JSON.stringify;
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("Dashboard, Pricing and Public expose focused tasks without leaking private scope or losing price context", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(180_000);
  const tag = `ui-browse-${randomUUID()}`,
    password = randomUUID();
  const anonymous = await browser.newContext({ baseURL });
  try {
    database(`const tag=${quote(tag)};const owner=await p.player.create({data:{name:tag,displayName:'Browse reviewer'}});
      const user=await p.user.create({data:{username:tag,displayName:'Browse reviewer',playerId:owner.id,passwordHash:await require('bcryptjs').hash(${quote(password)},10),role:'ADMIN',preferredPriceProvider:'cardmarket',inventoryDefaultVisibility:'PUBLIC'}});
      for(const [suffix,prices,quantity,visibility] of [['EUR',{mtgjson:{cardmarket:{normal:{retail:{EUR:12}}}}},3,'PUBLIC'],['Zero',{usd:'0.00'},2,'PUBLIC'],['Private',{},5,'PRIVATE']]){
        const card=await p.card.create({data:{name:tag+' '+suffix,scryfallId:require('node:crypto').randomUUID(),typeLine:'Artifact',setCode:'tst',collectorNumber:suffix,rarity:'common',prices}});
        const location=await p.inventoryLocation.create({data:{ownerPlayerId:owner.id,name:tag+' '+suffix,normalizedName:(tag+' '+suffix).toLowerCase(),visibility}});
        await p.inventoryItem.create({data:{currentOwnerId:owner.id,originalOpenerId:owner.id,cardId:card.id,quantity,condition:'NM',locationId:location.id,sourceType:'MANUAL'}});
      }
      for(const visibility of ['PUBLIC','PRIVATE'])await p.deck.create({data:{ownerUserId:user.id,name:tag+' '+visibility,visibility}});
      return true;`);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    await expect(
      page.getByRole("region", { name: "Your collection and trades" }),
    ).toContainText("10");
    await page
      .getByRole("button", { name: "Enter Admin Mode", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Admin overview" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your collection and trades" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Exit Admin Mode", exact: true })
      .click();

    await page.goto("/pricing");
    const tasks = page.getByRole("navigation", { name: "Pricing tasks" });
    await expect(
      tasks.getByRole("link", { name: "Collection value", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", {
        name: "Meaningful daily changes in your cards",
      }),
    ).toHaveCount(0);
    const values = page.getByRole("region", {
      name: "Value by location table",
      exact: true,
    });
    await expect(
      values.getByRole("row").filter({ hasText: tag + " EUR" }),
    ).toContainText("Unavailable");
    await expect(
      values.getByRole("row").filter({ hasText: tag + " Zero" }),
    ).toContainText("$0.00");
    await expect(
      page.getByText(/8 copies without a usable USD price/),
    ).toBeVisible();
    await page.goto(
      "/pricing?view=market&provider=cardmarket&currency=EUR&finish=foil&range=30",
    );
    await expect(
      page.getByRole("heading", {
        name: "Meaningful daily changes in your cards",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Value by location" }),
    ).toHaveCount(0);
    await page
      .getByText("Price source and movement threshold", { exact: false })
      .click();
    await page.getByLabel("Minimum percent", { exact: true }).fill("20");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/currency=EUR/);
    const applied = new URL(page.url());
    expect(applied.searchParams.get("view")).toBe("market");
    expect(applied.searchParams.get("finish")).toBe("foil");
    expect(applied.searchParams.get("provider")).toBe("cardmarket");
    await tasks.getByRole("link", { name: "Data status", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Provider coverage" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/currency=EUR/);

    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
      for (const [name, path] of [
        ["dashboard", "/dashboard"],
        ["collection", "/pricing"],
        ["market", "/pricing?view=market"],
        ["data", "/pricing?view=data"],
        ["public", "/public"],
        ["public-decks", "/public/decks"],
      ]) {
        await page.goto(path);
        await noOverflow(page);
        if (name === "market") {
          const table = page.getByRole("region", {
            name: "Top gainers table",
            exact: true,
          });
          await table.focus();
          await expect(table).toBeFocused();
        }
        if (width !== 320)
          await page.screenshot({
            path: `test-results/browse-${name}-${width}.png`,
            fullPage: true,
          });
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/public/decks");
    const publicNav = page.getByRole("navigation", { name: "Public browsing" });
    await expect(
      publicNav.getByRole("link", { name: "Public decks", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      publicNav.getByRole("link", { name: "Back to my dashboard" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Search decks", exact: true })
      .fill(tag);
    const decks = page.getByRole("region", { name: "Deck library results" });
    await expect(decks).toContainText(tag + " PUBLIC");
    await expect(decks).not.toContainText(tag + " PRIVATE");
    await expect(
      page.getByRole("button", { name: "Create deck", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Cards", exact: true }).click();
    await expect(decks).toContainText(tag + " PUBLIC");
    for (const theme of [
      "golgari",
      "azorius",
      "rakdos",
      "lotus",
      "selesnya",
      "izzet",
    ]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await noOverflow(page);
      await expect(
        publicNav.getByRole("link", { name: "Public decks", exact: true }),
      ).toHaveCSS(
        "color",
        await page.evaluate(() => getComputedStyle(document.body).color),
      );
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await noOverflow(page);
    await page.screenshot({
      path: "test-results/browse-public-enlarged.png",
      fullPage: true,
    });

    const anon = await anonymous.newPage();
    await anon.setViewportSize({ width: 390, height: 844 });
    await anon.goto("/public/decks");
    await anon
      .getByRole("textbox", { name: "Search decks", exact: true })
      .fill(tag);
    await expect(
      anon.getByRole("region", { name: "Deck library results" }),
    ).toContainText(tag + " PUBLIC");
    await expect(
      anon.getByRole("region", { name: "Deck library results" }),
    ).not.toContainText(tag + " PRIVATE");
    await expect(
      anon.getByRole("link", { name: "Back to my dashboard" }),
    ).toHaveCount(0);
    await expect(
      anon.getByRole("link", { name: "Log in", exact: true }),
    ).toBeVisible();
    await anon.goto(`/public/inventory?name=${encodeURIComponent(tag)}`);
    await expect(
      anon.getByRole("heading", { name: "Public inventory", exact: true }),
    ).toBeVisible();
    await expect(
      anon
        .getByRole("navigation", { name: "Public browsing" })
        .getByRole("link", { name: "Public inventory", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      anon.getByRole("button", {
        name: /bulk delete|save changes|move selected/i,
      }),
    ).toHaveCount(0);
    await noOverflow(anon);
    expect(
      database<number>(
        `return (await p.inventoryItem.aggregate({where:{currentOwner:{name:${quote(tag)}}},_sum:{quantity:true}}))._sum.quantity;`,
      ),
    ).toBe(10);
  } finally {
    await anonymous.close();
    database(`const owner=await p.player.findUnique({where:{name:${quote(tag)}}});if(owner){
      await p.deck.deleteMany({where:{ownerUser:{playerId:owner.id}}});await p.inventoryItem.deleteMany({where:{currentOwnerId:owner.id}});
      await p.inventoryLocation.deleteMany({where:{ownerPlayerId:owner.id}});await p.user.deleteMany({where:{playerId:owner.id}});await p.player.delete({where:{id:owner.id}});
      await p.card.deleteMany({where:{name:{startsWith:${quote(tag)}}}});}return true;`);
  }
});
