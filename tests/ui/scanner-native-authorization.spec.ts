import { cancelAndCleanCorrectionFixture } from "./correction-fixture";
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000, windowsHide: true,
  });
}

test("native HTTP endpoints separate permanent denial from run conflicts and malformed requests", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local protocol fixtures; no helper or motor");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(120000);
  const tag = `ui-native-auth-${randomUUID()}`, password = randomUUID(), agentId = randomUUID();
  const secret = randomBytes(32).toString("base64url"), headers = { authorization: `Bearer ${agentId}.${secret}` };
  const source = { id: "fixture-auth", name: "Authorization fixture", backend: "fixture", source: "Fixture", qualification: "GenericUnqualified" };
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box'}});`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password); await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    const pair = await page.request.post("/api/scanners", { data: { action: "pair" }, headers: { origin: baseURL! } });
    expect(pair.ok()).toBe(true);
    expect((await page.request.post("/api/scanner-agent/pair", { data: { version: 1, pairCode: (await pair.json()).code,
      agentId, secret, name: "Authorization fixture" } })).ok()).toBe(true);
    expect((await page.request.post("/api/scanner-agent/pulse", { headers,
      data: { version: 1, agentVersion: "0.3.5", devices: [source] } })).ok()).toBe(true);
    const created = await page.request.post("/api/scanners/runs", { headers: { origin: baseURL! }, data: {
      action: "create", requestKey: randomUUID(), agentId, deviceId: source.id, locationId: tag, section: "", quantity: null,
      loadedCount: null, operatorLoadedSimplexFronts: true,
      settings: { dpi: 600, widthInches: 2.6, heightInches: 3.6, horizontalPlacement: "Start", duplex: false,
        color: "RGB", autoCrop: false, deskew: false, removeBlank: false },
    } }); expect(created.ok()).toBe(true);
    const polled = await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "poll", version: 1 } });
    expect(polled.ok()).toBe(true); const { run, epoch } = await polled.json();
    const claim = { version: 1, runId: run.runId, epoch, executionId: randomUUID() };
    const outcome = { outcome: "COMPLETED", imageCount: 0, elapsedMs: 0, knownPhysicalItems: null, sourceExhausted: "UNKNOWN", nativeError: null };
    const preflight = { action: "preflight", version: 1, runId: run.runId, epoch, code: "SCANNER_UNAVAILABLE" };
    expect((await page.request.post("/api/scanner-agent/runs", { headers, data: preflight })).status()).toBe(200);
    expect((await page.request.post("/api/scanner-agent/runs", { headers,
      data: { action: "claim", ...claim, runId: randomUUID() } })).status()).toBe(409);
    expect((await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "poll", version: 2 } })).status()).toBe(400);
    expect((await page.request.post("/api/scanner-agent/images", { headers, data: "unused" })).status()).toBe(400);
    expect((await page.request.post("/api/scanner-agent/images", { headers: { ...headers, "x-mtg-scanner": "x".repeat(4097) }, data: "unused" })).status()).toBe(413);
    expect((await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "claim", ...claim } })).status()).toBe(200);
    expect((await page.request.post("/api/scanner-agent/runs", { headers, data: preflight })).status()).toBe(409);
    const metadata = { ...claim, artifactId: randomUUID(), sequence: 1, timestamp: new Date().toISOString(), side: "UNKNOWN", physicalBoundary: "UNKNOWN" };
    const conflicted = await page.request.post("/api/scanner-agent/images", { headers: { ...headers,
      "x-mtg-scanner": JSON.stringify({ ...metadata, executionId: randomUUID() }) }, data: "unused" });
    expect(conflicted.status()).toBe(409); expect(conflicted.headers()["cache-control"]).toBe("no-store");
    expect((await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "finish", ...claim, outcome } })).status()).toBe(200);
    expect((await page.request.post("/api/scanners", { headers: { origin: baseURL! }, data: { action: "revoke", agentId } })).ok()).toBe(true);
    for (const data of [{ action: "poll", version: 1 }, preflight, { action: "claim", ...claim }, { action: "finish", ...claim, outcome }]) {
      const response = await page.request.post("/api/scanner-agent/runs", { headers, data });
      expect(response.status()).toBe(403); expect(response.headers()["cache-control"]).toBe("no-store");
      expect(response.headers()["retry-after"]).toBeUndefined(); expect(await response.text()).not.toContain(secret);
    }
    const deniedImage = await page.request.post("/api/scanner-agent/images", { headers: { ...headers,
      "x-mtg-scanner": JSON.stringify(metadata), "content-type": "image/png" }, data: "unused" });
    expect(deniedImage.status()).toBe(403);
    const state = JSON.parse(database(`const n=${JSON.stringify(tag)};console.log(JSON.stringify({inventory:await p.inventoryItem.count({where:{currentOwnerId:n}}),photos:await p.acquisitionPhoto.count({where:{run:{session:{createdByUserId:n}}}})}));`));
    expect(state).toEqual({ inventory: 0, photos: 0 });
  } finally {
    // Independent feedback cleanup must precede browser/report operations.
    database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');");
    database(`const n=${JSON.stringify(tag)},w={run:{session:{createdByUserId:n}}};
      const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;
      if(!root||!paths.isAbsolute(root))throw new Error('Private fixture storage unavailable');
      for(const r of await p.scannerRun.findMany({where:{agent:{userId:n}},select:{id:true}})){
        if(!/^[a-f0-9-]{36}$/.test(r.id))throw new Error('Invalid owned fixture identity');
        await fs.unlink(paths.join(root,'scanner-control-v1',r.id+'.start.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});}
      await p.scannerRun.deleteMany({where:{agent:{userId:n}}});
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});
      await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});
      await p.inventoryLocation.deleteMany({where:{id:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});`);
  }
});
