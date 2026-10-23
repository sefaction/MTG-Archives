import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const container = process.env.MTG_INVENTORY_TEST_CONTAINER || "";
const databaseName = process.env.MTG_INVENTORY_TEST_DATABASE || "";
test.skip(!container || !databaseName, "Requires an explicitly owned local snapshot fixture target");
test.use({ trace: "retain-on-failure", screenshot: "only-on-failure", video: "off" });

function database<T>(body: string): T {
  if (!/^[a-f0-9]{64}$/.test(container) || !/^review\w+$/.test(databaseName))
    throw new Error("Expected immutable review-container ID and explicit review database");
  return JSON.parse(execFileSync("docker", ["exec", "-i", container, "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{if(new URL(process.env.DATABASE_URL).pathname!==${JSON.stringify("/" + databaseName)})throw Error('Wrong fixture database');${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30_000,
  }));
}

function fingerprint() {
  return database(`const result={};for(const model of ['inventoryItem','inventoryAuditLog','inventoryLocation','user','player','card']){const rows=await p[model].findMany({orderBy:{id:'asc'}});result[model]={count:rows.length,hash:require('crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return result;`);
}

async function fixture(page: import("@playwright/test").Page, baseURL: string | undefined) {
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  const before = fingerprint();
  const tag = `infinite-nav-${randomUUID()}`;
  const prefix = `Infinite ${tag.slice(-8)}`;
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  database(`const tag=${JSON.stringify(tag)},prefix=${JSON.stringify(prefix)};await p.$transaction(async tx=>{await tx.player.create({data:{id:tag,name:tag,displayName:prefix}});const passwordHash=require('crypto').randomBytes(32).toString('hex');await tx.user.create({data:{id:tag,username:tag,displayName:prefix,passwordHash,playerId:tag,inventoryDefaultVisibility:'PUBLIC'}});for(const group of ['Alpha','Beta'])for(let i=0;i<12;i++){const id=tag+'-'+group+'-'+i;await tx.card.create({data:{id,scryfallId:id,name:prefix+' '+group+' '+String(i).padStart(2,'0'),setCode:'TST',collectorNumber:String(i),typeLine:'Artifact',rarity:'common'}});await tx.inventoryItem.create({data:{cardId:id,currentOwnerId:tag,originalOpenerId:tag,quantity:1,sourceType:'MANUAL',condition:'NM'}});}await tx.authSession.create({data:{tokenHash:${JSON.stringify(hash)},userId:tag,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+300000)}});});return true;`);
  await page.context().addCookies([{ name: "mtg_inventory_session", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  return {
    prefix,
    async cleanup() {
      await page.context().clearCookies();
      database(`const tag=${JSON.stringify(tag)};await p.$transaction(async tx=>{await tx.authSession.deleteMany({where:{tokenHash:${JSON.stringify(hash)},userId:tag}});await tx.inventoryItem.deleteMany({where:{currentOwnerId:tag,originalOpenerId:tag,cardId:{startsWith:tag+'-'}}});if(await tx.inventoryItem.count({where:{OR:[{currentOwnerId:tag},{location:{ownerPlayerId:tag}}]}}))throw Error('Unexpected fixture stock');await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:tag}});await tx.card.deleteMany({where:{id:{startsWith:tag+'-'},scryfallId:{startsWith:tag+'-'}}});await tx.user.deleteMany({where:{id:tag,username:tag}});await tx.player.deleteMany({where:{id:tag,name:tag}});});return true;`);
      expect(fingerprint()).toEqual(before);
    },
  };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

for (const publicView of [false, true]) {
  for (const width of [1366, 320]) {
    for (const oldFailure of [false, true]) {
      test(`${publicView ? "Public" : "Private"} infinite navigation ignores old ${oldFailure ? "failure" : "success"} at ${width}px`, async ({ page, baseURL }) => {
        test.setTimeout(60_000);
        await page.setViewportSize({ width, height: 900 });
        const data = await fixture(page, baseURL);
        const old = gate(), current = gate(), oldSeen = gate(), currentSeen = gate(), oldDone = gate();
        let oldHeld = false, currentHeld = false;
        let pages = 0;
        const route = publicView ? "/public/inventory" : "/inventory";
        const endpoint = publicView ? "/api/public/inventory/list" : "/api/inventory/list";
        try {
          if (publicView) await page.context().clearCookies();
          await page.route(`**${endpoint}?**`, async request => {
            const url = new URL(request.request().url());
            if (url.searchParams.get("cardName") === data.prefix) {
              pages++;
              if (!oldHeld) {
                oldHeld = true;
                const response = await request.fetch();
                oldSeen.release();
                await old.promise;
                if (oldFailure) await request.fulfill({ status: 503, body: "Old test failure" });
                else await request.fulfill({ response });
                oldDone.release();
                return;
              }
              if (!currentHeld) {
                currentHeld = true;
                const response = await request.fetch();
                currentSeen.release();
                await current.promise;
                await request.fulfill({ response });
                return;
              }
            }
            await request.continue();
          });
          await page.goto(`${route}?displayMode=exact&pageSize=10&browse=infinite&cardName=${encodeURIComponent(data.prefix)}`);
          const rows = page.locator(".inventory-results tbody tr");
          await expect(rows).toHaveCount(10);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await Promise.race([oldSeen.promise, new Promise((_, reject) => setTimeout(() => reject(Error("Old real page request missing")), 10000))]);
          const search = page.getByRole("combobox", { name: "Quick card name search" });
          const submit = page.locator("form").filter({ has: search }).getByRole("button", { name: "Search", exact: true });
          await search.fill(`${data.prefix} Beta`);
          await submit.click();
          await expect(rows.first()).toContainText(`${data.prefix} Beta`);
          await expect(page).toHaveURL(/cardName=.*Beta/);
          // Return to the same query: a string-key check alone cannot distinguish
          // the original request from the new server page's request.
          await search.fill(data.prefix);
          await submit.click();
          await expect(rows.first()).toContainText(`${data.prefix} Alpha`);
          await expect(rows).toHaveCount(10);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await Promise.race([currentSeen.promise, new Promise((_, reject) => setTimeout(() => reject(Error("New real page request missing")), 10000))]);
          const oldFinished = page.waitForEvent("requestfinished", {
            predicate: request => new URL(request.url()).pathname === endpoint,
          });
          old.release();
          await oldDone.promise;
          await oldFinished;
          await page.evaluate(() => new Promise<void>(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          await expect(rows).toHaveCount(10);
          await expect(page.getByText("Loading more…", { exact: true })).toBeVisible();
          await expect(page.getByText(/Failed to load more results/)).toHaveCount(0);
          current.release();
          await expect(rows).toHaveCount(20);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await expect(rows).toHaveCount(24);
          await expect(page.getByText(/End of results · 24 loaded of 24/)).toBeVisible();
          expect(pages).toBe(3);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        } finally {
          old.release(); current.release();
          await page.unrouteAll({ behavior: "wait" });
          await page.goto("about:blank");
          await data.cleanup();
        }
      });
    }
  }
}

test("ordinary infinite retry preserves loaded rows and selection", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const data = await fixture(page, baseURL);
  let requests = 0;
  try {
    await page.route("**/api/inventory/list?**", async route => {
      if (++requests === 1) await route.fulfill({ status: 503, body: "Temporary test failure" });
      else await route.continue();
    });
    await page.goto(`/inventory?displayMode=exact&pageSize=10&browse=infinite&cardName=${encodeURIComponent(data.prefix)}`);
    const rows = page.locator(".inventory-results tbody tr");
    await expect(rows).toHaveCount(10);
    await rows.first().getByRole("checkbox", { name: /^Select / }).check();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.getByText(/Failed to load more results: Request failed \(503\)/)).toBeVisible();
    await expect(rows).toHaveCount(10);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(rows).toHaveCount(20);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(rows).toHaveCount(24);
    await expect(rows.first().getByRole("checkbox", { name: /^Select / })).toBeChecked();
    await expect(page.locator(".inventory-selection-context")).toContainText("1 entry selected");
    expect(requests).toBe(3);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await page.goto("about:blank");
    await data.cleanup();
  }
});
