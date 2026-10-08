import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { cleanupCorrectionFixture } from "./correction-fixture";
function database<T>(body: string): T {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node", "--import", "tsx"], {
    encoding: "utf8", windowsHide: true, timeout: 30000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(value=>console.log(JSON.stringify(value))).catch(()=>{console.error('Owned progress fixture failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
  }));
}
for (const width of [1366, 320]) test(`refresh correction progress preserves paging and inspection at ${width}px`, async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local progress fixture with controlled preservation and photo transport");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(120000);
  const owner = `ui-library-progress-${randomUUID()}`, password = randomUUID();
  const photo = await sharp({ create: { width: 64, height: 88, channels: 3, background: "#335577" } }).png().toBuffer();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  let failed = false, reads = 0, originalReads = 0, historyReads = 0;
  let pauseNext = false, resume: (() => void) | undefined;
  try {
    const blob = database<string>(`const n=${JSON.stringify(owner)};await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:await require('bcryptjs').hash(${JSON.stringify(password)},10)}});
      const {ensureCorrectionAccount}=require('./lib/acquisition-correction-library.ts');await p.$transaction(tx=>ensureCorrectionAccount(tx,n));
      const blob=await p.correctionBlob.create({data:{ownerPlayerId:n,digest:require('crypto').createHash('sha256').update(n).digest('hex'),bytes:${photo.length},mediaType:'image/png'}});
      for(let i=0;i<52;i++){const source=require('crypto').randomUUID();const example=await p.correctionExample.create({data:{ownerPlayerId:n,blobId:blob.id,sourcePhotoId:source,sourceCandidateId:n+'-'+i,sourceSessionId:n,sourceGeneration:0,physicalCopyGroup:source,createdAt:new Date(Date.now()+i*1000),label:{printing:{name:'Progress fixture with a long descriptive printing name',setCode:'tst',collectorNumber:String(i)}}}});
        await p.correctionReviewEvent.create({data:{ownerPlayerId:n,sourceCandidateId:n+'-'+i,candidateRevision:1,sourcePhotoId:source,exampleId:example.id,actorId:n,origin:'HUMAN',classification:'DISPLAY_IDENTITY_UNKNOWN',bytes:0,payload:{version:1,before:null,after:null,displayKnown:false,independentVerification:'UNVERIFIED'}}});}return blob.id;`);
    await page.setViewportSize({ width, height: 900 }); await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(owner); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click(); await page.waitForURL(/dashboard/);
    await page.route("**/api/acquisition/corrections?*", async route => {
      reads++;
      if (failed) return route.fulfill({ status: 503, json: { error: "Progress could not refresh." } });
      if (pauseNext) {
        pauseNext = false; const response = await route.fetch();
        await new Promise<void>(resolve => { resume = resolve; });
        return route.fulfill({ response });
      }
      return route.continue();
    });
    await page.route("**/api/acquisition/corrections/*?*", route => {
      if (route.request().method() !== "GET") return route.continue();
      originalReads++; return route.fulfill({ contentType: "image/png", body: photo });
    });
    page.on("request", request => { if (new URL(request.url()).pathname.endsWith("/history")) historyReads++; });
    await page.goto("/imports/corrections"); const examples = page.getByRole("article");
    await expect(examples).toHaveCount(50); await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(examples).toHaveCount(2);
    await expect(examples.first()).toContainText("Original waiting to be preserved");
    database(`await p.correctionBlob.update({where:{id:${JSON.stringify(blob)}},data:{state:'PRESERVED',preservedAt:new Date()}});await p.correctionLibraryAccount.update({where:{ownerPlayerId:${JSON.stringify(owner)}},data:{preservedBytes:${photo.length}}});return true;`);
    const authoritative = await page.request.get(`/api/acquisition/corrections?owner=${encodeURIComponent(owner)}`);
    expect(authoritative.ok()).toBe(true); expect((await authoritative.json()).examples[0].blob.state).toBe("PRESERVED");
    await page.getByRole("button", { name: "Refresh photos", exact: true }).click();
    await expect(examples).toHaveCount(2); await expect(examples.first()).toContainText("Original preserved");
    await expect(page.getByText(/0 pending originals/)).toBeVisible(); await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeEnabled();
    await examples.first().getByRole("button", { name: "View original", exact: true }).click();
    const image = examples.first().getByRole("img", { name: "Preserved original correction photo" }); await expect(image).toBeVisible();
    await examples.first().getByRole("button", { name: "View review history", exact: true }).click();
    const history = page.getByRole("region", { name: "Saved review history", exact: true }); await expect(history.locator("ol > li")).toHaveCount(1);
    const before = { originalReads, historyReads, reads };
    failed = true; await page.getByRole("button", { name: "Refresh photos", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Progress could not refresh.");
    await expect(image).toBeVisible(); await expect(history).toBeVisible(); await expect(examples).toHaveCount(2);
    failed = false; await page.getByRole("alert").getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0); await expect(page.getByRole("button", { name: "Refresh photos", exact: true })).toBeEnabled();
    await expect(image).toBeVisible(); await expect(history.locator("ol > li")).toHaveCount(1);
    expect(originalReads).toBe(before.originalReads); expect(historyReads).toBe(before.historyReads); expect(reads).toBe(before.reads + 2);
    pauseNext = true; await page.getByRole("button", { name: "Refresh photos", exact: true }).click();
    const refreshing = page.getByRole("button", { name: "Refreshing photos…", exact: true });
    await expect(refreshing).toBeDisabled(); await expect(examples.first().getByRole("button", { name: "Withdraw label", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
    await refreshing.evaluate(button => (button as HTMLButtonElement).click());
    await expect.poll(() => !!resume).toBe(true); expect(reads).toBe(before.reads + 3); resume!();
    await expect(page.getByRole("button", { name: "Refresh photos", exact: true })).toBeEnabled();
    await expect(image).toBeVisible(); await expect(history).toBeVisible();
    const beforeMutation = reads; await examples.first().getByRole("button", { name: "Withdraw label", exact: true }).click();
    await expect(examples.first()).toContainText("Label withdrawn"); await expect(image).toBeVisible(); await expect(history).toBeVisible();
    expect(reads).toBe(beforeMutation + 1);
    await page.screenshot({ path: `test-results/correction-progress-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); expect(errors).toEqual([]);
    await examples.first().getByRole("button", { name: "Remove example", exact: true }).click();
    await examples.first().getByRole("button", { name: "Confirm removal", exact: true }).click();
    await expect(examples).toHaveCount(1); await expect(history).toHaveCount(0); await expect(page.getByRole("img", { name: "Preserved original correction photo" })).toHaveCount(0);
  } finally {
    database(`const n=${JSON.stringify(owner)};${cleanupCorrectionFixture}await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});return true;`);
  }
});
