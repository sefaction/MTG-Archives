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

test("card position defaults to Center and explicit choices survive queued requests and continuation", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local fixtures; no helper or motor");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  const tag = `ui-scanner-alignment-${randomUUID()}`, password = randomUUID(), agentId = randomUUID();
  const secret = randomBytes(32).toString("base64url"), headers = { authorization: `Bearer ${agentId}.${secret}` };
  const source = { id: "fixture-alignment", name: "Alignment fixture", backend: "fixture", source: "Fixture", qualification: "GenericUnqualified" };
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box'}});`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password); await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    const pair = await page.request.post("/api/scanners", { data: { action: "pair" }, headers: { origin: baseURL! } });
    expect(pair.ok()).toBe(true);
    expect((await page.request.post("/api/scanner-agent/pair", { data: { version: 1, pairCode: (await pair.json()).code,
      agentId, secret, name: "Alignment fixture" } })).ok()).toBe(true);
    const pulse = async () => expect((await page.request.post("/api/scanner-agent/pulse", {
      headers, data: { version: 1, agentVersion: "0.3.0-native", devices: [source] },
    })).ok()).toBe(true);
    await pulse(); await page.goto("/imports/scan?input=scanner");
    await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);
    await page.getByRole("option").first().click();
    const setup = page.getByRole("region", { name: "New scan batch" });
    const position = setup.getByRole("combobox", { name: "Card position", exact: true });
    await setup.getByText(/Scan settings · 600 DPI/).click();
    await expect(position).toHaveValue("Center");
    for (const alignment of ["Center", "Start", "End"]) {
      await pulse();
      if (!(await position.isVisible())) await setup.getByText(/Scan settings · 600 DPI/).click();
      await position.selectOption(alignment);
      for (const width of [1366, 320]) {
        await page.setViewportSize({ width, height: 900 }); await position.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `test-results/scanner-alignment-${alignment}-${width}.png` });
      }
      await setup.getByRole("button", { name: "Start scanner batch", exact: true }).click();
      const scanner = page.getByRole("region", { name: "Scanner batch" });
      await expect(scanner).toContainText("Waiting for the Windows helper to start.");
      const polled = await page.request.post("/api/scanner-agent/runs", { headers, data: { action: "poll", version: 1 } });
      expect(polled.ok()).toBe(true); const { run } = await polled.json();
      expect(run.settings.horizontalPlacement).toBe(alignment);
      expect(run.settings.dpi).toBe(600);
      expect(run.settings.widthInches).toBe(2.6); expect(run.settings.heightInches).toBe(3.6);
      const persisted = JSON.parse(database(`const r=await p.scannerRun.findUniqueOrThrow({where:{id:${JSON.stringify(run.runId)}}});console.log(JSON.stringify({settings:r.settings,executionId:r.executionId,status:r.status}));`));
      expect(persisted.settings.horizontalPlacement).toBe(alignment);
      expect(persisted.executionId).toBeNull(); expect(persisted.status).toBe("QUEUED");
      await scanner.getByRole("button", { name: "Cancel waiting scan" }).click();
      await expect(scanner).toContainText("The helper was not authorized to feed cards.");
      await scanner.getByRole("link", { name: "New scanner batch" }).click();
      await setup.getByText(/Scan settings · 600 DPI/).click();
      await expect(position).toHaveValue(alignment);
      await expect(setup.getByRole("button", { name: "Start scanner batch", exact: true })).toBeEnabled();
    }
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  } finally {
    // Independent feedback cleanup must precede browser/report operations.
    database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');");
    database(`const n=${JSON.stringify(tag)},w={run:{session:{createdByUserId:n}}};
      await p.scannerRun.deleteMany({where:{agent:{userId:n}}});
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});
      await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});
      await p.inventoryLocation.deleteMany({where:{id:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});`);
  }
});
