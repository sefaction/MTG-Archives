import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cleanupCorrectionFixture } from "./correction-fixture";
function database<T>(body: string): T {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node", "--import", "tsx"], {
    encoding: "utf8", windowsHide: true, timeout: 30000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(value=>console.log(JSON.stringify(value))).catch(()=>{console.error('Owned history fixture failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
  }));
}
for (const width of [1366, 320]) test(`private correction review history remains readable and recoverable at ${width}px`, async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local correction-history fixtures");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(120000);
  const owners = [0, 1].map(() => `ui-history-${randomUUID()}`), password = randomUUID();
  const printings = ["Suggested fixture printing with a long descriptive name", "Saved alternative fixture printing"].map((name, i) => ({
    id: `fixture-${i}`, name, setCode: "tst", collectorNumber: String(i + 1), lang: "en",
  }));
  let historyRequests = 0, failHistory = true;
  const uncaught: string[] = []; page.on("pageerror", error => uncaught.push(error.message));
  try {
    const examples = database<{ id: string }[]>(`const rows=[];const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);for(const n of ${JSON.stringify(owners)}){
      await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});
      const {ensureCorrectionAccount}=require('./lib/acquisition-correction-library.ts');await p.$transaction(tx=>ensureCorrectionAccount(tx,n));
      const source=require('crypto').randomUUID(),blob=await p.correctionBlob.create({data:{ownerPlayerId:n,digest:'d'.repeat(64),bytes:1,mediaType:'image/png'}});
      const example=await p.correctionExample.create({data:{ownerPlayerId:n,blobId:blob.id,sourcePhotoId:source,sourceCandidateId:n+'-candidate',sourceSessionId:n+'-session',sourceGeneration:0,physicalCopyGroup:source,label:{printing:${JSON.stringify(printings[1])}}}});rows.push({id:example.id});
      const cards=${JSON.stringify(printings)},before={cardId:cards[0].id,finish:'NONFOIL',condition:'NM',language:'en'},after={cardId:cards[1].id,finish:'FOIL',condition:'LP',language:'en'};
      for(let revision=1;revision<=24;revision++)await p.correctionReviewEvent.create({data:{ownerPlayerId:n,sourceCandidateId:n+'-candidate',candidateRevision:revision,sourcePhotoId:source,exampleId:example.id,actorId:n,origin:'HUMAN',bytes:0,
        classification:revision===24?'OFFERED_ALTERNATIVE_SELECTED':revision===23?'DISPLAY_IDENTITY_UNKNOWN':revision===22?'METADATA_ONLY':revision===21?'RETURNED_TO_PENDING':'FIRST_CHOICE_AGREEMENT',
        payload:{version:1,before:revision===22?after:before,after:revision===21?null:after,displayKnown:revision!==23,firstDisplayedSuggestion:cards[0],printingProjections:cards,independentVerification:'UNVERIFIED',missing:revision===23?['DISPLAY_IDENTITY_UNKNOWN']:[],password:'PRIVATE_HISTORY_VALUE'},createdAt:new Date(100000-revision*1000)}});
    }return rows;`);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(owners[0]);
    await page.getByLabel(/^password$/i).fill(password); await page.getByRole("button", { name: /^log in$/i }).click(); await page.waitForURL(/dashboard/);
    await page.route("**/api/acquisition/corrections/*/history?*", async route => {
      historyRequests++; expect(route.request().method()).toBe("GET");
      if (failHistory) return route.fulfill({ status: 503, json: { error: "The review history could not load." } });
      const response = await route.fetch(); expect(response.ok()).toBe(true);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      expect(await response.text()).not.toContain("PRIVATE_HISTORY_VALUE");
      await route.fulfill({ response });
    });
    await page.goto("/imports/corrections");
    const example = page.getByRole("article"); await expect(example).toHaveCount(1);
    expect(historyRequests).toBe(0);
    await example.getByRole("button", { name: "View review history", exact: true }).click();
    const history = page.getByRole("region", { name: "Saved review history", exact: true });
    const alert = history.getByRole("alert"); await expect(alert).toContainText("The review history could not load.");
    failHistory = false; await alert.getByRole("button", { name: "Retry history", exact: true }).click();
    const records = history.locator("ol > li"); await expect(records).toHaveCount(20);
    await expect(records.nth(0)).toContainText("Selected another suggestion");
    await expect(records.nth(0)).toContainText(printings[0].name); await expect(records.nth(0)).toContainText(printings[1].name);
    await expect(records.nth(0)).toContainText("Unverified");
    await expect(records.nth(1)).toContainText("Suggestion not recorded"); await expect(records.nth(1)).toContainText("Evidence gaps");
    await expect(records.nth(2)).toContainText("Updated attributes of the same printing");
    await expect(records.nth(3)).toContainText("Returned the scan to pending"); await expect(records.nth(3)).toContainText("No printing selected");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/correction-history-${width}.png` });
    await history.getByRole("button", { name: "Older reviews", exact: true }).click(); await expect(records).toHaveCount(4);
    await expect(history.getByRole("button", { name: "Older reviews", exact: true })).toBeDisabled();
    await history.getByRole("button", { name: "Newer reviews", exact: true }).click(); await expect(records).toHaveCount(20);
    const denied = await page.request.get(`/api/acquisition/corrections/${examples[1].id}/history?owner=${encodeURIComponent(owners[1])}`);
    expect(denied.status()).toBe(403);
    const mixed = await page.request.get(`/api/acquisition/corrections/${examples[1].id}/history?owner=${encodeURIComponent(owners[0])}`);
    expect(mixed.status()).toBe(403);
    await example.getByRole("button", { name: "Hide review history", exact: true }).click(); await expect(history).toHaveCount(0);
    await example.getByRole("button", { name: "Withdraw label", exact: true }).click(); await expect(example).toContainText("Label withdrawn");
    await example.getByRole("button", { name: "View review history", exact: true }).click(); await expect(records).toHaveCount(20);
    await expect(history).toContainText("They do not reinstate a withdrawn label.");
    await example.getByRole("button", { name: "Remove example", exact: true }).click(); await example.getByRole("button", { name: "Confirm removal", exact: true }).click();
    await expect(example).toHaveCount(0); await expect(history).toHaveCount(0);
    expect((await page.request.get(`/api/acquisition/corrections/${examples[0].id}/history?owner=${encodeURIComponent(owners[0])}`)).status()).toBe(403);
    expect(uncaught).toEqual([]);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    for (const n of owners) database(`const n=${JSON.stringify(n)};${cleanupCorrectionFixture}await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});return true;`);
  }
});
