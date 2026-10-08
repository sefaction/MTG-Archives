import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    windowsHide: true, encoding: "utf8", timeout: 30000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(()=>{console.error('Owned original retry fixture failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
  });
}

for (const width of [1366, 320]) test(`correction original retries the selected photo at ${width}px`, async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local account and controlled photo transport failures");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(90000);
  const owner = `ui-original-retry-${randomUUID()}`, password = randomUUID(), exampleId = randomUUID();
  let originalRequests = 0, listRequests = 0, failOriginal = true;
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const photo = await sharp({ create: { width: 64, height: 88, channels: 3, background: "#335577" } }).png().toBuffer();
  try {
    database(`const n=${JSON.stringify(owner)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});`);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(owner);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    await page.route("**/api/acquisition/corrections**", async route => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("owner")).toBe(owner);
      expect(route.request().method()).toBe("GET");
      if (url.pathname.endsWith(exampleId)) {
        originalRequests++;
        if (failOriginal) return route.abort("failed");
        return route.fulfill({ contentType: "image/png", body: photo });
      }
      expect(url.pathname).toBe("/api/acquisition/corrections");
      listRequests++;
      await route.fulfill({ json: { usage: null, nextCursor: null, examples: [{
        id: exampleId, createdAt: "2026-10-08T00:00:00.000Z", label: { printing: { name: "Controlled correction photo", setCode: "tst", collectorNumber: "1" } },
        labelState: "UNVERIFIED", normalControl: false,
        blob: { bytes: photo.length, state: "PRESERVED", preservedAt: "2026-10-08T00:00:00.000Z", _count: { examples: 1 } },
      }] } });
    });
    await page.goto("/imports/corrections");
    const example = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Controlled correction photo · tst 1" }) });
    await example.getByRole("button", { name: "View original", exact: true }).click();
    const alert = page.getByRole("alert").filter({ hasText: "The preserved original could not be read" });
    await expect(alert).toContainText("The preserved original could not be read");
    await alert.getByRole("button", { name: /^Retry(?: original)?$/ }).click();
    await expect.poll(() => originalRequests).toBe(2);
    await expect(alert).toContainText("The preserved original could not be read");
    await expect(example.getByRole("button", { name: "Hide original", exact: true })).toBeVisible();
    failOriginal = false;
    await alert.getByRole("button", { name: /^Retry(?: original)?$/ }).click();
    await expect.poll(() => originalRequests).toBe(3);
    const image = example.getByRole("img", { name: "Preserved original correction photo" });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    await expect(alert).toHaveCount(0);
    expect(listRequests).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/correction-original-retry-${width}.png` });
    await example.getByRole("button", { name: "Hide original", exact: true }).click();
    failOriginal = true;
    await example.getByRole("button", { name: "View original", exact: true }).click();
    await expect(alert).toContainText("The preserved original could not be read");
    await example.getByRole("button", { name: "Hide original", exact: true }).click();
    await expect(alert).toHaveCount(0);
    await expect(image).toHaveCount(0);
    expect(listRequests).toBe(1);
    expect(pageErrors).toEqual([]);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    database(`const n=${JSON.stringify(owner)};if(!/^ui-original-retry-[a-f0-9-]{36}$/.test(n))throw Error('Invalid fixture');await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});`);
  }
});
