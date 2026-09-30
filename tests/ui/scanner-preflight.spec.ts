import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000, windowsHide: true,
  });
}

test("queued scanner errors explain recovery and clear after authorized start; cancellation never feeds", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local protocol fixtures; never runs a helper or motor");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  const tag = `ui-scanner-preflight-${randomUUID()}`, password = randomUUID(), agentId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const headers = { authorization: `Bearer ${agentId}.${secret}` };
  const source = { id: "fixture-preflight", name: "Local preflight fixture", backend: "fixture", source: "Fixture", qualification: "GenericUnqualified" };
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box'}});`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click(); await page.waitForURL(/\/dashboard/);
    const pair = await page.request.post("/api/scanners", { data: { action: "pair" }, headers: { origin: baseURL! } });
    expect(pair.ok()).toBe(true);
    const enrolled = await page.request.post("/api/scanner-agent/pair", { data: { version: 1, pairCode: (await pair.json()).code,
      agentId, secret, name: "Local preflight fixture" } }); expect(enrolled.ok()).toBe(true);
    const pulse = async () => expect((await page.request.post("/api/scanner-agent/pulse", {
      headers, data: { version: 1, agentVersion: "0.3.0-native", devices: [source] },
    })).ok()).toBe(true);
    await pulse();
    await page.goto("/imports/scan?input=scanner");
    await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);
    await page.getByRole("option").first().click();
    const selection = page.getByRole("combobox", { name: "Scanner source", exact: true });
    await expect(selection.locator("option")).toHaveCount(2);
    await expect(selection).toHaveValue(`${agentId}/${source.id}`);
    await page.getByRole("button", { name: "Start scanner batch", exact: true }).click();
    const scanner = page.getByRole("region", { name: "Scanner batch" });
    await expect(scanner).toContainText("Waiting for the Windows helper to start.");
    const poll = await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "poll", version: 1 } });
    expect(poll.ok()).toBe(true); const { run, epoch } = await poll.json();
    const report = async (code: string) => expect((await page.request.post("/api/scanner-agent/runs", {
      headers, data: { action: "preflight", version: 1, runId: run.runId, epoch, code },
    })).ok()).toBe(true);
    await report("SCANNER_UNAVAILABLE"); await expect(scanner).toContainText("Check its USB connection and power.");
    await expect(scanner.getByRole("link", { name: "New scanner batch" })).toHaveCount(0);
    for (const width of [1366, 320]) {
      await page.setViewportSize({ width, height: 900 }); await scanner.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/scanner-preflight-${width}.png` });
    }
    await report("SCANNER_BUSY"); await expect(scanner).toContainText("Finish the other scan");
    await page.reload(); await expect(scanner).toContainText("Finish the other scan");
    await report("LOW_DISK_SPACE"); await expect(scanner).toContainText("Free some disk space");
    await report("DRIVER_ERROR"); await expect(scanner).toContainText("install or repair the manufacturer's driver");
    const state = JSON.parse(database(`const run=await p.scannerRun.findUniqueOrThrow({where:{id:${JSON.stringify(run.runId)}}});console.log(JSON.stringify({status:run.status,executionId:run.executionId,outcome:run.outcome,photos:await p.acquisitionPhoto.count({where:{runId:run.acquisitionRunId}})}));`));
    expect(state).toEqual({ status: "QUEUED", executionId: null, outcome: null, photos: 0 });
    await pulse();
    const claim = { version: 1, runId: run.runId, epoch, executionId: randomUUID() };
    const claimed = await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "claim", ...claim } });
    expect(claimed.ok()).toBe(true); expect((await claimed.json()).feedAuthorized).toBe(true);
    await expect(scanner).toContainText("Scanning and uploading"); await expect(scanner).not.toContainText("driver could not prepare");
    expect((await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "preflight", version: 1, runId: run.runId, epoch, code: "DRIVER_ERROR" } })).ok()).toBe(false);
    const finished = await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "finish", ...claim,
      outcome: { outcome: "COMPLETED", imageCount: 0, elapsedMs: 0, knownPhysicalItems: null, sourceExhausted: "UNKNOWN", nativeError: null } } });
    expect(finished.ok()).toBe(true); await expect(scanner).toContainText("Scanner run ended.");
    await pulse();
    const queued = await page.request.post("/api/scanners/runs", { headers: { origin: baseURL! }, data: { action: "create",
      requestKey: randomUUID(), agentId, deviceId: source.id, locationId: tag, section: "", quantity: null,
      loadedCount: null, operatorLoadedSimplexFronts: true, settings: run.settings } });
    expect(queued.ok()).toBe(true);
    const nextPoll = await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "poll", version: 1 } });
    expect(nextPoll.ok()).toBe(true); const next = (await nextPoll.json()).run;
    await page.goto(`/imports/scan?batch=${next.sessionId}`);
    await scanner.getByRole("button", { name: "Cancel waiting scan" }).click();
    await expect(scanner).toContainText("The helper was not authorized to feed cards.");
    await expect(scanner.getByLabel("Cards physically emitted")).toHaveCount(0);
    await expect(scanner.getByRole("button", { name: "Confirm physical count" })).toHaveCount(0);
    await expect(scanner).toContainText("No physical count is needed.");
    expect((await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "preflight", version: 1, runId: next.runId, epoch, code: "SCANNER_BUSY" } })).ok()).toBe(false);
    const ended = await page.request.get(`/api/scanners/runs?run=${next.runId}`);
    expect(ended.ok()).toBe(true); expect((await ended.json()).reconciliation.mode).toBe("CANCELLED_WITHOUT_START");
    await page.reload(); await expect(scanner).toContainText("No physical count is needed.");
    await scanner.getByRole("link", { name: "New scanner batch" }).click();
    await expect(page.getByRole("button", { name: "Start scanner batch", exact: true })).toBeVisible();
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  } finally {
    database(`const n=${JSON.stringify(tag)};const w={run:{session:{createdByUserId:n}}};
      const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;
      if(!root||!paths.isAbsolute(root))throw new Error('Private fixture storage unavailable');
      const runs=await p.scannerRun.findMany({where:{agent:{userId:n}},select:{id:true}});
      for(const run of runs){if(!/^[a-f0-9-]{36}$/.test(run.id))throw new Error('Invalid owned fixture identity');await fs.unlink(paths.join(root,'scanner-control-v1',run.id+'.start.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});}
      await p.scannerRun.deleteMany({where:{agent:{userId:n}}});
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});
      await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});
      await p.inventoryLocation.deleteMany({where:{id:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});`);
  }
});
