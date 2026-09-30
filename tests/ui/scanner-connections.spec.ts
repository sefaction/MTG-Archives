import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000, windowsHide: true,
  });
}
test("paired Windows helper reports real sources in website; revocation blocks it", async ({ page, baseURL }) => {
  const dotnet = process.env.MTG_SCANNER_DOTNET, dll = process.env.MTG_SCANNER_HELPER_DLL;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1" || !dotnet || !dll,
    "Requires locally built Windows helper; only discovery, no feeder operation");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(150000);
  const tag = `ui-scanner-pair-${randomUUID()}`, password = randomUUID();
  let agentId = "";
  const helper = (args: string[], input?: string) => execFileSync(dotnet!, [dll!, ...args], {
    input, encoding: "utf8", timeout: 45000, windowsHide: true,
  });
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:2,sections:[{name:'A',capacity:2}]}}});`);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/imports/scan");
    const panel = page.getByRole("region", { name: "Scanner connections" });
    await panel.getByRole("button", { name: "Connect a scanner", exact: true }).click();
    await expect(panel.getByText("No scanner helpers connected yet.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Connect this computer" })).toBeVisible();
    const installer = await page.request.get("/api/scanners/installer?info");
    expect(installer.ok()).toBe(true);
    expect((await installer.json()).available).toBe(true);
    await expect(panel.getByRole("link", { name: "Download Windows scanner helper" })).toBeVisible();
    const downloadReady = page.waitForEvent("download");
    await panel.getByRole("link", { name: "Download Windows scanner helper" }).click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toBe("MTGArchivesScannerSetup.exe");
    expect(await download.failure()).toBeNull();
    const pair = await page.evaluate(async () => {
      const response = await fetch("/api/scanners", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pair" }) });
      return { status: response.status, value: await response.json() };
    });
    expect(pair.status).toBe(200);
    const { code } = pair.value;
    expect(code).toMatch(/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/);
    const connected = helper(["connect", baseURL!, "--local"], `${code}\n`);
    agentId = connected.match(/Connection identity: ([a-f0-9-]{36})/)?.[1] ?? "";
    expect(agentId).not.toBe("");
    expect(helper(["report", agentId])).toContain("No scan requested.");
    const state = JSON.parse(database(`console.log(JSON.stringify(await p.scannerAgent.findUniqueOrThrow({where:{id:${JSON.stringify(agentId)}},select:{userId:true,devices:true,lastSeenAt:true}})));`));
    expect(state.userId).toBe(tag);
    expect(state.devices.length).toBeGreaterThan(0);
    // Read-only real SDK discovery is evidence of connectivity, not hardware
    // qualification or a START/transfer test. Do not mock device identities.
    await expect(panel.getByText("Online", { exact: true })).toBeVisible();
    for (const device of state.devices) await expect(panel.getByText(`${device.name} · ${device.source}`, { exact: false })).toBeVisible();
    await expect(panel.locator("code")).toHaveCount(0); // Secrets omitted from screenshots.
    await panel.getByRole("link", { name: "Set up a new scanner batch" }).click();
    await expect(page).toHaveURL(/\/imports\/scan\?input=scanner#new-scan-batch$/);
    await panel.getByRole("button", { name: "Scanner connected" }).click();
    const batch = page.getByRole("region", { name: "New scan batch" });
    await expect(batch.getByRole("heading", { name: "Set up a new scan batch" })).toBeVisible();
    await expect(batch.getByLabel("Scan from a connected scanner")).toBeChecked();
    const start = batch.getByRole("button", { name: "Start scanner batch" });
    await expect(start).toBeDisabled();
    await expect(batch.getByText("Choose a destination to start.")).toBeVisible();
    await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);
    await page.getByRole("option", { name: new RegExp(tag) }).first().click();
    const source = batch.getByRole("combobox", { name: "Scanner source" });
    await expect(source.locator("option").nth(1)).toBeAttached();
    await source.selectOption({ index: 1 });
    await expect(start).toBeDisabled();
    await batch.getByLabel("The scanner is clear and exactly this many expendable cards are loaded for simplex scanning.").check();
    await expect(start).toBeEnabled(); // Do not click: this would start the scanner motor.
    for (const width of [1366, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(panel.getByRole("button", { name: "Disconnect Windows scanner", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await panel.getByRole("link", { name: "Set up a new scanner batch" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/scanner-start-link-${width}.png` });
      await start.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/scanner-start-${width}.png` });
    }
    await panel.getByRole("button", { name: "Disconnect Windows scanner", exact: true }).click();
    await expect(panel.getByText("No scanner helpers connected yet.")).toBeVisible();
    expect(() => helper(["report", agentId])).toThrow();
    expect(Number(database(`console.log(await p.acquisitionSession.count({where:{createdByUserId:${JSON.stringify(tag)}}}));`))).toBe(0);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  } finally {
    if (agentId) helper(["forget", agentId]);
    database(`const n=${JSON.stringify(tag)};await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.inventoryLocation.deleteMany({where:{id:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});`);
  }
});
