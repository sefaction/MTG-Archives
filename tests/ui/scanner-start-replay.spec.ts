import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000, windowsHide: true,
  });
}

for (const accepted of [true, false]) test(`lost website START ${accepted ? "acknowledgement" : "request"} keeps identity across source refresh and reload`, async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local protocol fixture; no helper or motor");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(120000);
  const tag = `ui-start-replay-${randomUUID()}`, password = randomUUID(), agentId = randomUUID();
  const secret = randomBytes(32).toString("base64url"), headers = { authorization: `Bearer ${agentId}.${secret}` };
  const source = { id: "fixture-start", name: "START recovery fixture", backend: "fixture", source: "Fixture", qualification: "GenericUnqualified" };
  const requests: Record<string, unknown>[] = []; let polls = 0, recoveryAvailable = false;
  let first: { id: string; runId: string; batchNumber: number };
  const executionId = randomUUID();
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box'}});`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password); await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    const pair = await page.request.post("/api/scanners", { data: { action: "pair" }, headers: { origin: baseURL! } });
    expect(pair.ok()).toBe(true);
    expect((await page.request.post("/api/scanner-agent/pair", { data: { version: 1, pairCode: (await pair.json()).code,
      agentId, secret, name: "START recovery fixture" } })).ok()).toBe(true);
    const pulse = async () => expect((await page.request.post("/api/scanner-agent/pulse", { headers,
      data: { version: 1, agentVersion: "0.3.0-native", devices: [source] } })).ok()).toBe(true);
    await pulse();
    await page.route("**/api/scanners", async route => { if(route.request().method()==="GET") polls++; await route.continue(); });
    await page.route("**/api/scanners/runs?request=*", async route => {
      if (recoveryAvailable) return route.continue();
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Injected recovery outage" }) });
    });
    await page.route("**/api/scanners/runs", async route => {
      if (route.request().method() !== "POST" || route.request().postDataJSON()?.action !== "create") return route.continue();
      requests.push(route.request().postDataJSON());
      if (requests.length === 1 && !accepted) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Injected lost START request" }) });
        return;
      }
      const response = await route.fetch();
      if (requests.length === 1 || !accepted) {
        expect(response.ok()).toBe(true); first = await response.json();
        const polled = await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "poll", version: 1 } });
        expect(polled.ok()).toBe(true); const { run, epoch } = await polled.json();
        expect(run.runId).toBe(first.runId);
        expect((await page.request.post("/api/scanner-agent/runs", { headers,
          data: { action: "claim", version: 1, runId: run.runId, epoch, executionId } })).ok()).toBe(true);
        if (requests.length === 1) {
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Injected lost START acknowledgement" }) });
          return;
        }
      }
      await route.fulfill({ response });
    });
    await page.goto("/imports/scan?input=scanner");
    await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);
    await page.getByRole("option").first().click();
    const start = page.getByRole("button", { name: "Start scanner batch", exact: true }); await expect(start).toBeEnabled();
    await start.click(); await expect.poll(()=>requests.length).toBe(1);
    await expect(page.getByRole("alert").filter({hasText:"Injected lost START"})).toContainText("The original Start is saved");
    const previousPolls=polls; await expect.poll(()=>polls, { timeout: 15000 }).toBeGreaterThan(previousPolls);
    await expect(page.getByRole("combobox", { name: "Scanner source", exact: true })).toBeDisabled();
    await expect(page.getByTestId("storage-destination").getByRole("button", { name: /change/i })).toBeDisabled();
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/scanner-start-recovery-${accepted ? "accepted" : "unsent"}-320.png` });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.reload();
    const retry = page.getByRole("button", { name: "Retry same scanner start", exact: true });
    await expect(retry).toBeEnabled(); expect(requests).toHaveLength(1); // Reload only reads.
    if (accepted) database(`await p.scannerAgent.update({where:{id:${JSON.stringify(agentId)}},data:{lastSeenAt:new Date(0)}});`);
    recoveryAvailable = true; await retry.click();
    const scanner = page.getByRole("region", { name: "Scanner batch" });
    await expect(scanner).toBeVisible();
    expect(new Set(requests.map(r=>r.requestKey)).size).toBe(1);
    expect(requests).toHaveLength(accepted ? 1 : 2);
    if (!accepted) expect(requests[1]).toEqual(requests[0]);
    await expect(page).toHaveURL(new RegExp(`batch=${first!.id}`));
    await page.reload(); await expect(scanner).toBeVisible();
    await expect(page.getByRole("region", { name: "Batch progress" })).toContainText(`Batch ${first!.batchNumber}`);
    const state = JSON.parse(database(`const n=${JSON.stringify(tag)};const rows=await p.scannerRun.findMany({where:{agent:{userId:n}}});console.log(JSON.stringify({runs:rows.length,executionId:rows[0]?.executionId,sessions:await p.acquisitionSession.count({where:{createdByUserId:n}}),inventory:await p.inventoryItem.count({where:{currentOwnerId:n}}),photos:await p.acquisitionPhoto.count({where:{run:{session:{createdByUserId:n}}}})}));`));
    expect(state).toEqual({ runs: 1, executionId, sessions: 1, inventory: 0, photos: 0 });
    await pulse();
    const current = await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "poll", version: 1 } });
    const { epoch } = await current.json();
    expect((await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "finish", version: 1,
      runId: first!.runId, epoch, executionId, outcome: { outcome: "SOURCE_EXHAUSTED", imageCount: 0,
        elapsedMs: 1, knownPhysicalItems: null, sourceExhausted: "REPORTED_EMPTY", nativeError: null } } })).ok()).toBe(true);
    await scanner.getByRole("link", { name: "New scanner batch" }).click();
    await expect(page.getByRole("button", { name: "Start scanner batch", exact: true })).toBeEnabled();
    await expect(page.getByTestId("storage-destination").getByRole("button", { name: /change/i })).toBeEnabled();
    await page.locator("#scanner-source details summary").click();
    await page.getByRole("combobox", { name: "Resolution", exact: true }).selectOption("300");
    expect(requests).toHaveLength(accepted ? 1 : 2); // Settled setup changes do not START.
  } finally {
    database(`const n=${JSON.stringify(tag)},w={run:{session:{createdByUserId:n}}};const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;
      if(!root||!paths.isAbsolute(root))throw new Error('Private fixture storage unavailable');
      for(const r of await p.scannerRun.findMany({where:{agent:{userId:n}},select:{id:true}})){
        if(!/^[a-f0-9-]{36}$/.test(r.id))throw new Error('Invalid owned fixture identity');await fs.unlink(paths.join(root,'scanner-control-v1',r.id+'.start.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});}
      await p.scannerRun.deleteMany({where:{agent:{userId:n}}});
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});
      await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});
      await p.inventoryLocation.deleteMany({where:{id:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});`);
  }
});
