import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000,
  });
}

test("Imports exposes scanner, camera and file entry points on desktop and phones", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires local snapshot");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const tag = `ui-input-methods-${randomUUID()}`, password = randomUUID();
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box'}});`);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    let scannerRequests = 0;
    page.on("request", request => { if (request.url().includes("/api/scanners/runs")) scannerRequests++; });
    const savedStart = JSON.stringify({ version: 1, request: {
      requestKey: randomUUID(), agentId: randomUUID(), deviceId: "saved-scanner-fixture",
      locationId: tag, section: "", quantity: null, loadedCount: null, operatorLoadedSimplexFronts: true,
      settings: { dpi: 600, widthInches: 2.6, heightInches: 3.6, horizontalPlacement: "Center", duplex: false, color: "RGB", autoCrop: false, deskew: false, removeBlank: false },
    } });
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/imports");
      await page.evaluate(({ tag, savedStart }) => sessionStorage.setItem(`mtg-scanner-start-v1:${tag}`, savedStart), { tag, savedStart });
      const tasks = page.getByRole("navigation", { name: "Import tasks" });
      for (const [label, input, heading] of [
        ["Camera", "camera", "Camera import"],
        ["Upload photos", "photos", "Upload card photos"],
      ]) {
        await tasks.getByRole("link", { name: label, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`input=${input}`));
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
        await expect(tasks.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
        await expect(page.getByLabel("Scan from a connected scanner")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Connect this computer", exact: true })).toHaveCount(0);
        await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);
        await page.getByRole("option").first().click();
        await expect(page.getByRole("button", { name: "Start batch", exact: true })).toBeEnabled();
        await expect(page.getByText("Review the saved cards before adding them to Inventory.", { exact: false })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        if (input === "photos") await page.screenshot({ path: `test-results/import-inputs-${width}.png`, fullPage: true });
      }
      expect(scannerRequests).toBe(0);
      expect(await page.evaluate(tag => sessionStorage.getItem(`mtg-scanner-start-v1:${tag}`), tag)).toBe(savedStart);
      await page.evaluate(tag => sessionStorage.removeItem(`mtg-scanner-start-v1:${tag}`), tag);
      await tasks.getByRole("link", { name: "Scan cards", exact: true }).click();
      await expect(page.getByLabel("Scan from a connected scanner")).toBeChecked();
      await expect(page.getByRole("button", { name: "Start scanner batch", exact: true })).toBeVisible();
      await tasks.getByRole("link", { name: "Import CSV", exact: true }).click();
      await expect(page.getByLabel("CSV file")).toBeVisible();
    }
    expect(JSON.parse(database(`console.log(JSON.stringify({sessions:await p.acquisitionSession.count({where:{ownerPlayerId:${JSON.stringify(tag)}}}),inventory:await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}})}));`))).toEqual({ sessions: 0, inventory: 0 });
  } finally {
    await page.close().catch(() => {});
    database(`const n=${JSON.stringify(tag)};await p.authSession.deleteMany({where:{userId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});`);
  }
});
