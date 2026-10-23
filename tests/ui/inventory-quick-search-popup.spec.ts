import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const container = process.env.MTG_INVENTORY_TEST_CONTAINER || "";
const databaseName = process.env.MTG_INVENTORY_TEST_DATABASE || "";
test.skip(!container || !databaseName, "Requires an explicitly owned local snapshot target");
test.use({ hasTouch: true, trace: "retain-on-failure", screenshot: "only-on-failure", video: "off" });

function database<T>(body: string): T {
  if (!/^[a-f0-9]{64}$/.test(container) || !/^review\w+$/.test(databaseName))
    throw new Error("Expected an immutable review container and explicit review database");
  return JSON.parse(execFileSync("docker", ["exec", "-i", container, "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{if(new URL(process.env.DATABASE_URL).pathname!==${JSON.stringify("/" + databaseName)})throw Error('Wrong fixture database');${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30_000,
  }));
}

test("Public suggestions remain anonymous and public-only while Private stays authenticated", async ({ page, baseURL }) => {
  const data = await fixture(page, baseURL);
  try {
    const query = new URLSearchParams({ kind: "cardName", q: data.prefix, language: "EN" });
    const publicPath = `/api/public/inventory/filter-suggestions?${query}`;
    // A real session must not widen the public namespace, even with public=0.
    const signedIn = await page.request.get(`${publicPath}&public=0`);
    expect(signedIn.status()).toBe(200);
    const expected = ["Alpha", "Beta", "Gamma"].map(name => `${data.prefix} ${name}`);
    expect((await signedIn.json()).suggestions.map((item: { value: string }) => item.value)).toEqual(expected);
    await page.context().clearCookies();
    for (const suffix of ["", "&public=0", "&public=1"]) {
      const response = await page.request.get(publicPath + suffix);
      expect(response.status()).toBe(200);
      expect((await response.json()).suggestions.map((item: { value: string }) => item.value)).toEqual(expected);
    }
    const privateName = await page.request.get(`/api/public/inventory/filter-suggestions?kind=cardName&q=${encodeURIComponent(data.prefix + " Private")}`);
    expect(privateName.status()).toBe(200);
    expect((await privateName.json()).suggestions).toEqual([]);
    const privateOwner = await page.request.get(`${publicPath}&owner=${encodeURIComponent(data.privateOwnerId)}`);
    expect(privateOwner.status()).toBe(200);
    expect((await privateOwner.json()).suggestions).toEqual([]);
    const otherLanguage = await page.request.get(publicPath.replace("language=EN", "language=FR"));
    expect(otherLanguage.status()).toBe(200);
    expect((await otherLanguage.json()).suggestions).toEqual([]);
    const invalid = await page.request.get("/api/public/inventory/filter-suggestions?kind=unknown&q=Popup");
    expect(invalid.status()).toBe(400);
    const bounded = await page.request.get(`${publicPath}&limit=1`);
    expect((await bounded.json()).suggestions).toHaveLength(1);
    expect((await bounded.json()).hasMore).toBe(true);
    for (const path of ["/api/inventory/filter-suggestions", "/api/inventory/filter-suggestions/wrong", "/api/inventory"]) {
      expect((await page.request.get(`${path}?${query}&public=1`)).status()).toBe(401);
    }
    await page.context().addCookies([{ name: "mtg_inventory_session", value: "invalid-session", url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    expect((await page.request.get(`/api/inventory/filter-suggestions?${query}`)).status()).toBe(401);
    const forged = await page.request.get(`${publicPath}&public=0`);
    expect(forged.status()).toBe(200);
    expect((await forged.json()).suggestions.map((item: { value: string }) => item.value)).toEqual(expected);
  } finally {
    await data.cleanup();
  }
});
function fingerprint() {
  return database(`const result={};for(const model of ['inventoryItem','inventoryAuditLog','inventoryLocation','user','player','card']){const rows=await p[model].findMany({orderBy:{id:'asc'}});result[model]={count:rows.length,hash:require('crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return result;`);
}
async function fixture(page: import("@playwright/test").Page, baseURL: string | undefined) {
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  const before = fingerprint();
  const tag = `quick-popup-${randomUUID()}`, prefix = `Popup ${tag.slice(-8)}`;
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  database(`const tag=${JSON.stringify(tag)},prefix=${JSON.stringify(prefix)};await p.$transaction(async tx=>{const passwordHash=require('crypto').randomBytes(32).toString('hex');for(const privatePeer of [false,true]){const id=tag+(privatePeer?'-private':'');await tx.player.create({data:{id,name:id,displayName:id}});await tx.user.create({data:{id,username:id,displayName:id,passwordHash,playerId:id,inventoryDefaultVisibility:privatePeer?'PRIVATE':'PUBLIC'}});for(const name of privatePeer?['Private']:['Alpha','Beta','Gamma']){const cardId=id+'-'+name;await tx.card.create({data:{id:cardId,scryfallId:cardId,name:prefix+' '+name,setCode:'TST',collectorNumber:name,typeLine:'Artifact',rarity:'common'}});await tx.inventoryItem.create({data:{cardId,currentOwnerId:id,originalOpenerId:id,quantity:1,sourceType:'MANUAL',condition:'NM',language:'EN'}});}}await tx.authSession.create({data:{tokenHash:${JSON.stringify(hash)},userId:tag,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+300000)}});});return true;`);
  await page.context().addCookies([{ name: "mtg_inventory_session", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  return {
    prefix,
    privateOwnerId: `${tag}-private`,
    async cleanup() {
      await page.context().clearCookies();
      database(`const tag=${JSON.stringify(tag)},owners=[tag,tag+'-private'];await p.$transaction(async tx=>{await tx.authSession.deleteMany({where:{tokenHash:${JSON.stringify(hash)},userId:tag}});await tx.inventoryItem.deleteMany({where:{currentOwnerId:{in:owners},originalOpenerId:{in:owners},cardId:{startsWith:tag+'-'}}});if(await tx.inventoryItem.count({where:{OR:[{currentOwnerId:{in:owners}},{location:{ownerPlayerId:{in:owners}}}]}}))throw Error('Unexpected stock prevents fixture cleanup');await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});await tx.card.deleteMany({where:{id:{startsWith:tag+'-'},scryfallId:{startsWith:tag+'-'}}});await tx.user.deleteMany({where:{id:{in:owners},username:{in:owners}}});await tx.player.deleteMany({where:{id:{in:owners},name:{in:owners}}});});return true;`);
      expect(fingerprint()).toEqual(before);
    },
  };
}

for (const publicView of [false, true]) {
  for (const width of [1366, 390, 320]) {
    for (const phase of ["loading", "settled"] as const) {
      test(`${publicView ? "Public" : "Private"} ${width}px Search remains reachable with ${phase} suggestions`, async ({ page, baseURL }) => {
        test.setTimeout(60_000);
        await page.setViewportSize({ width, height: 844 });
        const data = await fixture(page, baseURL);
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        let release = () => {};
        const gate = new Promise<void>(resolve => { release = resolve; });
        try {
          if (publicView) await page.context().clearCookies();
          if (phase === "loading") await page.route(publicView ? "**/api/public/inventory/filter-suggestions?**" : "**/api/inventory/filter-suggestions?**", async route => {
            const response = await route.fetch();
            await gate;
            await route.fulfill({ response });
          });
          const path = publicView ? "/public/inventory" : "/inventory";
          await page.goto(`${path}?displayMode=exact&language=EN&pageSize=10`);
          const input = page.getByRole("combobox", { name: "Quick card name search" });
          const button = page.locator("form").filter({ has: input }).getByRole("button", { name: "Search", exact: true });
          await input.fill(data.prefix);
          const list = page.getByRole("listbox");
          await expect(list).toBeVisible();
          if (phase === "loading") await expect(list.getByText("Loading suggestions…", { exact: true })).toBeVisible();
          else {
            await expect(list.getByRole("option")).toHaveCount(3);
            await expect(list).not.toContainText(`${data.prefix} Private`);
          }
          await page.screenshot({ path: test.info().outputPath("open-popup.png"), fullPage: true });
          // Use a normal touch on phones and mouse click on desktop. The popup
          // stays open until the ordinary action itself causes focus/navigation.
          if (width < 640) await button.tap({ timeout: 3000 });
          else await button.click({ timeout: 3000 });
          release();
          await expect.poll(() => new URL(page.url()).searchParams.get("cardName")).toBe(data.prefix);
          const params = new URL(page.url()).searchParams;
          expect(params.get("language")).toBe("EN");
          expect(params.get("displayMode")).toBe("exact");
          expect(params.get("page")).toBe("1");
          const rows = page.locator(".inventory-results tbody tr");
          await expect(rows).toHaveCount(3);
          await expect(rows.filter({ hasText: `${data.prefix} Private` })).toHaveCount(0);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          expect(errors).toEqual([]);
        } finally {
          release();
          await page.unrouteAll({ behavior: "wait" });
          await page.goto("about:blank");
          await data.cleanup();
        }
      });
    }
  }
  for (const method of ["touch option", "ArrowDown Enter", "ArrowUp Enter", "Escape Enter"] as const) {
    test(`${publicView ? "Public" : "Private"} phone suggestions preserve ${method}`, async ({ page, baseURL }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: 320, height: 844 });
      const data = await fixture(page, baseURL);
      try {
        if (publicView) await page.context().clearCookies();
        await page.goto(`${publicView ? "/public/inventory" : "/inventory"}?displayMode=exact&language=EN`);
        const input = page.getByRole("combobox", { name: "Quick card name search" });
        await input.fill(data.prefix);
        const list = page.getByRole("listbox");
        await expect(list.getByRole("option")).toHaveCount(3);
        let expected = data.prefix;
        if (method === "touch option") {
          expected += " Beta";
          await list.getByRole("option").filter({ hasText: expected }).tap();
        } else {
          if (method === "ArrowDown Enter") { await input.press("ArrowDown"); expected += " Beta"; }
          if (method === "ArrowUp Enter") { await input.press("ArrowUp"); expected += " Gamma"; }
          if (method === "Escape Enter") {
            await input.press("Escape");
            await expect(list).toHaveCount(0);
          }
          await input.press("Enter");
        }
        await expect.poll(() => new URL(page.url()).searchParams.get("cardName")).toBe(expected);
        expect(new URL(page.url()).searchParams.get("language")).toBe("EN");
        await expect(page.locator(".inventory-results tbody tr")).toHaveCount(method === "Escape Enter" ? 3 : 1);
      } finally {
        await page.goto("about:blank");
        await data.cleanup();
      }
    });
  }
}
